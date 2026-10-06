// Home Hub — front end. Plain JS, no build step, written for Safari 15 on an iPad Air 2.
(function () {
  "use strict";

  // ------------------------------------------------------------- settings

  var DEFAULTS = {
    workerUrl: "",
    hubKey: "",
    placeName: "Evanston",
    lat: "42.0451",
    lon: "-87.6877",
    nightStart: "22",
    nightEnd: "6",
    days: "5",
  };
  var STORE = "homehub.settings";

  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) {}
    var s = {};
    for (var k in DEFAULTS) s[k] = saved[k] != null && saved[k] !== "" ? String(saved[k]) : DEFAULTS[k];
    // Allow saved-but-blank backend fields (demo mode).
    s.workerUrl = saved.workerUrl || "";
    s.hubKey = saved.hubKey || "";
    return s;
  }

  function saveSettings(s) {
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {}
  }

  // One-time setup link: …/hub/#worker=https://…&key=… saves and then strips itself,
  // so you don't have to type a long key on the iPad keyboard.
  (function importFromHash() {
    if (location.hash.length < 2) return;
    var params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("worker") && !params.has("key")) return;
    var s = loadSettings();
    if (params.has("worker")) s.workerUrl = params.get("worker");
    if (params.has("key")) s.hubKey = params.get("key");
    saveSettings(s);
    history.replaceState(null, "", location.pathname);
  })();

  var settings = loadSettings();
  var demo = !settings.workerUrl;

  // ------------------------------------------------------------- utilities

  var $ = function (id) { return document.getElementById(id); };
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
  function parseWall(s) {
    // "2026-10-06T09:00" or "2026-10-06" → local Date (the iPad lives in the same tz as the family).
    var p = s.split(/[-T:]/).map(Number);
    return new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0);
  }
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    var h12 = h % 12 || 12;
    return h12 + (m ? ":" + pad(m) : "") + (h < 12 ? "a" : "p");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function api(path, opts) {
    opts = opts || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    var headers = { "X-Hub-Key": settings.hubKey };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(settings.workerUrl.replace(/\/+$/, "") + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error(path + " → HTTP " + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ------------------------------------------------------------- status line

  var problems = {};
  var lastSync = null;
  function setProblem(key, msg) {
    if (msg) problems[key] = msg; else delete problems[key];
    renderStatus();
  }
  function renderStatus() {
    var keys = Object.keys(problems);
    var t = $("status-text");
    t.className = keys.length ? "warn" : "";
    if (keys.length) t.textContent = "Trouble with " + keys.map(function (k) { return k + " (" + problems[k] + ")"; }).join(", ");
    else if (demo) t.textContent = "Demo data — tap ⚙︎ to connect your calendar and Todoist";
    else t.textContent = lastSync ? "Updated " + fmtTime(lastSync) : "Loading…";
  }

  // ------------------------------------------------------------- clock + night mode

  var wakeUntil = 0;
  function isNightHour(h) {
    var a = +settings.nightStart, b = +settings.nightEnd;
    if (a === b) return false;
    return a < b ? h >= a && h < b : h >= a || h < b;
  }

  function tickClock() {
    var now = new Date();
    var h = now.getHours();
    var timeText = (h % 12 || 12) + ":" + pad(now.getMinutes());
    var t = $("time");
    t.textContent = timeText;
    t.appendChild(el("span", "ampm", h < 12 ? "AM" : "PM"));
    $("date").textContent = DAY_NAMES[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " + now.getDate();

    var night = isNightHour(h) && Date.now() > wakeUntil && $("settings").hidden;
    $("night").hidden = !night;
    if (night) {
      $("night-time").textContent = timeText;
      $("night-next").textContent = nextEventLine(now);
    }

    // Reload once a night to keep an old iPad's memory tidy and pick up code updates.
    if (h === 3 && now.getMinutes() === 30 && performance.now() > 120000) location.reload();
  }

  $("night").addEventListener("click", function () {
    wakeUntil = Date.now() + 2 * 60 * 1000;
    tickClock();
  });

  // ------------------------------------------------------------- weather (Open-Meteo, no key)

  var WMO = {
    0: ["☀️", "Clear"], 1: ["🌤", "Mostly clear"], 2: ["⛅️", "Partly cloudy"], 3: ["☁️", "Cloudy"],
    45: ["🌫", "Fog"], 48: ["🌫", "Freezing fog"],
    51: ["🌦", "Light drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌧", "Heavy drizzle"],
    56: ["🌧", "Freezing drizzle"], 57: ["🌧", "Freezing drizzle"],
    61: ["🌦", "Light rain"], 63: ["🌧", "Rain"], 65: ["🌧", "Heavy rain"],
    66: ["🌧", "Freezing rain"], 67: ["🌧", "Freezing rain"],
    71: ["🌨", "Light snow"], 73: ["🌨", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨", "Snow grains"],
    80: ["🌦", "Showers"], 81: ["🌧", "Showers"], 82: ["⛈", "Heavy showers"],
    85: ["🌨", "Snow showers"], 86: ["❄️", "Snow showers"],
    95: ["⛈", "Thunderstorms"], 96: ["⛈", "T-storms + hail"], 99: ["⛈", "T-storms + hail"],
  };
  function wmo(code, isDay) {
    var w = WMO[code] || ["🌡", ""];
    if (!isDay && (code === 0 || code === 1)) return ["🌙", w[1]];
    return w;
  }

  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(settings.lat) +
      "&longitude=" + encodeURIComponent(settings.lon) +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var c = d.current, day = d.daily;
        var now = wmo(c.weather_code, c.is_day);
        var box = $("weather");
        box.innerHTML = "";

        var tomorrow = el("div", "wx-tomorrow");
        tomorrow.appendChild(el("div", null, "Tomorrow"));
        tomorrow.appendChild(el("div", null, wmo(day.weather_code[1], 1)[0] + " " +
          Math.round(day.temperature_2m_max[1]) + "° / " + Math.round(day.temperature_2m_min[1]) + "°"));
        tomorrow.appendChild(el("div", null, day.precipitation_probability_max[1] + "% precip"));

        var detail = el("div", "wx-detail");
        var line1 = el("div");
        line1.appendChild(el("b", null, now[1]));
        line1.appendChild(document.createTextNode(" · feels " + Math.round(c.apparent_temperature) + "°"));
        detail.appendChild(line1);
        detail.appendChild(el("div", null, "H " + Math.round(day.temperature_2m_max[0]) + "°  L " +
          Math.round(day.temperature_2m_min[0]) + "° · " + day.precipitation_probability_max[0] + "% precip"));
        detail.appendChild(el("div", null, settings.placeName + " · wind " + Math.round(c.wind_speed_10m) + " mph"));

        var nowBox = el("div", "wx-now");
        nowBox.appendChild(el("span", "wx-icon", now[0]));
        nowBox.appendChild(el("span", "wx-temp", Math.round(c.temperature_2m) + "°"));

        box.appendChild(detail);
        box.appendChild(nowBox);
        box.appendChild(tomorrow);
        setProblem("weather", null);
      })
      .catch(function (e) { setProblem("weather", e.message); });
  }

  // ------------------------------------------------------------- calendar

  var events = [];

  function loadCalendar() {
    var days = Math.max(1, Math.min(14, +settings.days || 5));
    var p = demo ? Promise.resolve(demoCalendar()) : api("/calendar?days=" + days);
    return p.then(function (data) {
      events = data.events.map(function (e) {
        return {
          title: e.title, location: e.location, allDay: e.allDay, color: e.color, calendar: e.calendar,
          start: parseWall(e.start), end: parseWall(e.end || e.start),
        };
      });
      renderAgenda();
      tickClock(); // refresh the night screen's "Next:" line
      setProblem("calendar", data.errors && data.errors.length ? data.errors.join("; ") : null);
    }).catch(function (e) { setProblem("calendar", e.message); });
  }

  function renderAgenda() {
    var box = $("agenda");
    box.innerHTML = "";
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.max(1, Math.min(14, +settings.days || 5));

    for (var i = 0; i < days; i++) {
      var day = addDays(today, i);
      var next = addDays(today, i + 1);
      var todays = events.filter(function (e) {
        return e.allDay ? e.start < next && e.end > day : e.start >= day && e.start < next;
      }).sort(function (a, b) { return (b.allDay - a.allDay) || (a.start - b.start); });

      var wrap = el("div", "day");
      var name = el("h3", "day-name", i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAY_NAMES[day.getDay()]);
      name.appendChild(el("span", null, MONTHS[day.getMonth()].slice(0, 3) + " " + day.getDate()));
      wrap.appendChild(name);

      if (!todays.length) wrap.appendChild(el("div", "day-empty", i === 0 ? "Nothing on the calendar" : "Free"));
      todays.forEach(function (e) {
        var row = el("div", "event");
        if (!e.allDay && e.end <= now) row.className += " past";
        if (!e.allDay && e.start <= now && e.end > now) row.className += " now";
        var dot = el("span", "dot");
        if (e.color) dot.style.background = e.color;
        row.appendChild(dot);
        row.appendChild(el("span", "when", e.allDay ? "All day" : fmtTime(e.start)));
        var what = el("span", "what", e.title);
        if (e.location) what.appendChild(el("span", "where", e.location));
        row.appendChild(what);
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    }
  }

  function nextEventLine(now) {
    var tomorrowEnd = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 2);
    var next = events.filter(function (e) { return !e.allDay && e.start > now && e.start < tomorrowEnd; })
      .sort(function (a, b) { return a.start - b.start; })[0];
    if (!next) return "";
    var isToday = next.start.getDate() === now.getDate();
    return "Next: " + next.title + " · " + (isToday ? "" : "tomorrow ") + fmtTime(next.start);
  }

  // ------------------------------------------------------------- Todoist lists

  var lists = { chores: [], grocery: [] };

  var demoLoaded = false;
  function loadLists() {
    if (demo && demoLoaded) return Promise.resolve(); // keep demo taps from resetting
    demoLoaded = demo;
    var p = demo ? Promise.resolve(demoLists()) : api("/todoist/lists");
    return p.then(function (data) {
      lists.chores = data.chores || [];
      lists.grocery = data.grocery || [];
      renderList("chores");
      renderList("grocery");
      var missing = [];
      if (data.chores === null) missing.push("Chores");
      if (data.grocery === null) missing.push("Groceries");
      setProblem("todoist", missing.length ? "no project named " + missing.join(" / ") : null);
    }).catch(function (e) { setProblem("todoist", e.message); });
  }

  function visibleChores() {
    // Show chores due today, overdue, or undated. Completing a recurring chore pushes
    // its due date forward in Todoist, so it drops off until it's due again.
    var today = ymd(new Date());
    return lists.chores.filter(function (t) { return !t.due || t.due.slice(0, 10) <= today; });
  }

  function renderList(name) {
    var items = name === "chores" ? visibleChores() : lists.grocery;
    var ul = $(name);
    ul.innerHTML = "";
    $(name + "-count").textContent = items.length ? items.length : "";
    if (!items.length) {
      ul.appendChild(el("li", "empty", name === "chores" ? "All caught up 🎉" : "List is empty"));
      return;
    }
    var today = ymd(new Date());
    items.forEach(function (t) {
      var li = el("li", "task");
      li.appendChild(el("span", "box"));
      li.appendChild(el("span", "label", t.content));
      if (name === "chores" && t.due && t.due.slice(0, 10) < today) li.appendChild(el("span", "due", "overdue"));
      li.addEventListener("click", function () { completeTask(name, t, li); });
      ul.appendChild(li);
    });
  }

  function completeTask(name, task, li) {
    if (li.classList.contains("done")) return;
    li.classList.add("done");
    li.querySelector(".box").textContent = "✓";
    var p = demo ? Promise.resolve() : api("/todoist/close", { method: "POST", body: { id: task.id } });
    p.then(function () {
      setTimeout(function () { li.classList.add("leaving"); }, 900);
      setTimeout(function () {
        if (demo || !task.recurring) {
          lists[name] = lists[name].filter(function (t) { return t !== task; });
          renderList(name);
        } else {
          loadLists(); // recurring chore: fetch its new due date
        }
      }, 1400);
    }).catch(function (e) {
      li.classList.remove("done");
      li.querySelector(".box").textContent = "";
      setProblem("todoist", e.message);
    });
  }

  $("grocery-add").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("grocery-input");
    var content = input.value.trim();
    if (!content) return;
    input.value = "";
    input.blur();
    var p = demo
      ? Promise.resolve({ id: "demo-" + Date.now(), content: content })
      : api("/todoist/add", { method: "POST", body: { list: "grocery", content: content } });
    p.then(function (task) {
      lists.grocery.push(task);
      renderList("grocery");
    }).catch(function (e) {
      input.value = content;
      setProblem("todoist", e.message);
    });
  });

  // ------------------------------------------------------------- settings modal

  function openSettings() {
    var f = $("settings-form");
    for (var k in DEFAULTS) if (f.elements[k]) f.elements[k].value = settings[k];
    $("settings").hidden = false;
  }
  $("open-settings").addEventListener("click", openSettings);
  $("settings-cancel").addEventListener("click", function () { $("settings").hidden = true; });
  $("settings-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target, s = {};
    for (var k in DEFAULTS) s[k] = f.elements[k] ? f.elements[k].value.trim() : settings[k];
    saveSettings(s);
    location.reload();
  });

  // ------------------------------------------------------------- demo data

  function demoCalendar() {
    var d = new Date();
    function at(dayOffset, h, m) {
      var x = addDays(d, dayOffset);
      return ymd(x) + "T" + pad(h) + ":" + pad(m || 0);
    }
    return {
      events: [
        { title: "School pickup", start: at(0, 15, 15), end: at(0, 15, 45), color: "#c8553d" },
        { title: "Soccer practice", location: "Lovelace Park", start: at(0, 17, 0), end: at(0, 18, 30), color: "#4f8cff" },
        { title: "Trash & recycling out", start: at(0, 19, 30), end: at(0, 19, 45), color: "#7a9e7e" },
        { title: "Garbage pickup", allDay: true, start: ymd(addDays(d, 1)), end: ymd(addDays(d, 2)), color: "#7a9e7e" },
        { title: "Dentist", location: "Central St.", start: at(1, 9, 30), end: at(1, 10, 30), color: "#c8553d" },
        { title: "Date night", start: at(2, 19, 0), end: at(2, 21, 30), color: "#b07cc6" },
        { title: "Cubs watch party", start: at(3, 18, 5), end: at(3, 21, 0), color: "#4f8cff" },
        { title: "Farmers market", start: at(4, 8, 0), end: at(4, 10, 0), color: "#7a9e7e" },
      ],
    };
  }

  function demoLists() {
    var today = ymd(new Date()), yesterday = ymd(addDays(new Date(), -1));
    return {
      chores: [
        { id: "c1", content: "Empty the dishwasher", due: today },
        { id: "c2", content: "Feed the dog", due: today },
        { id: "c3", content: "Water the plants", due: yesterday },
        { id: "c4", content: "Take out recycling", due: today },
      ],
      grocery: [
        { id: "g1", content: "Milk" },
        { id: "g2", content: "Eggs" },
        { id: "g3", content: "Bananas" },
        { id: "g4", content: "Coffee beans" },
      ],
    };
  }

  // ------------------------------------------------------------- boot + refresh loop

  function refreshAll() {
    return Promise.all([loadWeather(), loadCalendar(), loadLists()]).then(function () {
      lastSync = new Date();
      renderStatus();
    });
  }

  renderStatus();
  tickClock();
  refreshAll();

  setInterval(tickClock, 1000 * 10);
  setInterval(loadLists, 60 * 1000);
  setInterval(loadCalendar, 5 * 60 * 1000);
  setInterval(loadWeather, 15 * 60 * 1000);
  setInterval(function () { renderAgenda(); renderStatus(); }, 60 * 1000); // keep "now"/"past" styling current
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAll(); });
})();
