// The Study — the office TV board in mahogany and brass. Plain JS, no build step.
// Same Worker and same one-time setup link as ../tv/ (they share their settings):
//   …/hub/study/#worker=https://…&key=…&work=8-18&on=7-20
// The remote's play/pause and skip buttons drive Spotify; any button wakes it after hours.
(function () {
  "use strict";

  // ------------------------------------------------------------- settings

  var DEFAULTS = { workerUrl: "", hubKey: "", placeName: "Lake Forest", lat: "42.2586", lon: "-87.8406", work: "8-18", on: "7-20" };
  var STORE = "homehub.tv.settings";
  var HASH_KEYS = { worker: "workerUrl", key: "hubKey", place: "placeName", lat: "lat", lon: "lon", work: "work", on: "on" };

  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) {}
    var s = {};
    for (var k in DEFAULTS) s[k] = saved[k] != null && saved[k] !== "" ? String(saved[k]) : DEFAULTS[k];
    return s;
  }

  (function importFromHash() {
    if (location.hash.length < 2) return;
    var params = new URLSearchParams(location.hash.slice(1));
    var s = loadSettings(), any = false;
    for (var p in HASH_KEYS) if (params.has(p)) { s[HASH_KEYS[p]] = params.get(p); any = true; }
    if (!any) return;
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  })();

  var settings = loadSettings();
  var demo = !settings.workerUrl;

  function hours(range, fallback) {
    var m = /^(\d{1,2})-(\d{1,2})$/.exec(range || "");
    return m && +m[1] < +m[2] && +m[2] <= 24 ? [+m[1], +m[2]] : fallback;
  }
  var WORK = hours(settings.work, [8, 18]);
  var ON = hours(settings.on, [7, 20]);

  // ------------------------------------------------------------- utilities

  var $ = function (id) { return document.getElementById(id); };
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MIN = 60 * 1000, HOUR = 60 * MIN, DAY_MS = 24 * HOUR;
  var SVG = "http://www.w3.org/2000/svg";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function at(day, h) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h); }
  function parseWall(s) {
    var p = s.split(/[-T:]/).map(Number);
    return new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0);
  }
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? "a" : "p");
  }
  // "2:00 pm", for prose
  function fmtClock(d) {
    var h = d.getHours();
    return (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " am" : " pm");
  }
  function fmtSpan(ms) {
    var m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? h + "h" + (m % 60 ? " " + (m % 60) + "m" : "") : m + "m";
  }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function api(path, opts) {
    opts = opts || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    var headers = { "X-Hub-Key": settings.hubKey };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(settings.workerUrl.replace(/\/+$/, "") + path, {
      method: opts.method || "GET", headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal, cache: "no-store",
    }).then(function (res) {
      clearTimeout(timer);
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(path + " → HTTP " + res.status + (body && body.error ? ": " + body.error : ""));
      });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // Drop rows cut off at the bottom of their box (offsets are from #stage, in unscaled px).
  function trimOverflow(box) {
    var limit = box.offsetTop + box.clientHeight;
    for (var i = box.children.length - 1; i > 0; i--) {
      var c = box.children[i];
      if (c.offsetTop + c.offsetHeight <= limit) break;
      box.removeChild(c);
    }
  }

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var x = (window.innerWidth - 1920 * s) / 2, y = (window.innerHeight - 1080 * s) / 2;
    $("stage").style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ------------------------------------------------------------- status line

  var problems = {}, lastSync = null;
  function setProblem(key, msg) {
    if (msg) problems[key] = msg; else { delete problems[key]; lastSync = new Date(); }
    renderStatus();
  }
  function renderStatus() {
    var keys = Object.keys(problems), t = $("status-text");
    t.className = "status" + (keys.length ? " warn" : "");
    if (keys.length) t.textContent = "Trouble with " + keys.map(function (k) { return k + " (" + problems[k] + ")"; }).join(", ");
    else if (demo) t.textContent = "Demo data · open this page once with #worker=…&key=… to connect";
    else t.textContent = lastSync ? "Updated " + fmtTime(lastSync) : "Loading…";
  }

  // ------------------------------------------------------------- split-flap cells
  // A row of letter cards. Changing the text riffles each changed card through a few
  // letters before it lands, like the old Solari boards in train stations.

  var FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  function clean(text, len, right) {
    var s = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
      .replace(/[^A-Z0-9 :.\-&'\/@+!?,#]/g, " ").replace(/\s+/g, " ").trim();
    // Too long: break at a word if that keeps most of it.
    if (s.length > len) { var cut = s.lastIndexOf(" ", len); s = s.slice(0, cut > len * 0.55 ? cut : len); }
    while (s.length < len) s = right ? " " + s : s + " ";
    return s;
  }

  function Flaps(box, len, right) {
    box.innerHTML = "";
    var cells = [], shown = [];
    for (var i = 0; i < len; i++) {
      var c = el("span", "fl");
      var ch = el("span", "ch", " ");
      c.appendChild(ch);
      box.appendChild(c);
      cells.push(c);
      shown.push(" ");
    }
    function land(i, target) {
      var steps = 1 + Math.floor(Math.random() * 3);
      var tick = function () {
        var c = cells[i];
        var next = steps-- > 0 ? FLAP_CHARS[1 + Math.floor(Math.random() * (FLAP_CHARS.length - 1))] : target;
        c.classList.remove("flip");
        void c.offsetWidth; // restart the animation
        c.classList.add("flip");
        setTimeout(function () { c.firstChild.textContent = next; }, 55);
        if (next !== target) setTimeout(tick, 110);
      };
      setTimeout(tick, i * 18);
    }
    return {
      set: function (text) {
        var s = clean(text, len, right);
        for (var i = 0; i < len; i++) {
          if (s[i] === shown[i]) continue;
          shown[i] = s[i];
          land(i, s[i]);
        }
      },
    };
  }

  // ------------------------------------------------------------- brass clock

  var hands = {};
  (function buildClock() {
    var c = $("clock");
    var defs = svgEl("defs", {});
    var g = svgEl("radialGradient", { id: "faceGrad", cx: "45%", cy: "40%", r: "65%" });
    g.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#fbf4e2" }));
    g.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#dfcfa6" }));
    defs.appendChild(g);
    c.appendChild(defs);
    c.appendChild(svgEl("circle", { cx: 150, cy: 150, r: 150, class: "face" }));
    for (var i = 0; i < 60; i++) {
      var hr = i % 5 === 0;
      var t = svgEl("line", { x1: 150, y1: hr ? 12 : 12, x2: 150, y2: hr ? 26 : 19, class: "tick" + (hr ? " hour" : ""), transform: "rotate(" + i * 6 + " 150 150)" });
      c.appendChild(t);
    }
    var ROMAN = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    for (var h = 0; h < 12; h++) {
      var a = (h * 30 - 90) * Math.PI / 180;
      var n = svgEl("text", { x: 150 + 104 * Math.cos(a), y: 150 + 104 * Math.sin(a), class: "num" });
      n.textContent = ROMAN[h];
      if (ROMAN[h].length > 2) n.setAttribute("style", "font-size:19px");
      c.appendChild(n);
    }
    var maker = svgEl("text", { x: 150, y: 205, class: "maker" });
    maker.textContent = "Lake Forest";
    c.appendChild(maker);
    hands.hour = svgEl("path", { d: "M146 162 L148 92 Q150 78 152 92 L154 162 Z", class: "hand" });
    hands.min = svgEl("path", { d: "M147.5 166 L149 50 Q150 40 151 50 L152.5 166 Z", class: "hand" });
    hands.sec = svgEl("line", { x1: 150, y1: 176, x2: 150, y2: 36, class: "second" });
    c.appendChild(hands.hour);
    c.appendChild(hands.min);
    c.appendChild(hands.sec);
    c.appendChild(svgEl("circle", { cx: 150, cy: 150, r: 7, class: "cap" }));
  })();

  function renderClock(now) {
    var s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    hands.hour.setAttribute("transform", "rotate(" + h * 30 + " 150 150)");
    hands.min.setAttribute("transform", "rotate(" + m * 6 + " 150 150)");
    hands.sec.setAttribute("transform", "rotate(" + s * 6 + " 150 150)");
    $("day-name").textContent = DAY_NAMES[now.getDay()];
    var dl = $("date-line");
    dl.textContent = "The " + ordinal(now.getDate()) + " of " + MONTHS[now.getMonth()];
    dl.appendChild(el("b", null, fmtClock(now)));
  }

  // ------------------------------------------------------------- after hours + remote

  var wakeUntil = 0, wasNight = null, shownDay = ymd(new Date());

  function tick() {
    var now = new Date(), h = now.getHours();
    renderClock(now);
    renderPrecipAlert(now);
    renderBanner(now);
    if (ymd(now) !== shownDay) { shownDay = ymd(now); loadCalendar(); loadWeather(); }

    var night = (h < ON[0] || h >= ON[1]) && Date.now() > wakeUntil && !sportsLive();
    $("night").hidden = !night;
    if (night) {
      $("night-time").textContent = (h % 12 || 12) + ":" + pad(now.getMinutes());
      $("night-next").textContent = nextEventLine(now);
    }
    if (night !== wasNight) {
      wasNight = night;
      try { if (window.HubTV && window.HubTV.keepAwake) window.HubTV.keepAwake(!night); } catch (e) {}
    }
    if (h === 3 && now.getMinutes() === 30 && performance.now() > 120000) freshReload(window.HUB_VERSION || "");
  }

  var MEDIA_KEYS = {
    MediaPlayPause: "toggle", MediaPlay: "play", MediaPause: "pause",
    MediaTrackNext: "next", MediaFastForward: "next",
    MediaTrackPrevious: "previous", MediaRewind: "previous",
  };
  var MEDIA_CODES = { 179: "toggle", 176: "next", 177: "previous" };

  document.addEventListener("keydown", function (ev) {
    var action = MEDIA_KEYS[ev.key] || MEDIA_CODES[ev.keyCode];
    if (!$("night").hidden) { wakeUntil = Date.now() + 5 * MIN; tick(); ev.preventDefault(); return; }
    if (action) { ev.preventDefault(); spotifyControl(action); }
  });

  var toastTimer = null;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  // ------------------------------------------------------------- the almanac: weather, sky, air

  // Engraving-style line icons, so the almanac doesn't depend on the TV's emoji font.
  var ICONS = {
    sun: '<circle cx="24" cy="24" r="8"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>',
    moon: '<path d="M31 9a15 15 0 1 0 8 25A13 13 0 0 1 31 9z"/>',
    cloud: '<path d="M14 36h21a8 8 0 0 0 0-16 11 11 0 0 0-21 2.5A6.8 6.8 0 0 0 14 36z"/>',
    partly: '<circle cx="17" cy="17" r="6"/><path d="M17 5v3M5 17h3M8.5 8.5l2.1 2.1M25.5 8.5l-2.1 2.1"/><path d="M17 38h18a7 7 0 0 0 0-14 9.5 9.5 0 0 0-18 2.2A5.9 5.9 0 0 0 17 38z"/>',
    rain: '<path d="M14 30h21a8 8 0 0 0 0-16 11 11 0 0 0-21 2.5A6.8 6.8 0 0 0 14 30z"/><path d="M17 35l-2 6M25 35l-2 6M33 35l-2 6"/>',
    snow: '<path d="M14 30h21a8 8 0 0 0 0-16 11 11 0 0 0-21 2.5A6.8 6.8 0 0 0 14 30z"/><path d="M16 37v4M14 39h4M25 36v4M23 38h4M34 37v4M32 39h4"/>',
    storm: '<path d="M14 30h21a8 8 0 0 0 0-16 11 11 0 0 0-21 2.5A6.8 6.8 0 0 0 14 30z"/><path d="M25 31l-5 8h6l-4 7"/>',
    fog: '<path d="M8 18h32M12 25h28M8 32h30M14 39h20"/>',
  };
  var WMO_TEXT = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Snow showers", 95: "Thunderstorms", 96: "Storms with hail", 99: "Storms with hail",
  };
  function iconKind(code, isDay) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code === 3) return "cloud";
    if (code === 2) return "partly";
    return isDay ? "sun" : "moon";
  }
  function icon(kind, cls) {
    var span = el("span", cls);
    span.innerHTML = '<svg class="wx" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + ICONS[kind] + "</svg>";
    return span.firstChild;
  }

  // Moon phase from the mean synodic month, counted from the new moon of 6 Jan 2000 18:14 UTC.
  function moonPhase(now) {
    var p = ((now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS / 29.530588853) % 1;
    if (p < 0) p += 1;
    var name = p < 0.03 || p > 0.97 ? "New moon" : p < 0.22 ? "Waxing crescent" : p < 0.28 ? "First quarter"
      : p < 0.47 ? "Waxing gibbous" : p < 0.53 ? "Full moon" : p < 0.72 ? "Waning gibbous" : p < 0.78 ? "Last quarter" : "Waning crescent";
    return { p: p, name: name, lit: Math.round(50 * (1 - Math.cos(2 * Math.PI * p))) };
  }
  // The lit part: a half disc on the lit side, closed by half an ellipse (the terminator).
  function moonSvg(p) {
    var r = 30, cx = 38, cy = 38, rx = Math.abs(Math.cos(2 * Math.PI * p)) * r;
    var waxing = p < 0.5;
    var outer = waxing ? 1 : 0;
    var inner = waxing ? (p < 0.25 ? 0 : 1) : (p < 0.75 ? 0 : 1);
    var d = "M" + cx + " " + (cy - r) + " A" + r + " " + r + " 0 0 " + outer + " " + cx + " " + (cy + r) +
      " A" + rx.toFixed(2) + " " + r + " 0 0 " + inner + " " + cx + " " + (cy - r) + " Z";
    return '<svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="30" fill="#2b2118"/>' +
      (p < 0.03 || p > 0.97 ? "" : '<path d="' + d + '" fill="#f6eed6"/>') +
      '<circle cx="38" cy="38" r="30" fill="none" stroke="#1d140e" stroke-width="1.5"/></svg>';
  }

  var wx = null, aqi = null;

  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(settings.lat) +
      "&longitude=" + encodeURIComponent(settings.lon) +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      "&hourly=precipitation_probability&minutely_15=precipitation,snowfall&forecast_minutely_15=8" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { wx = d; storePrecip(d); renderAlmanac(); setProblem("weather", null); })
      .catch(function (e) { setProblem("weather", e.message); });
  }

  function loadAirQuality() {
    var url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + encodeURIComponent(settings.lat) +
      "&longitude=" + encodeURIComponent(settings.lon) + "&current=us_aqi&timezone=auto";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { aqi = d.current && typeof d.current.us_aqi === "number" ? Math.round(d.current.us_aqi) : null; renderAlmanac(); })
      .catch(function () { aqi = null; renderAlmanac(); });
  }

  function aqiLevel(v) {
    return v <= 50 ? ["Good", "#00e400"] : v <= 100 ? ["Moderate", "#ffff00"] : v <= 150 ? ["Unhealthy for some", "#ff7e00"]
      : v <= 200 ? ["Unhealthy", "#ff0000"] : v <= 300 ? ["Very unhealthy", "#8f3f97"] : ["Hazardous", "#7e0023"];
  }

  function renderAlmanac() {
    $("alm-place").textContent = settings.placeName;
    if (!wx) return;
    var c = wx.current, day = wx.daily, now = new Date();

    var box = $("alm-now");
    box.innerHTML = "";
    box.appendChild(icon(iconKind(c.weather_code, c.is_day)));
    var temp = el("div", "alm-temp", String(Math.round(c.temperature_2m)));
    temp.appendChild(el("span", "deg", "°"));
    box.appendChild(temp);
    var cond = el("div", "alm-cond");
    cond.appendChild(el("b", null, WMO_TEXT[c.weather_code] || ""));
    cond.appendChild(el("span", null, "Feels like " + Math.round(c.apparent_temperature) + "°"));
    cond.appendChild(el("span", null, "Wind " + Math.round(c.wind_speed_10m) + " mph"));
    box.appendChild(cond);

    var days = $("alm-days");
    days.innerHTML = "";
    for (var i = 0; i < Math.min(5, day.time.length); i++) {
      var cell = el("div", "alm-day");
      cell.appendChild(el("div", "nm", i === 0 ? "Today" : DAY_NAMES[parseWall(day.time[i]).getDay()].slice(0, 3)));
      cell.appendChild(icon(iconKind(day.weather_code[i], true)));
      var t = el("div");
      t.appendChild(el("span", "hi", Math.round(day.temperature_2m_max[i]) + "°"));
      t.appendChild(el("span", "lo", " " + Math.round(day.temperature_2m_min[i]) + "°"));
      cell.appendChild(t);
      var pop = day.precipitation_probability_max[i];
      cell.appendChild(el("div", "pop", pop >= 20 ? pop + "% wet" : ""));
      days.appendChild(cell);
    }

    // Sun, daylight, air, moon.
    var sky = $("alm-sky");
    sky.innerHTML = "";
    var line = function (label, text) {
      var l = el("div", "line");
      l.appendChild(el("i", null, label + " "));
      l.appendChild(document.createTextNode(text));
      sky.appendChild(l);
      return l;
    };
    if (day.sunrise && day.sunset) {
      var rise = parseWall(day.sunrise[0]), set = parseWall(day.sunset[0]);
      if (now < set) line(now < rise ? "Sunrise" : "Sunset", fmtClock(now < rise ? rise : set));
      else if (day.sunrise[1]) line("Sunrise", fmtClock(parseWall(day.sunrise[1])) + " tomorrow");
      var len = set - rise;
      line("Daylight", fmtSpan(len));
      if (day.sunrise[1] && day.sunset[1]) {
        var diff = Math.round((parseWall(day.sunset[1]) - parseWall(day.sunrise[1]) - len) / 1000);
        var a = Math.abs(diff);
        line("Tomorrow", (a >= 60 ? Math.floor(a / 60) + "m " : "") + (a % 60) + "s " + (diff < 0 ? "less" : "more"));
      }
    }
    if (aqi != null) {
      var lvl = aqiLevel(aqi);
      var l = line("Air", "");
      var dot = el("span", "aqi-dot");
      dot.style.background = lvl[1];
      l.appendChild(dot);
      l.appendChild(document.createTextNode(aqi + " · " + lvl[0]));
    }
    var mp = moonPhase(now);
    var moon = el("div", "moon");
    moon.innerHTML = moonSvg(mp.p);
    moon.appendChild(document.createTextNode(mp.name));
    sky.appendChild(moon);
  }

  // ------------------------------------------------------------- rain / snow in the next hour

  var precip = null;

  function storePrecip(d) {
    var m = d.minutely_15, hr = d.hourly;
    precip = {
      tempF: d.current ? d.current.temperature_2m : null,
      slots: m && m.time ? m.time.map(function (t, i) {
        return { end: parseWall(t), mm: m.precipitation[i] || 0, snowCm: m.snowfall ? m.snowfall[i] || 0 : 0 };
      }) : [],
      hours: hr && hr.time ? hr.time.map(function (t, i) { return { start: parseWall(t), prob: hr.precipitation_probability[i] }; }) : [],
    };
    renderPrecipAlert(new Date());
  }

  function precipMessage(now) {
    if (!precip) return null;
    var Q = 15 * MIN, horizon = new Date(now.getTime() + HOUR);
    var slots = precip.slots.filter(function (s) { return s.end > now && s.end - Q < horizon; });
    var wet = function (s) { return s.mm >= 0.1 || s.snowCm >= 0.05; };
    var firstWet = -1;
    for (var i = 0; i < slots.length; i++) if (wet(slots[i])) { firstWet = i; break; }
    if (firstWet >= 0) {
      var run = slots.slice(firstWet);
      var word = run.some(function (s) { return wet(s) && s.snowCm >= 0.05; }) ? "Snow" : "Rain";
      var start = new Date(slots[firstWet].end - Q);
      if (start <= now) {
        for (var j = 0; j < run.length; j++) if (!wet(run[j])) return word + " now · easing by " + fmtTime(run[j - 1].end);
        return word + " falling now";
      }
      return word + " expected about " + fmtTime(start);
    }
    var best = 0;
    precip.hours.forEach(function (hr) {
      if (hr.start < horizon && hr.start.getTime() + HOUR > now.getTime()) best = Math.max(best, hr.prob || 0);
    });
    if (best >= 50) return best + "% chance of " + (precip.tempF != null && precip.tempF <= 34 ? "snow" : "rain") + " this hour";
    return null;
  }

  function renderPrecipAlert(now) {
    var msg = precipMessage(now), box = $("precip-alert");
    box.hidden = !msg;
    if (msg) box.textContent = msg;
  }

  // ------------------------------------------------------------- work calendar

  var events = [];

  function loadCalendar() {
    var p = demo ? Promise.resolve(demoCalendar()) : api("/calendar?days=2&for=tv");
    return p.then(function (data) {
      events = data.events.map(function (e) {
        return { title: e.title || "(No title)", location: e.location, allDay: e.allDay, color: e.color,
          start: parseWall(e.start), end: parseWall(e.end || e.start) };
      });
      renderBoard();
      renderRuler();
      tick();
      setProblem("calendar", data.errors && data.errors.length ? data.errors.join("; ") : null);
    }).catch(function (e) { setProblem("calendar", e.message); });
  }

  function timedEvents() {
    return events.filter(function (e) { return !e.allDay && e.end > e.start; }).sort(function (a, b) { return a.start - b.start; });
  }

  // "Via": the video service, or the room when it's a place.
  function via(loc) {
    if (!loc) return "";
    if (/zoom\.us/i.test(loc)) return "ZOOM";
    if (/meet\.google/i.test(loc)) return "MEET";
    if (/teams\.(microsoft|live)/i.test(loc)) return "TEAMS";
    if (/webex/i.test(loc)) return "WEBEX";
    return /^https?:/i.test(loc) ? "LINK" : loc;
  }

  function nextEventLine(now) {
    var next = timedEvents().filter(function (e) { return e.start > now; })[0];
    if (!next) return "";
    return "Next: " + (next.start < addDays(startOfDay(now), 1) ? "" : "tomorrow, ") + fmtClock(next.start) + " · " + next.title;
  }

  // ------------------------------------------------------------- departures: the big countdown

  var countFlaps = Flaps($("count"), 4, true);

  function renderBanner(now) {
    var timed = timedEvents(), tomorrow = addDays(startOfDay(now), 1);
    var current = timed.filter(function (e) { return e.start <= now && e.end > now; }).pop();
    var upcoming = timed.filter(function (e) { return e.start > now; });
    var next = upcoming[0], nextToday = next && next.start < tomorrow ? next : null;
    var banner = $("banner"), cls = "banner", kicker, title, sub = "", count = null, unit = "";

    var countdown = function (ms) {
      var m = Math.ceil(ms / MIN);
      if (ms <= 5 * MIN) { var s = Math.max(0, Math.ceil(ms / 1000)); count = Math.floor(s / 60) + ":" + pad(s % 60); unit = "min · sec"; }
      else if (m < 60) { count = String(m); unit = "minutes"; }
      else { count = Math.floor(m / 60) + ":" + pad(m % 60); unit = "hr · min"; }
    };

    if (current) {
      cls += " now";
      kicker = "In progress";
      title = current.title;
      countdown(current.end - now);
      unit = unit.replace("minutes", "min left");
      sub = "Until " + fmtClock(current.end) + (via(current.location) ? " · " + via(current.location) : "") +
        (nextToday ? " · then " + fmtTime(nextToday.start) + " " + nextToday.title : "");
    } else if (nextToday) {
      var ms = nextToday.start - now;
      cls += ms <= MIN ? " final" : ms <= 5 * MIN ? " boarding" : "";
      kicker = ms <= MIN ? "Final call" : ms <= 5 * MIN ? "Now boarding" : "Next departure";
      title = nextToday.title;
      countdown(ms);
      if (ms <= MIN) { count = "NOW"; unit = ""; }
      sub = fmtClock(nextToday.start) + " – " + fmtClock(nextToday.end) + (via(nextToday.location) ? " · " + via(nextToday.location) : "");
    } else {
      kicker = "No further departures today";
      title = timed.some(function (e) { return e.start < tomorrow && e.end > startOfDay(now); }) ? "That's a wrap" : "A clear day";
      sub = next ? "Tomorrow · " + fmtClock(next.start) + " · " + next.title : "";
    }
    banner.className = cls;
    $("banner-kicker").textContent = kicker;
    $("banner-title").textContent = title;
    $("banner-sub").textContent = sub;
    banner.querySelector(".banner-count").hidden = count == null;
    if (count != null) countFlaps.set(count);
    $("count-unit").textContent = unit;
  }

  // ------------------------------------------------------------- departures: the rows

  var ROWS = 5;
  var rowFlaps = [];
  (function buildRows() {
    var box = $("rows");
    for (var i = 0; i < ROWS; i++) {
      var row = el("div", "row");
      var parts = [["tm", 5, true], ["mt", 22], ["via", 5], ["st", 9]];
      var f = {};
      parts.forEach(function (p) {
        var g = el("div", "flaps " + p[0]);
        row.appendChild(g);
        f[p[0]] = Flaps(g, p[1], p[2]);
      });
      f.row = row;
      box.appendChild(row);
      rowFlaps.push(f);
    }
  })();

  function renderBoard() {
    var now = new Date(), today = startOfDay(now), tomorrow = addDays(today, 1);

    var plates = $("plates");
    plates.innerHTML = "";
    events.filter(function (e) { return e.allDay && e.start < tomorrow && e.end > today; }).forEach(function (e) {
      plates.appendChild(el("span", "plate", e.title));
    });

    var timed = timedEvents();
    var todays = timed.filter(function (e) { return e.start < tomorrow && e.end > today; });
    var gone = todays.filter(function (e) { return e.end <= now; });
    var rest = todays.filter(function (e) { return e.end > now; });
    // The last one that left, then everything still to come; tomorrow's first if there's room.
    var list = gone.slice(-1).concat(rest).slice(0, ROWS).map(function (e) { return { e: e }; });
    var tmrw = timed.filter(function (e) { return e.start >= tomorrow; })[0];
    if (list.length < ROWS && tmrw && !rest.length) list.push({ e: tmrw, tomorrow: true });
    if (!todays.length && !list.length) list.push({ note: "NO DEPARTURES SCHEDULED" });

    rowFlaps.forEach(function (f, i) {
      var item = list[i];
      if (!item) { f.row.className = "row"; f.tm.set(""); f.mt.set(""); f.via.set(""); f.st.set(""); return; }
      if (item.note) { f.row.className = "row gone"; f.tm.set(""); f.mt.set(item.note); f.via.set(""); f.st.set(""); return; }
      var e = item.e, ms = e.start - now, status, cls = "row";
      var h = e.start.getHours() % 12 || 12;
      if (item.tomorrow) { status = "TOMORROW"; cls += " tomorrow"; }
      else if (e.end <= now) { status = "DEPARTED"; cls += " gone"; }
      else if (e.start <= now) { status = "NOW"; cls += " now"; }
      else if (ms <= MIN) { status = "FINAL"; cls += " final"; }
      else if (ms <= 5 * MIN) { status = "BOARDING"; cls += " boarding"; }
      else {
        var m = Math.ceil(ms / MIN);
        status = m < 60 ? "IN " + m + " MIN" : "IN " + Math.floor(m / 60) + "H" + pad(m % 60);
      }
      f.row.className = cls;
      f.tm.set(h + ":" + pad(e.start.getMinutes()));
      f.mt.set(e.title);
      f.via.set(via(e.location));
      f.st.set(status);
    });
  }

  // ------------------------------------------------------------- the day, as a brass rule
  // Work hours left to right; meetings inlaid in oxblood, open time from now until the
  // end of the day in green baize, the longest stretch (an hour or more) marked "Focus".

  function renderRuler() {
    var box = $("ruler");
    box.innerHTML = "";
    var now = new Date(), today = startOfDay(now), tomorrow = addDays(today, 1);
    var todays = timedEvents().filter(function (e) { return e.start < tomorrow && e.end > today; }).map(function (e) {
      return { s: Math.max(e.start, today), e: Math.min(e.end, tomorrow) };
    });
    var fromH = WORK[0], toH = WORK[1];
    todays.forEach(function (x) {
      fromH = Math.min(fromH, new Date(x.s).getHours());
      toH = Math.max(toH, Math.ceil((x.e - today) / HOUR));
    });
    toH = Math.min(24, toH);
    var t0 = at(today, fromH).getTime(), t1 = at(today, toH).getTime();
    var pct = function (t) { return ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * 100 + "%"; };
    var span = function (node, a, b) { node.style.left = pct(a); node.style.width = "calc(" + pct(b) + " - " + pct(a) + ")"; };

    for (var q = fromH * 4; q <= toH * 4; q++) {
      var t = t0 + (q - fromH * 4) * 15 * MIN, hr = q % 4 === 0;
      if (q > fromH * 4 && q < toH * 4) {
        var tk = el("div", "rl-tick" + (hr ? " hr" : ""));
        tk.style.left = pct(t);
        box.appendChild(tk);
      }
      if (hr && q > fromH * 4 && q < toH * 4) {
        var h = q / 4, n = el("div", "rl-num", (h % 12 || 12) + (h < 12 ? "a" : "p"));
        n.style.left = pct(t);
        box.appendChild(n);
      }
    }

    var free = [], cursor = Math.max(now.getTime(), at(today, WORK[0]).getTime()), dayEnd = at(today, WORK[1]).getTime();
    todays.slice().sort(function (a, b) { return a.s - b.s; }).forEach(function (x) {
      if (x.s > cursor) free.push([cursor, Math.min(x.s, dayEnd)]);
      cursor = Math.max(cursor, x.e);
    });
    if (dayEnd > cursor) free.push([cursor, dayEnd]);
    free = free.filter(function (f) { return f[1] - f[0] >= 30 * MIN; });
    var best = free.reduce(function (b, f) { return !b || f[1] - f[0] > b[1] - b[0] ? f : b; }, null);
    if (best && best[1] - best[0] < HOUR) best = null;
    free.forEach(function (f) {
      var g = el("div", "rl-free" + (f === best ? " best" : ""), (f === best ? "Focus · " : "") + fmtSpan(f[1] - f[0]));
      span(g, f[0], f[1]);
      box.appendChild(g);
    });
    todays.forEach(function (x) {
      var b = el("div", "rl-ev");
      span(b, x.s, x.e);
      box.appendChild(b);
    });
    var nowT = now.getTime();
    if (nowT > t0) {
      var past = el("div", "rl-past");
      past.style.width = pct(nowT);
      box.appendChild(past);
    }
    if (nowT > t0 && nowT < t1) {
      var line = el("div", "rl-now");
      line.style.left = pct(nowT);
      box.appendChild(line);
    }
  }

  // ------------------------------------------------------------- scoreboard (Wrigley style)

  var sports = null;

  function loadSports() {
    var p = demo ? Promise.resolve(demoSports()) : api("/sports");
    return p.then(function (data) { sports = data.teams || []; renderScoreboard(); renderPaper(); setProblem("scores", null); })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) { sports = null; renderScoreboard(); return; }
        setProblem("scores", e.message);
      });
  }

  function sportsLive() { return !!sports && sports.some(function (t) { return t.live; }); }

  var SHORT_NAMES = { Blackhawks: "Hawks", Northwestern: "NU" };
  var SPORT_WORD = { "nu-football": "Football", "nu-hoops": "Hoops" };

  function teamLabel(t) {
    var dup = sports.filter(function (x) { return x.name === t.name; }).length > 1;
    return (SHORT_NAMES[t.name] || t.name) + (dup && SPORT_WORD[t.key] ? " " + SPORT_WORD[t.key] : "");
  }
  function tiles(value, cls) {
    var box = el("span", "tiles" + (cls ? " " + cls : ""));
    String(value == null ? "0" : value).split("").forEach(function (d) { box.appendChild(el("span", "tile", d)); });
    return box;
  }
  function gameWhen(ms, now) {
    var d = new Date(ms), days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
    var day = days === 0 ? "Today" : days === 1 ? "Tmrw" : days === -1 ? "Yest"
      : days > 1 && days < 7 ? DAY_NAMES[d.getDay()].slice(0, 3) : MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
    return days < 0 ? day : day + " " + fmtTime(d);
  }

  function renderScoreboard() {
    var card = $("scoreboard");
    var ok = (sports || []).filter(function (t) { return !t.error; });
    card.hidden = !ok.length;
    layoutBottom();
    if (!ok.length) return;
    var now = new Date(), today = startOfDay(now).getTime();
    var within = function (g, from, to) { return !!(g && g.start && g.start >= from && g.start < to); };

    // Wrigley flies a white W flag after a Cubs win and a blue L after a loss.
    var cubs = ok.filter(function (t) { return t.key === "cubs"; })[0];
    var flag = $("flag");
    var last = cubs && !cubs.live && cubs.last && cubs.last.won != null && within(cubs.last, today - DAY_MS, today + DAY_MS) ? cubs.last : null;
    flag.hidden = !last;
    if (last) { flag.className = "flag " + (last.won ? "w" : "l"); flag.textContent = last.won ? "W" : "L"; }

    var live = ok.filter(function (t) { return t.live; });
    var lv = $("sb-live");
    lv.hidden = !live.length;
    lv.innerHTML = "";
    if (live.length) {
      var t = live[0], g = t.live;
      var us = el("div", "lv-row");
      us.appendChild(el("span", "nm", teamLabel(t)));
      us.appendChild(tiles(g.usScore));
      var them = el("div", "lv-row");
      them.appendChild(el("span", "nm", g.them));
      them.appendChild(tiles(g.themScore));
      // Visitors on top, as on any scoreboard.
      lv.appendChild(g.home ? them : us);
      lv.appendChild(g.home ? us : them);
      var meta = el("div", "lv-meta");
      var left = el("span");
      left.appendChild(el("span", "live", "Live"));
      left.appendChild(document.createTextNode((g.detail || "") + (g.tv ? " · " + g.tv : "")));
      meta.appendChild(left);
      if (typeof g.winPct === "number") meta.appendChild(el("span", null, "Win chance " + g.winPct + "%"));
      lv.appendChild(meta);
    }

    var rank = function (t) { return t.live ? 0 : within(t.last, today, today + DAY_MS) ? 1 : within(t.last, today - DAY_MS, today) ? 2 : 3; };
    var shown = ok.filter(function (t) {
      return t !== live[0] && (t.live || within(t.next, today, today + 2 * DAY_MS) || within(t.last, today - DAY_MS, today + DAY_MS));
    }).sort(function (a, b) { return rank(a) - rank(b); });

    var box = $("sb-rows");
    box.innerHTML = "";
    var row = function (t, g) {
      var r = el("div", "sb-row");
      r.appendChild(el("span", "sb-team", teamLabel(t)));
      r.appendChild(el("span", "sb-opp", (g.home ? "vs " : "at ") + (g.themAbbr || g.them)));
      var res = el("span", "sb-res");
      if (g.state === "in") {
        res.appendChild(el("span", "sb-when", "Live"));
        res.appendChild(tiles(g.usScore));
        res.appendChild(tiles(g.themScore));
      } else if (g.state === "post") {
        var when = gameWhen(g.start, now);
        if (when !== "Today") res.appendChild(el("span", "sb-when", when));
        res.appendChild(el("span", "wl " + (g.won ? "w" : "l"), g.won ? "W" : g.won === false ? "L" : "T"));
        res.appendChild(tiles(g.usScore));
        res.appendChild(tiles(g.themScore));
      } else {
        res.appendChild(el("span", null, gameWhen(g.start, now)));
        if (g.tv) res.appendChild(el("span", "sb-when", g.tv));
      }
      r.appendChild(res);
      box.appendChild(r);
    };
    shown.forEach(function (t) { var r = rank(t); row(t, t.live || (r === 1 || r === 2 ? t.last : t.next)); });
    if (!shown.length && !live.length) {
      var soon = ok.filter(function (t) { return t.next && t.next.start; }).sort(function (a, b) { return a.next.start - b.next.start; });
      box.appendChild(el("div", "sb-sub", soon.length ? "Coming up" : "No games on the schedule"));
      soon.forEach(function (t) { row(t, t.next); });
    }
    trimOverflow(box);
  }

  // ------------------------------------------------------------- the sports page (headlines)

  var news = null;

  function loadNews() {
    var p = demo ? Promise.resolve(demoNews()) : api("/news");
    return p.then(function (data) { news = data.articles || []; renderPaper(); setProblem("headlines", null); })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) { news = null; renderPaper(); return; }
        setProblem("headlines", e.message);
      });
  }

  function age(ms, now) {
    var m = Math.max(1, Math.round((now - ms) / MIN));
    if (m < 60) return m + " min ago";
    if (m < 24 * 60) { var h = Math.round(m / 60); return h + (h === 1 ? " hour" : " hours") + " ago"; }
    return DAY_NAMES[new Date(ms).getDay()];
  }

  function renderPaper() {
    var card = $("paper");
    card.hidden = !news || !news.length;
    layoutBottom();
    if (card.hidden) return;
    var now = new Date();
    var dl = $("paper-dateline");
    dl.innerHTML = "";
    dl.appendChild(el("span", null, DAY_NAMES[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear()));
    dl.appendChild(el("span", null, settings.placeName + " Edition"));
    var box = $("stories");
    box.innerHTML = "";
    news.slice(0, 6).forEach(function (a, i) {
      var team = (sports || []).filter(function (t) { return t.key === a.key; })[0];
      var s = el("div", "story" + (i === 0 ? " lead" : ""));
      s.appendChild(el("div", "kick", (team ? teamLabel(team) : a.name || "Sports") + (a.published ? " · " + age(a.published, now) : "")));
      s.appendChild(el("div", "hed", a.headline));
      box.appendChild(s);
    });
    trimOverflow(box);
  }

  function layoutBottom() {
    var sb = $("scoreboard").hidden, pp = $("paper").hidden;
    var bottom = document.querySelector(".bottom");
    bottom.hidden = sb && pp;
    bottom.className = "bottom" + (sb || pp ? " solo" : "");
  }

  // ------------------------------------------------------------- the turntable (Spotify)

  var spotify = null, spotifyAt = 0, spotifyPolls = 0;

  function loadSpotify() {
    var p = demo ? Promise.resolve({ spotify: spotify || demoSpotify() }) : api("/spotify");
    return p.then(function (data) { spotify = data.spotify || null; spotifyAt = Date.now(); renderSpotify(); setProblem("spotify", null); })
      .catch(function (e) {
        if (/HTTP 404/.test(e.message)) { spotify = null; renderSpotify(); return; }
        setProblem("spotify", e.message);
      });
  }

  function renderSpotify() {
    var tt = $("turntable");
    tt.hidden = !spotify;
    if (!spotify) return;
    var idle = !spotify.active;
    tt.className = "turntable" + (!idle && spotify.playing ? " playing" : "");
    $("tt-kicker").textContent = idle ? "The turntable" : spotify.playing ? "Now playing" : "Paused";
    $("tt-title").textContent = idle ? "Quiet in here" : spotify.title || "";
    $("tt-artist").textContent = idle ? "Nothing on Spotify" : spotify.artist || "";
    $("label").style.backgroundImage = !idle && spotify.art ? "url(\"" + spotify.art + "\")" : "";
    renderSpotifyProgress();
  }

  // The tonearm creeps across the record as the song plays, and rests off it when idle.
  function renderSpotifyProgress() {
    var arm = $("arm");
    if (!spotify || !spotify.active || !spotify.durationMs) { arm.style.transform = "rotate(-8deg)"; return; }
    var ms = spotify.progressMs + (spotify.playing ? Date.now() - spotifyAt : 0);
    var f = Math.min(1, Math.max(0, ms / spotify.durationMs));
    arm.style.transform = "rotate(" + (14 + f * 16).toFixed(1) + "deg)";
    if (spotify.playing && ms > spotify.durationMs + 1500 && Date.now() - spotifyAt > 3000) loadSpotify();
  }

  function spotifyControl(action) {
    if (!spotify) return;
    if (action === "toggle") action = spotify.playing ? "pause" : "play";
    toast({ play: "Play", pause: "Pause", next: "Next record", previous: "Previous record" }[action]);
    if (action === "pause" || action === "play") {
      spotify.progressMs += spotify.playing ? Date.now() - spotifyAt : 0;
      spotifyAt = Date.now();
      spotify.playing = action === "play";
      renderSpotify();
    }
    if (demo) return;
    api("/spotify/control", { method: "POST", body: { action: action } })
      .then(function () { setTimeout(loadSpotify, 700); })
      .catch(function (e) { toast("Spotify: " + e.message.replace(/^.*?: /, "")); loadSpotify(); });
  }

  // ------------------------------------------------------------- demo data

  function demoCalendar() {
    var now = new Date(), base = new Date(Math.floor(now.getTime() / (15 * MIN)) * 15 * MIN);
    var w = function (offsetMin) { var d = new Date(base.getTime() + offsetMin * MIN); return ymd(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
    var tmrw = ymd(addDays(now, 1));
    return { events: [
      { title: "Quarter-end close", allDay: true, start: ymd(now), end: tmrw },
      { title: "Standup", start: w(-150), end: w(-135) },
      { title: "Pipeline review", start: w(-90), end: w(-45) },
      { title: "Design review", location: "https://zoom.us/j/123456789", start: w(15), end: w(45) },
      { title: "Vendor call", location: "https://teams.microsoft.com/l/meetup-join/abc", start: w(120), end: w(150) },
      { title: "Team sync", location: "Library", start: w(210), end: w(255) },
      { title: "Standup", start: tmrw + "T09:00", end: tmrw + "T09:15" },
    ] };
  }

  function demoSports() {
    var now = Date.now();
    var g = function (o) { return Object.assign({ id: String(Math.random()), tv: null, won: null, usScore: null, themScore: null, detail: "" }, o); };
    return { teams: [
      { key: "bears", name: "Bears", live: g({ state: "in", start: now - 2 * HOUR, home: true, them: "Packers", themAbbr: "GB", usScore: "17", themScore: "10", detail: "3rd 8:12", tv: "FOX", winPct: 68 }) },
      { key: "cubs", name: "Cubs", last: g({ state: "post", start: now - 14 * HOUR, home: true, them: "Brewers", themAbbr: "MIL", usScore: "5", themScore: "3", won: true }),
        next: g({ state: "pre", start: now + 26 * HOUR, home: false, them: "Brewers", themAbbr: "MIL", tv: "TBS" }) },
      { key: "blackhawks", name: "Blackhawks", last: g({ state: "post", start: now - 2 * DAY_MS, home: true, them: "Blues", themAbbr: "STL", usScore: "2", themScore: "4", won: false }),
        next: g({ state: "pre", start: now + 4 * HOUR, home: false, them: "Wild", themAbbr: "MIN", tv: "CHSN" }) },
      { key: "nu-football", name: "Northwestern", next: g({ state: "pre", start: now + DAY_MS, home: false, them: "Iowa", themAbbr: "IOWA", tv: "BTN" }) },
      { key: "nu-hoops", name: "Northwestern" },
    ] };
  }

  function demoNews() {
    var now = Date.now();
    return { articles: [
      { key: "bears", name: "Bears", headline: "Bears' defense forces three turnovers in first half against Green Bay", published: now - 40 * MIN },
      { key: "cubs", name: "Cubs", headline: "Cubs even NLCS behind six scoreless innings from the bullpen", published: now - 3 * HOUR },
      { key: "blackhawks", name: "Blackhawks", headline: "Blackhawks recall forward from Rockford ahead of road trip", published: now - 6 * HOUR },
      { key: "nu-football", name: "Northwestern", headline: "Northwestern prepares for Iowa's top-ranked run defense", published: now - 20 * HOUR },
    ] };
  }

  function demoSpotify() {
    return { demo: true, active: true, playing: true, title: "Lake Shore Drive", artist: "Aliotta Haynes Jeremiah", art: null, progressMs: 70000, durationMs: 220000 };
  }

  // ------------------------------------------------------------- self-update (shares ../version.json)

  function freshReload(version) { location.replace(location.pathname + "?v=" + encodeURIComponent(version || Date.now())); }

  function checkForUpdate() {
    if (!window.HUB_VERSION) return;
    fetch("../version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.version || v.version === window.HUB_VERSION) return;
        var last = 0;
        try { last = +localStorage.getItem("homehub.study.updateReload") || 0; } catch (e) {}
        if (Date.now() - last < 30 * MIN) return;
        try { localStorage.setItem("homehub.study.updateReload", String(Date.now())); } catch (e) {}
        freshReload(v.version);
      })
      .catch(function () {});
  }

  // ------------------------------------------------------------- boot + refresh loop

  function refreshAll() {
    return Promise.all([loadWeather(), loadAirQuality(), loadCalendar(), loadSports(), loadNews(), loadSpotify()]).then(renderStatus);
  }

  renderStatus();
  tick();
  refreshAll();

  setInterval(function () { tick(); renderSpotifyProgress(); }, 1000);
  setInterval(function () { renderBoard(); renderRuler(); renderStatus(); renderAlmanac(); }, 60 * 1000);
  setInterval(loadCalendar, 5 * MIN);
  setInterval(loadWeather, 15 * MIN);
  setInterval(loadAirQuality, 30 * MIN);
  setInterval(loadNews, 15 * MIN);
  var sportsTicks = 0;
  setInterval(function () { sportsTicks++; if (sportsLive() || sportsTicks % 5 === 0) loadSports(); }, 60 * 1000);
  setInterval(function () { spotifyPolls++; if ((spotify && spotify.playing) || spotifyPolls % 3 === 0) loadSpotify(); }, 10 * 1000);
  setInterval(checkForUpdate, 10 * MIN);
  setTimeout(checkForUpdate, 30 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refreshAll(); checkForUpdate(); } });
})();
