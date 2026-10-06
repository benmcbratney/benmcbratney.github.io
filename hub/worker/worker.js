// Home Hub backend — a single-file Cloudflare Worker.
//
// It keeps the secrets (calendar feed URLs, Todoist token) out of the public
// GitHub Pages repo and does the heavy lifting (ICS parsing, recurring-event
// expansion) so the old iPad only has to draw JSON.
//
// Environment (set in the Cloudflare dashboard → Worker → Settings → Variables,
// mark the sensitive ones as "Secret"):
//   HUB_KEY          secret  any long random string; the iPad sends it on every request
//   TODOIST_TOKEN    secret  Todoist → Settings → Integrations → Developer → API token
//   CALENDARS        secret  JSON array: [{"name":"Ben","url":"https://…/basic.ics","color":"#4f8cff"}, …]
//   HOME_TZ          plain   e.g. America/Chicago
//   CHORES_PROJECT   plain   Todoist project name for chores   (default "Chores")
//   GROCERY_PROJECT  plain   Todoist project name for groceries (default "Groceries")
//
// Routes (all require header  X-Hub-Key: <HUB_KEY>):
//   GET  /calendar?days=7
//   GET  /todoist/lists
//   POST /todoist/close   {"id": "..."}
//   POST /todoist/add     {"list": "chores"|"grocery", "content": "..."}

const TODOIST = "https://api.todoist.com/api/v1";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    if (!env.HUB_KEY || request.headers.get("X-Hub-Key") !== env.HUB_KEY) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/calendar" && request.method === "GET") {
        const days = clamp(parseInt(url.searchParams.get("days") || "7", 10), 1, 31);
        return json(await calendar(env, days));
      }
      if (url.pathname === "/todoist/lists" && request.method === "GET") {
        return json(await todoistLists(env));
      }
      if (url.pathname === "/todoist/close" && request.method === "POST") {
        const { id } = await request.json();
        await todoist(env, `/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
        return json({ ok: true });
      }
      if (url.pathname === "/todoist/add" && request.method === "POST") {
        const { list, content } = await request.json();
        if (!content || !String(content).trim()) return json({ error: "empty" }, 400);
        const projects = await projectIds(env);
        const project_id = list === "grocery" ? projects.grocery : projects.chores;
        if (!project_id) return json({ error: "project not found" }, 404);
        const task = await todoist(env, "/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: String(content).trim(), project_id }),
        });
        return json(trimTask(task));
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502);
    }
  },
};

// ---------------------------------------------------------------- helpers

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Hub-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors() },
  });
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, isNaN(n) ? lo : n));
}

// ---------------------------------------------------------------- Todoist

async function todoist(env, path, init = {}) {
  const res = await fetch(TODOIST + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.TODOIST_TOKEN}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Todoist ${res.status} on ${path}`);
  return res.status === 204 ? null : res.json();
}

async function todoistAll(env, path) {
  const out = [];
  let cursor = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await todoist(env, path + (cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ""));
    out.push(...(page.results || []));
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

async function projectIds(env) {
  const projects = await todoistAll(env, "/projects");
  const find = (name) => {
    const p = projects.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return p ? p.id : null;
  };
  return {
    chores: find(env.CHORES_PROJECT || "Chores"),
    grocery: find(env.GROCERY_PROJECT || "Groceries"),
  };
}

function trimTask(t) {
  return {
    id: t.id,
    content: t.content,
    due: t.due ? t.due.date : null,
    recurring: !!(t.due && t.due.is_recurring),
    priority: t.priority,
    order: t.child_order,
  };
}

async function todoistLists(env) {
  const ids = await projectIds(env);
  const load = async (id) => {
    if (!id) return null;
    const tasks = await todoistAll(env, `/tasks?project_id=${encodeURIComponent(id)}`);
    return tasks.map(trimTask).sort((a, b) => a.order - b.order);
  };
  const [chores, grocery] = await Promise.all([load(ids.chores), load(ids.grocery)]);
  return { chores, grocery };
}

// ---------------------------------------------------------------- Calendar

async function calendar(env, days) {
  const tz = env.HOME_TZ || "America/Chicago";
  const cals = JSON.parse(env.CALENDARS || "[]");

  const today = wallParts(new Date(), tz);
  const start = { y: today.y, m: today.m, d: today.d, h: 0, mi: 0, s: 0 };

  const results = await Promise.all(
    cals.map(async (cal) => {
      try {
        const res = await fetch(cal.url, { cf: { cacheTtl: 120 } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = expandCalendar(await res.text(), start, days, tz);
        return events.map((e) => ({ ...e, calendar: cal.name, color: cal.color || null }));
      } catch (err) {
        return [{ error: `${cal.name}: ${err.message}` }];
      }
    })
  );

  const flat = results.flat();
  return {
    tz,
    errors: flat.filter((e) => e.error).map((e) => e.error),
    events: flat
      .filter((e) => !e.error)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.allDay ? -1 : 1)),
  };
}

// Expand one ICS document into event instances overlapping the `days` days
// starting at wall-clock date `startDay` in `tz`. Output times are wall-clock
// strings in `tz` ("2026-10-06T09:00"), or dates ("2026-10-06") for all-day
// events, so the iPad never has to do tz math.
function expandCalendar(text, startDay, days, tz) {
  const endDay = addDays(startDay, days);
  // Timed events are compared as real instants; all-day events as floating dates.
  const timedWin = [toInstant(startDay, tz), toInstant(endDay, tz)];
  const dayWin = [Date.UTC(startDay.y, startDay.m - 1, startDay.d), Date.UTC(endDay.y, endDay.m - 1, endDay.d)];
  const vevents = parseIcs(text);
  const overrides = new Map(); // uid -> Set of recurrence-id instants (ms)
  for (const ev of vevents) {
    if (ev.recurrenceId) {
      if (!overrides.has(ev.uid)) overrides.set(ev.uid, new Set());
      overrides.get(ev.uid).add(ev.recurrenceId.instant);
    }
  }

  const out = [];
  for (const ev of vevents) {
    if (!ev.start) continue;
    const durMs = ev.end ? ev.end.instant - ev.start.instant : ev.start.allDay ? 864e5 : 0;
    const skip = overrides.get(ev.uid);
    const [winStart, winEnd] = ev.start.allDay ? dayWin : timedWin;

    const emit = (startInstant, startWall) => {
      if (ev.status === "CANCELLED") return;
      const endInstant = startInstant + durMs;
      const overlaps = durMs > 0 ? startInstant < winEnd && endInstant > winStart : startInstant >= winStart && startInstant < winEnd;
      if (!overlaps) return;
      if (ev.start.allDay) {
        const endWall = addDays(startWall, Math.max(1, Math.round(durMs / 864e5)));
        out.push({ title: ev.summary, location: ev.location, allDay: true, start: fmtDate(startWall), end: fmtDate(endWall) });
      } else {
        out.push({
          title: ev.summary,
          location: ev.location,
          allDay: false,
          start: fmtWall(wallParts(new Date(startInstant), tz)),
          end: fmtWall(wallParts(new Date(endInstant), tz)),
        });
      }
    };

    if (!ev.rrule || ev.recurrenceId) {
      emit(ev.start.instant, ev.start.wall);
      continue;
    }

    const exdates = new Set(ev.exdates.map((x) => x.instant));
    for (const wall of recurrences(ev.start.wall, ev.rrule, winStart - durMs, winEnd, ev.start.tz, ev.start.allDay)) {
      const instant = ev.start.allDay ? Date.UTC(wall.y, wall.m - 1, wall.d) : toInstant(wall, ev.start.tz);
      if (instant >= winEnd) break;
      if (exdates.has(instant) || (skip && skip.has(instant))) continue;
      emit(instant, wall);
    }
  }
  return out;
}

// --- ICS parsing

function parseIcs(text) {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    const params = {};
    for (const p of paramParts) {
      const [k, v] = p.split("=");
      params[k.toUpperCase()] = (v || "").replace(/^"|"$/g, "");
    }
    const value = line.slice(colon + 1);
    switch (name.toUpperCase()) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "LOCATION": cur.location = unescape(value) || null; break;
      case "STATUS": cur.status = value.toUpperCase(); break;
      case "DTSTART": cur.start = parseDate(value, params); break;
      case "DTEND": cur.end = parseDate(value, params); break;
      case "DURATION": cur.duration = value; break;
      case "RRULE": cur.rrule = parseRrule(value); break;
      case "RECURRENCE-ID": cur.recurrenceId = parseDate(value, params); break;
      case "EXDATE":
        for (const v of value.split(",")) cur.exdates.push(parseDate(v, params));
        break;
    }
  }
  for (const ev of events) {
    if (!ev.end && ev.start && ev.duration) {
      ev.end = { instant: ev.start.instant + parseDuration(ev.duration) };
    }
    if (!ev.summary) ev.summary = "(busy)";
  }
  return events;
}

function unescape(s) {
  return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  if (params.VALUE === "DATE" || !m[4]) {
    return { allDay: true, wall, tz: "UTC", instant: Date.UTC(wall.y, wall.m - 1, wall.d) };
  }
  const tz = m[7] ? "UTC" : params.TZID || "UTC";
  return { allDay: false, wall, tz, instant: toInstant(wall, tz) };
}

function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s);
  if (!m) return 0;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1e3;
  return m[1] === "-" ? -ms : ms;
}

function parseRrule(value) {
  const r = {};
  for (const part of value.split(";")) {
    const [k, v] = part.split("=");
    r[k.toUpperCase()] = v;
  }
  return {
    freq: r.FREQ,
    interval: parseInt(r.INTERVAL || "1", 10),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseDate(r.UNTIL, {}) : null,
    byday: r.BYDAY ? r.BYDAY.split(",") : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(",").map(Number) : null,
  };
}

// --- Recurrence expansion (DAILY / WEEKLY / MONTHLY / YEARLY with the common
// BY* parts). Iterates in the event's own wall-clock time so DST shifts keep
// "9am every Tuesday" at 9am.

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_INSTANCES = 2000;

function* recurrences(dtstart, rule, winStart, winEnd, tz, allDay) {
  const untilMs = rule.until ? rule.until.instant : Infinity;
  const toMs = (w) => (allDay ? Date.UTC(w.y, w.m - 1, w.d) : toInstant(w, tz));
  const startMs = toMs(dtstart);
  let produced = 0;

  // Without COUNT, nothing before the window matters, so jump close to it
  // (a daily event that started in 2012 shouldn't take 5,000 steps).
  let first = 0;
  if (rule.count === null && winStart > startMs) {
    const days = (winStart - startMs) / 864e5;
    // Use the longest possible period length so we always undershoot, never skip.
    const approx = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[rule.freq] || 1;
    first = Math.max(0, Math.floor(days / (approx * rule.interval)) - 2);
  }

  for (let period = first, steps = 0; steps < 5000; period++, steps++) {
    const candidates = periodCandidates(dtstart, rule, period);
    if (candidates === null) return;
    for (const w of candidates) {
      const ms = toMs(w);
      if (ms < startMs) continue;
      if (ms > untilMs) return;
      if (rule.count !== null && produced >= rule.count) return;
      produced++;
      if (produced > MAX_INSTANCES) return;
      yield w;
    }
    // Stop once whole periods are past the window.
    const periodStart = addPeriod(dtstart, rule, period);
    if (toMs(periodStart) >= winEnd + 31 * 864e5) return;
  }
}

function addPeriod(dtstart, rule, n) {
  const k = n * rule.interval;
  switch (rule.freq) {
    case "DAILY": return addDays(dtstart, k);
    case "WEEKLY": return addDays(dtstart, 7 * k);
    case "MONTHLY": return { ...dtstart, ...monthShift(dtstart.y, dtstart.m, k), d: 1 };
    case "YEARLY": return { ...dtstart, y: dtstart.y + k, m: 1, d: 1 };
    default: return null;
  }
}

function periodCandidates(dtstart, rule, n) {
  const time = { h: dtstart.h, mi: dtstart.mi, s: dtstart.s };
  const k = n * rule.interval;
  let list;

  if (rule.freq === "DAILY") {
    list = [addDays(dtstart, k)];
  } else if (rule.freq === "WEEKLY") {
    const anchor = addDays(dtstart, 7 * k);
    if (!rule.byday) {
      list = [anchor];
    } else {
      // Week starts Monday (RFC default WKST=MO).
      const dow = weekday(anchor);
      const monday = addDays(anchor, -((dow + 6) % 7));
      list = rule.byday
        .map((code) => DAYS.indexOf(code.slice(-2)))
        .filter((i) => i >= 0)
        .map((i) => addDays(monday, (i + 6) % 7))
        .sort(cmpWall);
    }
  } else if (rule.freq === "MONTHLY") {
    const { y, m } = monthShift(dtstart.y, dtstart.m, k);
    list = monthDays(y, m, rule, dtstart);
  } else if (rule.freq === "YEARLY") {
    const y = dtstart.y + k;
    const months = rule.bymonth || [dtstart.m];
    list = [];
    for (const m of months) {
      if (rule.byday || rule.bymonthday) list.push(...monthDays(y, m, rule, dtstart));
      else if (dtstart.d <= daysInMonth(y, m)) list.push({ y, m, d: dtstart.d });
    }
  } else {
    return null; // Unsupported FREQ (HOURLY etc.) — show only the first instance.
  }

  if (rule.bymonth && rule.freq !== "YEARLY") list = list.filter((w) => rule.bymonth.includes(w.m));
  return list.map((w) => ({ ...w, ...time }));
}

function monthDays(y, m, rule, dtstart) {
  const dim = daysInMonth(y, m);
  if (rule.bymonthday) {
    return rule.bymonthday
      .map((d) => (d < 0 ? dim + d + 1 : d))
      .filter((d) => d >= 1 && d <= dim)
      .sort((a, b) => a - b)
      .map((d) => ({ y, m, d }));
  }
  if (rule.byday) {
    const out = [];
    for (const code of rule.byday) {
      const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(code);
      if (!mm) continue;
      const target = DAYS.indexOf(mm[2]);
      const matches = [];
      for (let d = 1; d <= dim; d++) if (weekday({ y, m, d }) === target) matches.push(d);
      if (mm[1]) {
        const nth = parseInt(mm[1], 10);
        const d = nth > 0 ? matches[nth - 1] : matches[matches.length + nth];
        if (d) out.push({ y, m, d });
      } else {
        for (const d of matches) out.push({ y, m, d });
      }
    }
    return out.sort(cmpWall);
  }
  return dtstart.d <= dim ? [{ y, m, d: dtstart.d }] : [];
}

// --- Date / timezone utilities (wall-clock objects: {y, m, d, h, mi, s})

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthShift(y, m, k) {
  const total = y * 12 + (m - 1) + k;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function addDays(w, n) {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekday(w) {
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
}

function cmpWall(a, b) {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

const fmtCache = new Map();
function wallParts(date, tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    }));
  }
  const p = {};
  for (const { type, value } of fmtCache.get(tz).formatToParts(date)) p[type] = +value;
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

// Wall-clock time in `tz` → epoch ms.
function toInstant(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h || 0, w.mi || 0, w.s || 0);
  if (tz === "UTC" || tz === "Etc/UTC" || tz === "GMT") return guess;
  let tzSafe = tz;
  try { wallParts(new Date(guess), tz); } catch { tzSafe = "UTC"; }
  // Two passes handle DST boundaries.
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const seen = wallParts(new Date(instant), tzSafe);
    const seenMs = Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.mi, seen.s);
    instant += guess - seenMs;
  }
  return instant;
}

const pad = (n) => String(n).padStart(2, "0");
function fmtDate(w) {
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}
function fmtWall(w) {
  return `${fmtDate(w)}T${pad(w.h)}:${pad(w.mi)}`;
}
