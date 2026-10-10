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
//   FAMILY           secret  optional JSON for personal greetings, e.g.
//                            {"parents":["Mom","Dad"],"kids":["A","B"],"nicknames":["Ace"],"dog":"Rex"}
//   KIDS_QUICK_ADD   plain   optional JSON array of one-tap buttons for the Kids card's +,
//                            e.g. ["A school clothes","B school clothes"]
//
// Optional Nest thermostats (Google Device Access — see hub/README.md):
//   NEST_PROJECT_ID     plain   Device Access project ID
//   NEST_CLIENT_ID      plain   Google Cloud OAuth client ID
//   NEST_CLIENT_SECRET  secret  Google Cloud OAuth client secret
//   NEST_REFRESH_TOKEN  secret  from visiting /nest/connect once (it shows you the token)
//
// Optional Spotify "now playing" (developer.spotify.com — see hub/README.md):
//   SPOTIFY_CLIENT_ID      plain   Spotify app client ID
//   SPOTIFY_CLIENT_SECRET  secret  Spotify app client secret
//   SPOTIFY_REFRESH_TOKEN  secret  from visiting /spotify/connect once (it shows you the token)
//
// Routes (all require header  X-Hub-Key: <HUB_KEY>, except the two Nest setup pages):
//   GET  /calendar?days=7
//   GET  /countdowns                   next year of "⏳"-tagged events and birthdays
//   GET  /todoist/lists
//   POST /todoist/close   {"id": "..."}
//   POST /todoist/add     {"list": "chores"|"grocery", "content": "..."}
//   GET  /family                       personal greeting names (null when FAMILY isn't set)
//                                      and the Kids quick-add buttons
//   GET  /nest                         thermostats (null when Nest isn't configured)
//   POST /nest/set        {"id": "...", "heatC": 20.5, "coolC": 24}   (either or both)
//   POST /nest/mode       {"id": "...", "mode": "HEAT"|"COOL"|"HEATCOOL"|"OFF"|"ECO"}
//   GET  /nest/connect    (browser, no key) start Google sign-in
//   GET  /nest/callback   (browser, no key) shows the refresh token to save
//   GET  /spotify                      now playing (null when Spotify isn't configured)
//   POST /spotify/control {"action": "play"|"pause"|"next"|"previous"}
//   GET  /spotify/library              your playlists + Spotify Connect speakers
//   POST /spotify/play    {"deviceId": "...", "uri": "spotify:playlist:…"}   (uri optional: just move playback)
//   GET  /spotify/connect, /spotify/callback   (browser, no key) one-time sign-in
//   GET  /sports                       last/live/next game for each team (ESPN's free feeds)
//
// Optional SPORTS_TEAMS (plain) overrides the default Chicago teams, e.g.
//   [{"key":"bears","name":"Bears","emoji":"🐻","path":"football/nfl","id":"3"}]
//   (logos come from ESPN; add "logo":"https://…" to a team to use your own image)

const TODOIST = "https://api.todoist.com/api/v1";
const SDM = "https://smartdevicemanagement.googleapis.com/v1";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    // One-time Nest sign-in pages. They're opened in a normal browser (which can't
    // send the hub key) and only ever reveal a token to the person who just signed in.
    const path = new URL(request.url).pathname;
    if (path === "/nest/connect") return nestConnect(request, env);
    if (path === "/nest/callback") return nestCallback(request, env);
    if (path === "/spotify/connect") return spotifyConnect(request, env);
    if (path === "/spotify/callback") return spotifyCallback(request, env);

    if (!env.HUB_KEY || request.headers.get("X-Hub-Key") !== env.HUB_KEY) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/calendar" && request.method === "GET") {
        const days = clamp(parseInt(url.searchParams.get("days") || "7", 10), 1, 31);
        return json(await calendar(env, days));
      }
      if (url.pathname === "/countdowns" && request.method === "GET") {
        return json(await countdowns(env));
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
      if (url.pathname === "/sports" && request.method === "GET") {
        return json(await sports(env));
      }
      if (url.pathname === "/family" && request.method === "GET") {
        return json({ family: family(env), kidsQuickAdd: kidsQuickAdd(env) });
      }
      if (url.pathname === "/spotify" && request.method === "GET") {
        return json({ spotify: await spotifyNow(env) });
      }
      if (url.pathname === "/spotify/library" && request.method === "GET") {
        return json(await spotifyLibrary(env));
      }
      if (url.pathname === "/spotify/play" && request.method === "POST") {
        const { deviceId, uri } = await request.json();
        await spotifyPlay(env, deviceId, uri);
        return json({ ok: true });
      }
      if (url.pathname === "/spotify/control" && request.method === "POST") {
        const { action } = await request.json();
        await spotifyControl(env, action);
        return json({ ok: true });
      }
      if (url.pathname === "/nest" && request.method === "GET") {
        return json({ thermostats: await nestThermostats(env) });
      }
      if (url.pathname === "/nest/set" && request.method === "POST") {
        const { id, heatC, coolC } = await request.json();
        await nestSetpoint(env, id, heatC, coolC);
        return json({ ok: true });
      }
      if (url.pathname === "/nest/mode" && request.method === "POST") {
        const { id, mode } = await request.json();
        await nestMode(env, id, mode);
        return json({ ok: true });
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

// ---------------------------------------------------------------- Spotify (now playing)

const SPOTIFY_SCOPES =
  "user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private playlist-read-collaborative";

function spotifyConfigured(env) {
  return !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.SPOTIFY_REFRESH_TOKEN);
}

function spotifyBasicAuth(env) {
  return "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET || ""}`);
}

function spotifyConnect(request, env) {
  if (!env.SPOTIFY_CLIENT_ID) {
    return html("<h2>Almost there</h2><p>Add <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code> to the Worker first.</p>", 400);
  }
  const auth = new URL("https://accounts.spotify.com/authorize");
  auth.search = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: new URL("/spotify/callback", request.url).toString(),
    scope: SPOTIFY_SCOPES,
    show_dialog: "true",
  }).toString();
  return Response.redirect(auth.toString(), 302);
}

async function spotifyCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return html(`<h2>Sign-in didn't finish</h2><p>${escapeHtml(url.searchParams.get("error") || "No code returned.")}</p>`, 400);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: spotifyBasicAuth(env) },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/spotify/callback", request.url).toString(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    return html(`<h2>Couldn't get a token</h2><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`, 502);
  }
  return html(
    `<h2>Connected ✅</h2><p>Copy this into the Worker as a <b>Secret</b> named <code>SPOTIFY_REFRESH_TOKEN</code>, then deploy. ` +
      `Treat it like a password and close this tab when you're done.</p>` +
      `<textarea readonly style="width:100%;height:120px;font:14px monospace" onclick="this.select()">${escapeHtml(data.refresh_token)}</textarea>`
  );
}

let spotifyToken = null;
async function spotifyAccessToken(env) {
  if (spotifyToken && spotifyToken.expires > Date.now() + 60e3) return spotifyToken.value;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: spotifyBasicAuth(env) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
  });
  if (!res.ok) throw new Error(`Spotify sign-in ${res.status} (re-run /spotify/connect if this persists)`);
  const data = await res.json();
  spotifyToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return spotifyToken.value;
}

async function spotifyApi(env, path, init = {}) {
  const res = await fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { Authorization: `Bearer ${await spotifyAccessToken(env)}`, ...(init.headers || {}) },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const reason = detail && detail.error && (detail.error.reason || detail.error.message);
    if (reason === "PREMIUM_REQUIRED") throw new Error("Spotify Premium is needed for play/pause/skip");
    if (reason === "NO_ACTIVE_DEVICE") throw new Error("nothing is playing on a Spotify device");
    throw new Error(`Spotify ${res.status}${reason ? ": " + reason : ""}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function spotifyNow(env) {
  if (!spotifyConfigured(env)) return null;
  const p = await spotifyApi(env, "/me/player?additional_types=episode");
  if (!p || !p.item) return { active: false };
  const item = p.item;
  const images = (item.album && item.album.images) || item.images || (item.show && item.show.images) || [];
  // Spotify lists images largest first; take the smallest that's still >= 200px.
  const art = images.filter((i) => !i.width || i.width >= 200).pop() || images[0] || null;
  return {
    active: true,
    playing: !!p.is_playing,
    title: item.name,
    artist: item.artists ? item.artists.map((a) => a.name).join(", ") : item.show ? item.show.name : "",
    album: item.album ? item.album.name : "",
    art: art ? art.url : null,
    progressMs: p.progress_ms || 0,
    durationMs: item.duration_ms || 0,
    device: p.device ? p.device.name : null,
  };
}

async function spotifyControl(env, action) {
  if (!spotifyConfigured(env)) throw new Error("Spotify isn't configured");
  const routes = {
    play: ["PUT", "/me/player/play"],
    pause: ["PUT", "/me/player/pause"],
    next: ["POST", "/me/player/next"],
    previous: ["POST", "/me/player/previous"],
  };
  const r = routes[action];
  if (!r) throw new Error("bad action");
  await spotifyApi(env, r[1], { method: r[0] });
}

// Playlists (yours and followed, up to 100) and the speakers Spotify can see right now.
// Echo and other smart speakers only show up while they're awake/recently used.
async function spotifyLibrary(env) {
  if (!spotifyConfigured(env)) throw new Error("Spotify isn't configured");
  const [page1, devs] = await Promise.all([
    spotifyApi(env, "/me/playlists?limit=50"),
    spotifyApi(env, "/me/player/devices"),
  ]);
  let items = (page1 && page1.items) || [];
  if (page1 && page1.next && page1.total > 50) {
    const page2 = await spotifyApi(env, "/me/playlists?limit=50&offset=50");
    items = items.concat((page2 && page2.items) || []);
  }
  const playlists = items.filter(Boolean).map((pl) => {
    const imgs = pl.images || [];
    // Smallest cover that's still >= 120px (Spotify lists largest first).
    const img = imgs.filter((i) => !i.width || i.width >= 120).pop() || imgs[0] || null;
    return { uri: pl.uri, name: pl.name, image: img ? img.url : null };
  });
  const devices = ((devs && devs.devices) || []).map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type, // Computer, Smartphone, Speaker, TV, CastAudio, …
    active: !!d.is_active,
    restricted: !!d.is_restricted || !d.id,
  }));
  return { playlists, devices };
}

async function spotifyPlay(env, deviceId, uri) {
  if (!spotifyConfigured(env)) throw new Error("Spotify isn't configured");
  if (typeof deviceId !== "string" || !/^[\w-]+$/.test(deviceId)) throw new Error("pick a speaker first");
  if (uri != null && (typeof uri !== "string" || !/^spotify:[a-z]+:[\w:.-]+$/i.test(uri))) throw new Error("bad playlist");
  if (uri) {
    await spotifyApi(env, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_uri: uri }),
    });
  } else {
    await spotifyApi(env, "/me/player", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
    });
  }
}

// ---------------------------------------------------------------- Sports (ESPN's public site API)
// No key needed. It's unofficial, so everything is read defensively: a team that
// fails just reports an error instead of breaking the rest.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
const DEFAULT_TEAMS = [
  { key: "bears", name: "Bears", emoji: "🐻", path: "football/nfl", id: "3" },
  { key: "cubs", name: "Cubs", emoji: "⚾", path: "baseball/mlb", id: "16" },
  { key: "bulls", name: "Bulls", emoji: "🐂", path: "basketball/nba", id: "4" },
  { key: "blackhawks", name: "Blackhawks", emoji: "🏒", path: "hockey/nhl", id: "4" },
  { key: "nu-football", name: "Northwestern", emoji: "🏈", path: "football/college-football", id: "77" },
  { key: "nu-hoops", name: "Northwestern", emoji: "🏀", path: "basketball/mens-college-basketball", id: "77" },
];

async function espn(path) {
  const res = await fetch(ESPN + path, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// Scores come as "24" on some endpoints and {value, displayValue} on others.
function espnScore(s) {
  if (s == null) return null;
  if (typeof s === "object") return s.displayValue != null ? String(s.displayValue) : s.value != null ? String(s.value) : null;
  return String(s);
}

function espnGame(ev, teamId) {
  const comp = (ev && ev.competitions && ev.competitions[0]) || ev;
  if (!comp || !comp.competitors) return null;
  const us = comp.competitors.find((c) => String(c.id || (c.team && c.team.id)) === String(teamId));
  const them = comp.competitors.find((c) => c !== us);
  if (!us || !them) return null;
  const status = (comp.status || ev.status || {}).type || {};
  const tv = ((comp.broadcasts || [])[0] || {});
  const t = them.team || {};
  return {
    id: String(ev.id || comp.id),
    start: Date.parse(ev.date || comp.date) || null,
    state: status.state || "pre", // pre | in | post
    detail: status.shortDetail || status.detail || "",
    home: us.homeAway === "home",
    usScore: espnScore(us.score),
    themScore: espnScore(them.score),
    them: t.shortDisplayName || t.displayName || t.abbreviation || "?",
    themAbbr: t.abbreviation || "",
    won: status.state === "post" && us.winner != null ? !!us.winner : null,
    tv: (tv.media && tv.media.shortName) || (tv.names && tv.names[0]) || null,
  };
}

async function sportsTeam(t) {
  const [info, sched] = await Promise.all([
    espn(`${t.path}/teams/${t.id}`).catch(() => null),
    espn(`${t.path}/teams/${t.id}/schedule`).catch(() => null),
  ]);
  if (!info && !sched) throw new Error("no data");
  const games = ((sched && sched.events) || []).map((ev) => espnGame(ev, t.id)).filter(Boolean);
  const nextEv = info && info.team && info.team.nextEvent && info.team.nextEvent[0];
  const next = nextEv ? espnGame(nextEv, t.id) : null;
  if (next && !games.some((g) => g.id === next.id)) games.push(next); // e.g. postseason games
  if (next) games.forEach((g, i) => { if (g.id === next.id) games[i] = next; }); // fresher status

  // A game in progress: ask for its live box score.
  let live = games.find((g) => g.state === "in") || null;
  if (live) {
    const sum = await espn(`${t.path}/summary?event=${encodeURIComponent(live.id)}`).catch(() => null);
    const fresh = sum && sum.header && espnGame({ ...sum.header, id: live.id, date: live.start && new Date(live.start).toISOString() }, t.id);
    if (fresh) live = { ...live, ...fresh, start: live.start };
  }
  const now = Date.now();
  const last = games.filter((g) => g.state === "post").sort((a, b) => b.start - a.start)[0] || null;
  const upcoming = games.filter((g) => g.state === "pre" && g.start && g.start > now - 6 * 3600e3).sort((a, b) => a.start - b.start)[0] || null;
  const rec = info && info.team && info.team.record && info.team.record.items && info.team.record.items[0];
  return { key: t.key, name: t.name, emoji: t.emoji, logo: t.logo || espnLogo(info), record: rec ? rec.summary : null, live, last, next: upcoming };
}

// The team's logo, shrunk to 80px through ESPN's image resizer so the old iPad isn't
// decoding 500px PNGs. (The hub falls back to the emoji if it doesn't load.)
function espnLogo(info) {
  const logos = (info && info.team && info.team.logos) || [];
  const pick = logos.find((l) => (l.rel || []).includes("default")) || logos[0];
  if (!pick || !pick.href) return null;
  const m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+\.png)$/.exec(pick.href);
  return m ? `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(m[1])}&w=80&h=80` : pick.href;
}

async function sports(env) {
  let teams = DEFAULT_TEAMS;
  if (env.SPORTS_TEAMS) {
    try { teams = JSON.parse(env.SPORTS_TEAMS); } catch { throw new Error("SPORTS_TEAMS isn't valid JSON"); }
  }
  const out = await Promise.all(teams.slice(0, 10).map((t) =>
    sportsTeam(t).catch((err) => ({ key: t.key, name: t.name, emoji: t.emoji, error: err.message }))
  ));
  return { teams: out };
}

// ---------------------------------------------------------------- Family (personal greetings)

// Names live here, as a Worker secret, so they never land in the public repo.
function family(env) {
  if (!env.FAMILY) return null;
  let f;
  try {
    f = JSON.parse(env.FAMILY);
  } catch {
    throw new Error("FAMILY isn't valid JSON");
  }
  const names = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  return { parents: names(f.parents), kids: names(f.kids), nicknames: names(f.nicknames), dog: names(f.dog)[0] || null };
}

// One-tap buttons for the Kids card's + (they name the kids, so they live here too).
function kidsQuickAdd(env) {
  if (!env.KIDS_QUICK_ADD) return [];
  let list;
  try {
    list = JSON.parse(env.KIDS_QUICK_ADD);
  } catch {
    throw new Error("KIDS_QUICK_ADD isn't valid JSON");
  }
  return (Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 24);
}

// ---------------------------------------------------------------- Nest (Google Smart Device Management)

function nestConfigured(env) {
  return !!(env.NEST_PROJECT_ID && env.NEST_CLIENT_ID && env.NEST_CLIENT_SECRET && env.NEST_REFRESH_TOKEN);
}

function html(body, status = 200) {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font:17px -apple-system,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5">${body}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nestConnect(request, env) {
  if (!env.NEST_PROJECT_ID || !env.NEST_CLIENT_ID) {
    return html("<h2>Almost there</h2><p>Add <code>NEST_PROJECT_ID</code> and <code>NEST_CLIENT_ID</code> to the Worker first.</p>", 400);
  }
  const redirect = new URL("/nest/callback", request.url).toString();
  const auth = new URL(`https://nestservices.google.com/partnerconnections/${encodeURIComponent(env.NEST_PROJECT_ID)}/auth`);
  auth.search = new URLSearchParams({
    redirect_uri: redirect,
    access_type: "offline",
    prompt: "consent",
    client_id: env.NEST_CLIENT_ID,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/sdm.service",
  }).toString();
  return Response.redirect(auth.toString(), 302);
}

async function nestCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return html(`<h2>Sign-in didn't finish</h2><p>${escapeHtml(url.searchParams.get("error") || "No code returned.")}</p>`, 400);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.NEST_CLIENT_ID,
      client_secret: env.NEST_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: new URL("/nest/callback", request.url).toString(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    return html(`<h2>Couldn't get a token</h2><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`, 502);
  }
  return html(
    `<h2>Connected ✅</h2><p>Copy this into the Worker as a <b>Secret</b> named <code>NEST_REFRESH_TOKEN</code>, then deploy. ` +
      `Treat it like a password and close this tab when you're done.</p>` +
      `<textarea readonly style="width:100%;height:120px;font:14px monospace" onclick="this.select()">${escapeHtml(data.refresh_token)}</textarea>`
  );
}

// Access tokens last an hour; keep one per Worker instance.
let nestToken = null;
async function nestAccessToken(env) {
  if (nestToken && nestToken.expires > Date.now() + 60e3) return nestToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.NEST_CLIENT_ID,
      client_secret: env.NEST_CLIENT_SECRET,
      refresh_token: env.NEST_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in ${res.status} (re-run /nest/connect if this persists)`);
  const data = await res.json();
  nestToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return nestToken.value;
}

async function sdm(env, path, init = {}) {
  const res = await fetch(SDM + path, {
    ...init,
    headers: { Authorization: `Bearer ${await nestAccessToken(env)}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`Nest ${res.status}: ${(detail && detail.error && detail.error.message) || path}`);
  }
  return res.json();
}

async function nestThermostats(env) {
  if (!nestConfigured(env)) return null;
  const { devices = [] } = await sdm(env, `/enterprises/${encodeURIComponent(env.NEST_PROJECT_ID)}/devices`);
  return devices
    .filter((d) => d.type === "sdm.devices.types.THERMOSTAT")
    .map((d) => {
      const t = d.traits || {};
      const get = (trait, key) => (t["sdm.devices.traits." + trait] || {})[key];
      const room = (d.parentRelations && d.parentRelations[0] && d.parentRelations[0].displayName) || "";
      const eco = get("ThermostatEco", "mode") === "MANUAL_ECO";
      return {
        id: d.name,
        name: get("Info", "customName") || room || "Thermostat",
        online: get("Connectivity", "status") !== "OFFLINE",
        ambientC: get("Temperature", "ambientTemperatureCelsius"),
        humidity: get("Humidity", "ambientHumidityPercent"),
        mode: get("ThermostatMode", "mode") || "OFF", // HEAT, COOL, HEATCOOL, OFF
        modes: get("ThermostatMode", "availableModes") || ["HEAT", "COOL", "HEATCOOL", "OFF"],
        ecoAvailable: (get("ThermostatEco", "availableModes") || []).includes("MANUAL_ECO"),
        hvac: get("ThermostatHvac", "status") || "OFF", // HEATING, COOLING, OFF
        eco,
        heatC: eco ? get("ThermostatEco", "heatCelsius") : get("ThermostatTemperatureSetpoint", "heatCelsius"),
        coolC: eco ? get("ThermostatEco", "coolCelsius") : get("ThermostatTemperatureSetpoint", "coolCelsius"),
      };
    });
}

function checkThermostatId(env, id) {
  if (!nestConfigured(env)) throw new Error("Nest isn't configured");
  const prefix = `enterprises/${env.NEST_PROJECT_ID}/devices/`;
  if (typeof id !== "string" || !id.startsWith(prefix) || id.includes("..")) throw new Error("bad thermostat id");
}

function nestCommand(env, id, command, params) {
  return sdm(env, `/${id}:executeCommand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "sdm.devices.commands." + command, params }),
  });
}

// Heat / Cool / Heat·Cool / Off, or "ECO" for Nest's Eco temperatures. Picking a
// regular mode while Eco is on turns Eco off first, like the Nest app does.
async function nestMode(env, id, mode) {
  checkThermostatId(env, id);
  if (mode === "ECO") return nestCommand(env, id, "ThermostatEco.SetMode", { mode: "MANUAL_ECO" });
  if (!["HEAT", "COOL", "HEATCOOL", "OFF"].includes(mode)) throw new Error("bad mode");
  const device = await sdm(env, `/${id}`);
  const traits = device.traits || {};
  if ((traits["sdm.devices.traits.ThermostatEco"] || {}).mode === "MANUAL_ECO") {
    await nestCommand(env, id, "ThermostatEco.SetMode", { mode: "OFF" });
  }
  if ((traits["sdm.devices.traits.ThermostatMode"] || {}).mode !== mode) {
    await nestCommand(env, id, "ThermostatMode.SetMode", { mode });
  }
}

async function nestSetpoint(env, id, heatC, coolC) {
  checkThermostatId(env, id);
  const ok = (v) => typeof v === "number" && v >= 5 && v <= 35; // °C — Nest's own range is about 9–32
  let command, params;
  if (ok(heatC) && ok(coolC)) {
    command = "SetRange";
    params = { heatCelsius: heatC, coolCelsius: coolC };
  } else if (ok(heatC)) {
    command = "SetHeat";
    params = { heatCelsius: heatC };
  } else if (ok(coolC)) {
    command = "SetCool";
    params = { coolCelsius: coolC };
  } else {
    throw new Error("bad temperature");
  }
  await nestCommand(env, id, "ThermostatTemperatureSetpoint." + command, params);
}

// ---------------------------------------------------------------- Calendar

// `keep` optionally narrows which VEVENTs get expanded (see countdowns).
async function calendar(env, days, keep) {
  const tz = env.HOME_TZ || "America/Chicago";
  const cals = JSON.parse(env.CALENDARS || "[]");

  const today = wallParts(new Date(), tz);
  const start = { y: today.y, m: today.m, d: today.d, h: 0, mi: 0, s: 0 };

  const results = await Promise.all(
    cals.map(async (cal) => {
      try {
        const res = await fetch(cal.url, { cf: { cacheTtl: 120 } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = expandCalendar(await res.text(), start, days, tz, keep);
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

// Countdowns: anything with ⏳ or the word "countdown" in its title, plus all-day
// birthdays, looking a year ahead. Only matching events are expanded, so the long
// window stays cheap. The iPad decides which birthdays are family.
const COUNTDOWN_RE = /⏳|\bcountdown\b/i;
const BIRTHDAY_RE = /birthday|\bb-?day\b/i;

async function countdowns(env) {
  const data = await calendar(env, 366, (ev) =>
    COUNTDOWN_RE.test(ev.summary || "") || (ev.start.allDay && BIRTHDAY_RE.test(ev.summary || ""))
  );
  // Just the next occurrence of each (a weekly tagged event shouldn't fill the list).
  const seen = new Set();
  const events = data.events.filter((e) => {
    if (seen.has(e.title)) return false;
    seen.add(e.title);
    return true;
  }).map((e) => ({ title: e.title, allDay: e.allDay, start: e.start, end: e.end }));
  return { errors: data.errors, events };
}

// Expand one ICS document into event instances overlapping the `days` days
// starting at wall-clock date `startDay` in `tz`. Output times are wall-clock
// strings in `tz` ("2026-10-06T09:00"), or dates ("2026-10-06") for all-day
// events, so the iPad never has to do tz math.
function expandCalendar(text, startDay, days, tz, keep) {
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
    if (!ev.start || (keep && !keep(ev))) continue;
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
