// Office TV — a look-only Home Hub board for the Fire TV in the office. Plain JS, no
// build step. Same Worker as the iPad hub; the remote's play/pause and skip buttons
// drive Spotify, and any button wakes it up after hours.
(function () {
  "use strict";

  // ------------------------------------------------------------- settings
  // There's no keyboard worth typing on, so everything comes from a one-time setup link:
  //   …/hub/tv/#worker=https://…&key=…&work=8-18&on=7-20
  // work = the hours the day timeline always shows; on = when the screen is lit
  // (outside them it goes black, unless a game is on).

  var DEFAULTS = {
    workerUrl: "",
    hubKey: "",
    placeName: "Lake Forest",
    lat: "42.2586",
    lon: "-87.8406",
    work: "8-18",
    on: "7-20",
  };
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

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function at(day, h) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h); }
  function parseWall(s) {
    // "2026-10-06T09:00" or "2026-10-06" → local Date (the TV is in the same tz as the Worker's HOME_TZ).
    var p = s.split(/[-T:]/).map(Number);
    return new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0);
  }
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? "a" : "p");
  }
  // 95 min → "1h 35m"
  function fmtSpan(ms) {
    var m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h ? h + "h" + (m % 60 ? " " + (m % 60) + "m" : "") : m + "m";
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
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(path + " → HTTP " + res.status + (body && body.error ? ": " + body.error : ""));
      });
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // Drop rows that would be cut off at the bottom of a card. (offsetTop is measured from
  // #stage, the positioned ancestor, and in unscaled px, so the transform doesn't matter.)
  function trimOverflow(box) {
    var limit = box.offsetTop + box.clientHeight;
    for (var i = box.children.length - 1; i > 0; i--) {
      var c = box.children[i];
      if (c.offsetTop + c.offsetHeight <= limit) break;
      box.removeChild(c);
    }
  }

  // ------------------------------------------------------------- fit 1920×1080 to the screen

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var x = (window.innerWidth - 1920 * s) / 2, y = (window.innerHeight - 1080 * s) / 2;
    $("stage").style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ------------------------------------------------------------- status line

  var problems = {};
  var lastSync = null;
  function setProblem(key, msg) {
    if (msg) problems[key] = msg; else { delete problems[key]; lastSync = new Date(); }
    renderStatus();
  }
  function renderStatus() {
    var keys = Object.keys(problems);
    var t = $("status-text");
    t.className = keys.length ? "warn" : "";
    if (keys.length) t.textContent = "Trouble with " + keys.map(function (k) { return k + " (" + problems[k] + ")"; }).join(", ");
    else if (demo) t.textContent = "Demo data · open this page once with #worker=…&key=… to connect";
    else t.textContent = lastSync ? "Updated " + fmtTime(lastSync) : "Loading…";
  }

  // ------------------------------------------------------------- clock + screen off after hours

  var wakeUntil = 0;
  var wasNight = null;
  var shownDay = ymd(new Date());

  function tickClock() {
    var now = new Date();
    var h = now.getHours();
    var timeText = (h % 12 || 12) + ":" + pad(now.getMinutes());
    var t = $("time");
    t.textContent = timeText;
    t.appendChild(el("span", "ampm", h < 12 ? "AM" : "PM"));
    $("date").textContent = DAY_NAMES[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " + now.getDate();
    renderPrecipAlert(now);
    renderNext(now);

    if (ymd(now) !== shownDay) { shownDay = ymd(now); loadCalendar(); loadWeather(); }

    // Outside the "on" hours: a black screen with a dim clock, unless a game is on.
    var night = (h < ON[0] || h >= ON[1]) && Date.now() > wakeUntil && !sportsLive();
    $("night").hidden = !night;
    if (night) {
      $("night-time").textContent = timeText;
      $("night-next").textContent = nextEventLine(now);
    }
    if (night !== wasNight) {
      wasNight = night;
      // The Fire TV app (if it's wrapping this page) lets the TV go to sleep after hours.
      try { if (window.HubTV && window.HubTV.keepAwake) window.HubTV.keepAwake(!night); } catch (e) {}
    }

    if (h === 3 && now.getMinutes() === 30 && performance.now() > 120000) freshReload(window.HUB_VERSION || "");
  }

  // ------------------------------------------------------------- remote control
  // Any button wakes the screen for 5 minutes after hours. Play/pause and the skip
  // buttons control Spotify.

  var MEDIA_KEYS = {
    MediaPlayPause: "toggle", MediaPlay: "play", MediaPause: "pause",
    MediaTrackNext: "next", MediaFastForward: "next",
    MediaTrackPrevious: "previous", MediaRewind: "previous",
  };
  var MEDIA_CODES = { 179: "toggle", 176: "next", 177: "previous" };

  document.addEventListener("keydown", function (ev) {
    var action = MEDIA_KEYS[ev.key] || MEDIA_CODES[ev.keyCode];
    if (!$("night").hidden) {
      wakeUntil = Date.now() + 5 * MIN;
      tickClock();
      ev.preventDefault();
      return;
    }
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

  // ------------------------------------------------------------- photo backdrop
  // Same freely licensed Wikimedia Commons photos as the iPad hub (credited in
  // ../README.md), always darkened here so the cards stay readable.

  var PHOTOS = {
    clear: "Gfp-illinois-chicago-lake-michigan-horizon.jpg",
    partly: "Blue-skies-cumulus-clouds.jpg",
    night: "Starry night sky.jpg",
    cloudy: "Grey cloudy sky.jpg",
    fog: "Early morning fog.jpg",
    rain: "Raindrops on a window.jpg",
    snow: "Winter forest after snow storm (45643768335).jpg",
    storm: "Lightning cloud to cloud (aka).jpg",
  };
  var currentWx = null;
  var shownPhoto = null;
  var frontLayer = "bg-a";

  function photoKind(code, isDay) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code === 3) return "cloudy";
    if (!isDay) return code === 2 ? "cloudy" : "night";
    return code === 2 ? "partly" : "clear";
  }

  function updateBackdrop() {
    if (!currentWx) return;
    var kind = photoKind(currentWx.code, currentWx.isDay);
    document.querySelector(".backdrop").classList.toggle("dim", !currentWx.isDay && kind !== "night");
    var url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(PHOTOS[kind].replace(/ /g, "_")) + "?width=1920";
    if (shownPhoto === url) return;
    shownPhoto = url;
    var img = new Image();
    img.onload = function () {
      if (shownPhoto !== url) return;
      var back = frontLayer === "bg-a" ? "bg-b" : "bg-a";
      $(back).style.backgroundImage = "url(\"" + url + "\")";
      $(back).classList.add("show");
      $(frontLayer).classList.remove("show");
      frontLayer = back;
    };
    img.onerror = function () { if (shownPhoto === url) shownPhoto = null; };
    img.src = url;
  }

  // ------------------------------------------------------------- weather (Open-Meteo, no key)

  var WMO = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅️", "Partly cloudy"], 3: ["☁️", "Cloudy"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Freezing fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"],
    56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
    61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"],
    85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
    95: ["⛈️", "Thunderstorms"], 96: ["⛈️", "T-storms + hail"], 99: ["⛈️", "T-storms + hail"],
  };
  function wmo(code, isDay) {
    var w = WMO[code] || ["🌡️", ""];
    if (!isDay && (code === 0 || code === 1)) return ["🌙", w[1]];
    return w;
  }

  var wx = null;  // last forecast

  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(settings.lat) +
      "&longitude=" + encodeURIComponent(settings.lon) +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      "&hourly=precipitation_probability&minutely_15=precipitation,snowfall&forecast_minutely_15=8" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        wx = d;
        currentWx = { code: d.current.weather_code, isDay: !!d.current.is_day };
        updateBackdrop();
        storePrecip(d);
        renderWeather();
        setProblem("weather", null);
      })
      .catch(function (e) { setProblem("weather", e.message); });
  }

  function renderWeather() {
    if (!wx) return;
    var c = wx.current, day = wx.daily;
    var now = wmo(c.weather_code, c.is_day);
    var box = $("weather");
    box.innerHTML = "";

    var detail = el("div", "wx-detail");
    detail.appendChild(el("b", null, now[1]));
    detail.appendChild(el("div", null, "Feels " + Math.round(c.apparent_temperature) + "° · wind " + Math.round(c.wind_speed_10m)));
    if (day.sunrise && day.sunset) {
      var t = new Date(), rise = parseWall(day.sunrise[0]), set = parseWall(day.sunset[0]);
      var sunLine = t < rise ? "🌅 Sunrise " + fmtTime(rise) : t < set ? "🌇 Sunset " + fmtTime(set)
        : day.sunrise[1] ? "🌅 Sunrise " + fmtTime(parseWall(day.sunrise[1])) : "";
      if (sunLine) detail.appendChild(el("div", null, sunLine));
    }

    var nowBox = el("div", "wx-now");
    nowBox.appendChild(el("span", "wx-icon", now[0]));
    nowBox.appendChild(el("span", "wx-temp", Math.round(c.temperature_2m) + "°"));

    var strip = el("div", "wx-strip");
    for (var i = 0; i < Math.min(5, day.time ? day.time.length : 0); i++) {
      var dd = parseWall(day.time[i]);
      var cell = el("div", "fc-day" + (i === 0 ? " today" : ""));
      cell.appendChild(el("div", "fc-name", i === 0 ? "Today" : DAY_NAMES[dd.getDay()].slice(0, 3)));
      cell.appendChild(el("div", "fc-icon", wmo(day.weather_code[i], 1)[0]));
      var temps = el("div", "fc-temp");
      temps.appendChild(el("b", null, Math.round(day.temperature_2m_max[i]) + "°"));
      temps.appendChild(document.createTextNode(" " + Math.round(day.temperature_2m_min[i]) + "°"));
      cell.appendChild(temps);
      var pop = day.precipitation_probability_max[i];
      cell.appendChild(el("div", "fc-pop", pop >= 20 ? "💧" + pop + "%" : " "));
      strip.appendChild(cell);
    }

    box.appendChild(detail);
    box.appendChild(nowBox);
    box.appendChild(strip);
  }

  // ------------------------------------------------------------- rain / snow in the next hour
  // Same as the iPad hub: Open-Meteo's 15-minute data, each value the total for the
  // 15 minutes ending at its timestamp, with the hourly chance as a fallback.

  var precip = null;

  function storePrecip(d) {
    var m = d.minutely_15, hr = d.hourly;
    precip = {
      tempF: d.current ? d.current.temperature_2m : null,
      slots: m && m.time ? m.time.map(function (t, i) {
        return { end: parseWall(t), mm: m.precipitation[i] || 0, snowCm: m.snowfall ? m.snowfall[i] || 0 : 0 };
      }) : [],
      hours: hr && hr.time ? hr.time.map(function (t, i) {
        return { start: parseWall(t), prob: hr.precipitation_probability[i] };
      }) : [],
    };
    renderPrecipAlert(new Date());
  }

  function precipMessage(now) {
    if (!precip) return null;
    var Q = 15 * MIN;
    var horizon = new Date(now.getTime() + HOUR);
    var slots = precip.slots.filter(function (s) { return s.end > now && s.end - Q < horizon; });
    var wet = function (s) { return s.mm >= 0.1 || s.snowCm >= 0.05; };
    var firstWet = -1;
    for (var i = 0; i < slots.length; i++) if (wet(slots[i])) { firstWet = i; break; }

    if (firstWet >= 0) {
      var run = slots.slice(firstWet);
      var snow = run.some(function (s) { return wet(s) && s.snowCm >= 0.05; });
      var word = snow ? "Snow" : "Rain";
      var icon = snow ? "🌨️" : "☔";
      var start = new Date(slots[firstWet].end - Q);
      if (start <= now) {
        for (var j = 0; j < run.length; j++) {
          if (!wet(run[j])) return { text: icon + " " + word + " now · letting up around " + fmtTime(run[j - 1].end), snow: snow };
        }
        return { text: icon + " " + word + " now", snow: snow };
      }
      return { text: icon + " " + word + " starting around " + fmtTime(start), snow: snow };
    }

    var best = 0;
    precip.hours.forEach(function (hr) {
      if (hr.start < horizon && hr.start.getTime() + HOUR > now.getTime()) best = Math.max(best, hr.prob || 0);
    });
    if (best >= 50) {
      var cold = precip.tempF != null && precip.tempF <= 34;
      return { text: (cold ? "🌨️ " : "☔ ") + best + "% chance of " + (cold ? "snow" : "rain") + " this hour", snow: cold };
    }
    return null;
  }

  function renderPrecipAlert(now) {
    var msg = precipMessage(now);
    var box = $("precip-alert");
    box.hidden = !msg;
    if (msg) {
      box.textContent = msg.text;
      box.className = "precip-alert" + (msg.snow ? " snow" : "");
    }
  }

  // ------------------------------------------------------------- work calendar
  // /calendar?for=tv returns just the Worker's TV_CALENDARS (all calendars on an
  // older Worker, which ignores it). Today and tomorrow are all the TV needs.

  var events = [];

  function loadCalendar() {
    var p = demo ? Promise.resolve(demoCalendar()) : api("/calendar?days=2&for=tv");
    return p.then(function (data) {
      events = data.events.map(function (e) {
        return {
          title: e.title || "(No title)", location: e.location, allDay: e.allDay, color: e.color,
          start: parseWall(e.start), end: parseWall(e.end || e.start),
        };
      });
      renderTimeline();
      tickClock();
      setProblem("calendar", data.errors && data.errors.length ? data.errors.join("; ") : null);
    }).catch(function (e) { setProblem("calendar", e.message); });
  }

  function timedEvents() {
    return events.filter(function (e) { return !e.allDay && e.end > e.start; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  // Video links are long and unreadable from across the room: name the service instead.
  function placeLabel(loc) {
    if (!loc) return "";
    if (/zoom\.us/i.test(loc)) return "Zoom";
    if (/meet\.google/i.test(loc)) return "Google Meet";
    if (/teams\.(microsoft|live)/i.test(loc)) return "Teams";
    if (/webex/i.test(loc)) return "Webex";
    return /^https?:/i.test(loc) ? "" : loc;
  }

  // ------------------------------------------------------------- next meeting countdown

  // Big number with small units: "1 hr 12 min", "42 min", "4:32" in the last 5 minutes.
  function countdown(box, ms) {
    box.innerHTML = "";
    if (ms <= 60 * 1000) { box.textContent = "Starting now"; return; }
    if (ms <= 5 * MIN) {
      var s = Math.ceil(ms / 1000);
      box.textContent = Math.floor(s / 60) + ":" + pad(s % 60);
      return;
    }
    var m = Math.ceil(ms / MIN), h = Math.floor(m / 60);
    box.appendChild(document.createTextNode("in "));
    if (h) {
      box.appendChild(document.createTextNode(h));
      box.appendChild(el("small", null, " hr "));
    }
    if (m % 60 || !h) {
      box.appendChild(document.createTextNode(m % 60));
      box.appendChild(el("small", null, " min"));
    }
  }

  function renderNext(now) {
    var card = $("next-card");
    var timed = timedEvents();
    var tomorrow = addDays(startOfDay(now), 1);
    var current = timed.filter(function (e) { return e.start <= now && e.end > now; }).pop();
    var upcoming = timed.filter(function (e) { return e.start > now; });
    var next = upcoming[0];
    var nextToday = next && next.start < tomorrow ? next : null;
    var label = $("next-label"), count = $("next-count");
    var cls = "card next-card";
    label.innerHTML = "";
    count.hidden = false;

    if (current) {
      label.appendChild(el("span", "badge", "NOW"));
      label.appendChild(document.createTextNode("In a meeting"));
      $("next-title").textContent = current.title;
      count.innerHTML = "";
      var left = Math.ceil((current.end - now) / MIN);
      count.appendChild(document.createTextNode(left >= 60 ? fmtSpan(current.end - now) : left));
      count.appendChild(el("small", null, left >= 60 ? " left" : " min left"));
      $("next-when").textContent = "Until " + fmtTime(current.end) + (placeLabel(current.location) ? " · " + placeLabel(current.location) : "");
      $("next-after").textContent = nextToday
        ? "Then " + fmtTime(nextToday.start) + " · " + nextToday.title + (nextToday.start - current.end <= 0 ? " (back-to-back)" : "")
        : "Nothing after this today";
    } else if (nextToday) {
      var ms = nextToday.start - now;
      if (ms <= 60 * 1000) cls += " urgent";
      else if (ms <= 5 * MIN) cls += " soon";
      label.textContent = "Next up";
      $("next-title").textContent = nextToday.title;
      countdown(count, ms);
      var where = placeLabel(nextToday.location);
      $("next-when").textContent = fmtTime(nextToday.start) + " – " + fmtTime(nextToday.end) + (where ? " · " + where : "");
      var then = upcoming[1] && upcoming[1].start < tomorrow ? upcoming[1] : null;
      $("next-after").textContent = then ? "Then " + fmtTime(then.start) + " · " + then.title : "";
    } else {
      cls += " calm";
      var hadToday = timed.some(function (e) { return e.start < tomorrow && e.end > startOfDay(now); });
      label.textContent = "Rest of today";
      $("next-title").textContent = hadToday ? "No more meetings 🎉" : "Nothing on the calendar";
      count.hidden = true;
      $("next-when").textContent = next ? "Tomorrow starts at " + fmtTime(next.start) + " · " + next.title : "";
      $("next-after").textContent = "";
    }
    card.className = cls;
  }

  function nextEventLine(now) {
    var next = timedEvents().filter(function (e) { return e.start > now; })[0];
    if (!next) return "";
    var today = next.start < addDays(startOfDay(now), 1);
    return "Next: " + (today ? "" : "tomorrow ") + fmtTime(next.start) + " · " + next.title;
  }

  // ------------------------------------------------------------- day timeline
  // Work hours left to right, meetings as blocks (overlaps stacked), open time from now
  // until the end of the work day outlined in green, with the longest stretch called out.

  function renderTimeline() {
    var box = $("timeline");
    box.innerHTML = "";
    var now = new Date();
    var today = startOfDay(now), tomorrow = addDays(today, 1);

    var allDay = events.filter(function (e) { return e.allDay && e.start < tomorrow && e.end > today; });
    var chips = $("tl-allday");
    chips.innerHTML = "";
    allDay.forEach(function (e) {
      var c = el("span", "tl-chip", e.title);
      if (e.color) c.style.borderLeftColor = e.color;
      chips.appendChild(c);
    });

    var todays = timedEvents().filter(function (e) { return e.start < tomorrow && e.end > today; }).map(function (e) {
      return { ev: e, s: Math.max(e.start, today), e: Math.min(e.end, tomorrow) };
    });

    // Always the work hours; stretched to fit anything earlier or later.
    var fromH = WORK[0], toH = WORK[1];
    todays.forEach(function (x) {
      fromH = Math.min(fromH, new Date(x.s).getHours());
      toH = Math.max(toH, Math.ceil((x.e - today) / HOUR));
    });
    toH = Math.min(24, toH);
    var t0 = at(today, fromH).getTime(), t1 = at(today, toH).getTime();
    var pct = function (t) { return ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * 100 + "%"; };

    box.appendChild(el("div", "tl-track"));
    var step = toH - fromH > 12 ? 2 : 1;
    for (var h = fromH; h <= toH; h++) {
      var x = pct(at(today, h).getTime());
      if (h > fromH && h < toH) {
        var tick = el("div", "tl-tick");
        tick.style.left = x;
        box.appendChild(tick);
      }
      if ((h - fromH) % step === 0) {
        var lbl = el("div", "tl-hour", h === 24 ? "12a" : (h % 12 || 12) + (h < 12 ? "a" : "p"));
        lbl.style.left = x;
        box.appendChild(lbl);
      }
    }

    // Open time: from now (or the start of the work day) to the end of it.
    var free = [];
    var cursor = Math.max(now.getTime(), at(today, WORK[0]).getTime()), dayEnd = at(today, WORK[1]).getTime();
    todays.slice().sort(function (a, b) { return a.s - b.s; }).forEach(function (x) {
      if (x.s > cursor) free.push([cursor, Math.min(x.s, dayEnd)]);
      cursor = Math.max(cursor, x.e);
    });
    if (dayEnd > cursor) free.push([cursor, dayEnd]);
    free = free.filter(function (f) { return f[1] - f[0] >= 30 * MIN; });
    var best = free.reduce(function (b, f) { return !b || f[1] - f[0] > b[1] - b[0] ? f : b; }, null);
    if (best && best[1] - best[0] < HOUR) best = null;
    free.forEach(function (f) {
      var g = el("div", "tl-free" + (f === best ? " best" : ""), (f === best ? "Focus · " : "Free ") + fmtSpan(f[1] - f[0]));
      g.style.left = pct(f[0]);
      g.style.width = "calc(" + pct(f[1]) + " - " + pct(f[0]) + ")";
      box.appendChild(g);
    });

    // Meetings, in lanes so overlaps don't hide each other.
    var lanes = [];
    todays.forEach(function (x) {
      for (var i = 0; i < lanes.length; i++) if (lanes[i] <= x.s) break;
      lanes[i] = x.e;
      x.lane = i;
    });
    var n = Math.max(1, Math.min(3, lanes.length)), H = 104, inset = 6, laneH = (H - inset * 2) / n;
    var pxPerMs = box.clientWidth / (t1 - t0);
    todays.forEach(function (x) {
      var lane = Math.min(x.lane, n - 1);
      var b = el("div", "tl-event" + (x.ev.start <= now && x.ev.end > now ? " now" : "") + (n > 1 ? " lanes" : ""));
      if (x.ev.color) b.style.background = x.ev.color;
      b.style.left = pct(x.s);
      b.style.width = "calc(" + pct(x.e) + " - " + pct(x.s) + ")";
      b.style.top = inset + lane * laneH + "px";
      b.style.height = laneH + "px";
      // Too narrow to read (a 15-minute standup): just the color.
      var px = (x.e - x.s) * pxPerMs;
      if (px >= 56) b.appendChild(el("span", "tl-ev-title", x.ev.title));
      if (px >= 56 && n === 1) b.appendChild(el("span", "tl-ev-time", fmtTime(x.ev.start)));
      b.title = x.ev.title;
      box.appendChild(b);
    });

    if (!todays.length) box.appendChild(el("div", "tl-empty", allDay.length ? "No meetings today" : "Nothing scheduled today"));

    var t = now.getTime();
    if (t > t0) {
      var past = el("div", "tl-past");
      past.style.width = pct(t);
      box.appendChild(past);
    }
    if (t > t0 && t < t1) {
      var line = el("div", "tl-now");
      line.style.left = pct(t);
      box.appendChild(line);
    }

    var left = todays.filter(function (x) { return x.e > t; }).length;
    var freeLeft = free.reduce(function (sum, f) { return sum + f[1] - f[0]; }, 0);
    var parts = [left ? left + " more meeting" + (left === 1 ? "" : "s") : todays.length ? "No more meetings" : ""];
    if (freeLeft && t < dayEnd) parts.push(fmtSpan(freeLeft) + " open before " + fmtTime(new Date(dayEnd)));
    $("tl-summary").textContent = parts.filter(Boolean).join(" · ");
  }

  // ------------------------------------------------------------- sports scores
  // From the Worker's /sports (ESPN). A live Chicago game gets a big scoreboard at the
  // top of the card (with ESPN's win probability when it has one) and the card grows.

  var sports = null;

  function loadSports() {
    var p = demo ? Promise.resolve(demoSports()) : api("/sports");
    return p.then(function (data) {
      sports = data.teams || [];
      renderScores();
      setProblem("scores", null);
    }).catch(function (e) {
      if (/HTTP 404/.test(e.message)) { sports = null; renderScores(); return; }
      setProblem("scores", e.message);
    });
  }

  function sportsLive() {
    return !!sports && sports.some(function (t) { return t.live; });
  }

  var SHORT_NAMES = { Blackhawks: "Hawks", Northwestern: "NU" };

  // A logo, else the fallback: an emoji, or (abbr) a team abbreviation in a disc.
  function mark(logo, fallback, abbr) {
    var box = el("span", "mark");
    var plain = function () { box.textContent = fallback; if (abbr) box.className = "mark abbr"; };
    if (!logo) { plain(); return box; }
    var img = document.createElement("img");
    img.alt = "";
    img.src = logo;
    img.onerror = plain;
    box.appendChild(img);
    return box;
  }
  function teamName(t) {
    var dup = sports.filter(function (x) { return x.name === t.name; }).length > 1;
    return (SHORT_NAMES[t.name] || t.name) + (dup ? " " + t.emoji : "");
  }
  function gameWhen(ms, now) {
    var d = new Date(ms);
    var days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
    var day = days === 0 ? "Today" : days === 1 ? "Tmrw" : days === -1 ? "Yest"
      : days > 1 && days < 7 ? DAY_NAMES[d.getDay()].slice(0, 3) : MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
    return days < 0 ? day : day + " " + fmtTime(d);
  }
  function opp(g) { return (g.home ? "vs " : "@ ") + (g.themAbbr || g.them); }

  function renderLiveGame(t) {
    var g = t.live, box = $("live-game");
    box.innerHTML = "";
    var row = el("div", "lg-row");
    var us = el("div", "lg-side");
    us.appendChild(mark(t.logo, t.emoji));
    us.appendChild(el("div", "lg-name", SHORT_NAMES[t.name] || t.name));
    var score = el("div", "lg-score");
    score.appendChild(document.createTextNode(g.usScore != null ? g.usScore : "0"));
    score.appendChild(el("span", "dash", "–"));
    score.appendChild(document.createTextNode(g.themScore != null ? g.themScore : "0"));
    var them = el("div", "lg-side them");
    them.appendChild(mark(g.themLogo, g.themAbbr || "🆚", !!g.themAbbr));
    them.appendChild(el("div", "lg-name", g.them));
    row.appendChild(us);
    row.appendChild(score);
    row.appendChild(them);
    box.appendChild(row);

    var detail = el("div", "lg-detail");
    detail.appendChild(el("span", "badge-sm live", "LIVE"));
    detail.appendChild(document.createTextNode((g.detail || "") + (g.tv ? " · " + g.tv : "")));
    box.appendChild(detail);

    if (typeof g.winPct === "number") {
      var wp = el("div", "wp");
      var lab = el("div", "wp-label");
      var mine = el("span");
      mine.appendChild(el("b", null, g.winPct + "%"));
      mine.appendChild(document.createTextNode(" " + (SHORT_NAMES[t.name] || t.name) + " win chance"));
      lab.appendChild(mine);
      lab.appendChild(el("span", null, (100 - g.winPct) + "% " + (g.themAbbr || g.them)));
      wp.appendChild(lab);
      var bar = el("div", "wp-bar"), fill = el("div", "wp-fill");
      fill.style.width = g.winPct + "%";
      bar.appendChild(fill);
      wp.appendChild(bar);
      box.appendChild(wp);
    }
  }

  function scoreRow(t, g, now) {
    var row = el("div", "sc-row");
    row.appendChild(mark(t.logo, t.emoji));
    row.appendChild(el("span", "sc-name", teamName(t)));
    row.appendChild(el("span", "sc-opp", opp(g)));
    var res = el("span", "sc-result");
    if (g.state === "in") {
      res.appendChild(el("span", "badge-sm live", "LIVE"));
      res.appendChild(el("b", null, g.usScore + "–" + g.themScore));
    } else if (g.state === "post") {
      var when = gameWhen(g.start, now);
      if (when !== "Today") res.appendChild(el("span", "sc-when", when + " "));
      res.appendChild(el("span", "badge-sm " + (g.won ? "win" : g.won === false ? "loss" : ""), g.won ? "W" : g.won === false ? "L" : "T"));
      res.appendChild(el("b", null, g.usScore + "–" + g.themScore));
    } else {
      res.appendChild(el("b", null, gameWhen(g.start, now)));
      if (g.tv) res.appendChild(el("span", "sc-when", " · " + g.tv));
    }
    row.appendChild(res);
    return row;
  }

  function renderScores() {
    var card = $("scores-card");
    var ok = (sports || []).filter(function (t) { return !t.error; });
    card.hidden = !ok.length;
    layoutColumns();
    if (!ok.length) return;
    var now = new Date(), today = startOfDay(now).getTime();
    var within = function (g, from, to) { return !!(g && g.start && g.start >= from && g.start < to); };

    var live = ok.filter(function (t) { return t.live; });
    $("live-game").hidden = !live.length;
    $("stage").querySelector(".col-right").classList.toggle("live", !!live.length);
    if (live.length) renderLiveGame(live[0]);

    // Like the iPad: one line per team with a game yesterday, today or tomorrow.
    var rank = function (t) {
      return t.live ? 0 : within(t.last, today, today + DAY_MS) ? 1 : within(t.last, today - DAY_MS, today) ? 2 : 3;
    };
    var shown = ok.filter(function (t) {
      return t !== live[0] && (t.live || within(t.next, today, today + 2 * DAY_MS) || within(t.last, today - DAY_MS, today + DAY_MS));
    }).sort(function (a, b) { return rank(a) - rank(b); });

    var box = $("scores");
    box.innerHTML = "";
    shown.forEach(function (t) {
      var r = rank(t);
      box.appendChild(scoreRow(t, t.live || (r === 1 || r === 2 ? t.last : t.next), now));
    });
    // Quiet stretch: show what's coming up instead of an empty card.
    if (!shown.length && !live.length) {
      var soon = ok.filter(function (t) { return t.next && t.next.start; })
        .sort(function (a, b) { return a.next.start - b.next.start; });
      box.appendChild(el("div", "sc-sub", soon.length ? "Coming up" : "No games on the schedule"));
      soon.forEach(function (t) { box.appendChild(scoreRow(t, t.next, now)); });
    }
    trimOverflow(box);
  }

  // ------------------------------------------------------------- headlines
  // The Worker's /news: recent ESPN stories tagged with one of the teams.

  var news = null;

  function loadNews() {
    var p = demo ? Promise.resolve(demoNews()) : api("/news");
    return p.then(function (data) {
      news = data.articles || [];
      renderNews();
      setProblem("headlines", null);
    }).catch(function (e) {
      if (/HTTP 404/.test(e.message)) { news = null; renderNews(); return; } // older Worker
      setProblem("headlines", e.message);
    });
  }

  function age(ms, now) {
    var m = Math.max(1, Math.round((now - ms) / MIN));
    if (m < 60) return m + "m";
    if (m < 24 * 60) return Math.round(m / 60) + "h";
    return DAY_NAMES[new Date(ms).getDay()].slice(0, 3);
  }

  function renderNews() {
    var card = $("news-card");
    card.hidden = !news || !news.length;
    layoutColumns();
    if (card.hidden) return;
    var box = $("news"), now = Date.now();
    box.innerHTML = "";
    news.slice(0, 8).forEach(function (a) {
      var team = (sports || []).filter(function (t) { return t.key === a.key; })[0];
      var row = el("div", "nw-row");
      row.appendChild(mark(team && team.logo, a.emoji || "📰"));
      row.appendChild(el("div", "nw-text", a.headline));
      if (a.published) row.appendChild(el("div", "nw-age", age(a.published, now)));
      box.appendChild(row);
    });
    trimOverflow(box);
  }

  // With nothing for the right column (no Worker sports yet), let the left one fill the screen.
  function layoutColumns() {
    var empty = $("scores-card").hidden && $("news-card").hidden;
    var stage = $("stage");
    stage.querySelector(".col-right").hidden = empty;
    stage.style.gridTemplateAreas = empty ? '"top top" "tl tl" "left left" "status status"' : "";
  }

  // ------------------------------------------------------------- Spotify now playing

  var spotify = null, spotifyAt = 0, spotifyPolls = 0;

  function loadSpotify() {
    var p = demo ? Promise.resolve({ spotify: spotify || demoSpotify() }) : api("/spotify");
    return p.then(function (data) {
      spotify = data.spotify || null;
      spotifyAt = Date.now();
      renderSpotify();
      setProblem("spotify", null);
    }).catch(function (e) {
      if (/HTTP 404/.test(e.message)) { spotify = null; renderSpotify(); return; }
      setProblem("spotify", e.message);
    });
  }

  function renderSpotify() {
    var card = $("spotify-card");
    card.hidden = !spotify;
    if (!spotify) return;
    var idle = !spotify.active;
    card.className = "card spotify" + (idle ? " idle" : !spotify.playing ? " paused" : "");
    $("sp-title").textContent = idle ? "Nothing playing" : spotify.title || "";
    $("sp-artist").textContent = idle ? "Spotify" : spotify.artist || "";
    $("sp-art").style.backgroundImage = !idle && spotify.art ? "url(\"" + spotify.art + "\")" : "";
    $("sp-state").textContent = spotify.playing ? "▶" : "⏸";
    renderSpotifyProgress();
  }

  function renderSpotifyProgress() {
    if (!spotify || !spotify.active || !spotify.durationMs) return;
    var ms = spotify.progressMs + (spotify.playing ? Date.now() - spotifyAt : 0);
    $("sp-progress").style.width = Math.min(100, (ms / spotify.durationMs) * 100) + "%";
    if (spotify.playing && ms > spotify.durationMs + 1500 && Date.now() - spotifyAt > 3000) loadSpotify();
  }

  function spotifyControl(action) {
    if (!spotify) return;
    if (action === "toggle") action = spotify.playing ? "pause" : "play";
    toast({ play: "▶ Play", pause: "⏸ Pause", next: "⏭ Next song", previous: "⏮ Previous song" }[action]);
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
    var now = new Date();
    var base = new Date(Math.floor(now.getTime() / (15 * MIN)) * 15 * MIN);
    var w = function (offsetMin) {
      var d = new Date(base.getTime() + offsetMin * MIN);
      return ymd(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    };
    var tmrw = ymd(addDays(now, 1));
    return {
      events: [
        { title: "Quarter-end close", allDay: true, start: ymd(now), end: tmrw, color: "#b07cc6" },
        { title: "Standup", start: w(-150), end: w(-135), color: "#4f8cff" },
        { title: "Pipeline review", start: w(-90), end: w(-45), color: "#4f8cff" },
        { title: "Design review", location: "https://zoom.us/j/123456789", start: w(15), end: w(45), color: "#4f8cff" },
        { title: "Vendor call", location: "https://teams.microsoft.com/l/meetup-join/abc", start: w(120), end: w(150), color: "#e08a3c" },
        { title: "Team sync", start: w(210), end: w(255), color: "#4f8cff" },
        { title: "Standup", start: tmrw + "T09:00", end: tmrw + "T09:15", color: "#4f8cff" },
      ],
    };
  }

  function demoSports() {
    var now = Date.now();
    var g = function (o) { return Object.assign({ id: String(Math.random()), tv: null, won: null, usScore: null, themScore: null, detail: "", themLogo: null }, o); };
    return { teams: [
      { key: "bears", name: "Bears", emoji: "🐻", record: "4-2",
        live: g({ state: "in", start: now - 2 * HOUR, home: true, them: "Packers", themAbbr: "GB", usScore: "17", themScore: "10", detail: "3rd 8:12", tv: "FOX", winPct: 68 }),
        last: null, next: null },
      { key: "cubs", name: "Cubs", emoji: "⚾", live: null,
        last: g({ state: "post", start: now - 14 * HOUR, home: true, them: "Brewers", themAbbr: "MIL", usScore: "5", themScore: "3", won: true }),
        next: g({ state: "pre", start: now + 26 * HOUR, home: false, them: "Brewers", themAbbr: "MIL", tv: "TBS" }) },
      { key: "blackhawks", name: "Blackhawks", emoji: "🏒", live: null,
        last: g({ state: "post", start: now - 2 * DAY_MS, home: true, them: "Blues", themAbbr: "STL", usScore: "2", themScore: "4", won: false }),
        next: g({ state: "pre", start: now + 4 * HOUR, home: false, them: "Wild", themAbbr: "MIN", tv: "CHSN" }) },
      { key: "nu-football", name: "Northwestern", emoji: "🏈", live: null,
        last: null, next: g({ state: "pre", start: now + DAY_MS, home: false, them: "Iowa", themAbbr: "IOWA", tv: "BTN" }) },
      { key: "nu-hoops", name: "Northwestern", emoji: "🏀", live: null, last: null, next: null },
    ] };
  }

  function demoNews() {
    var now = Date.now();
    return { articles: [
      { key: "bears", emoji: "🐻", headline: "Bears' defense forces three turnovers in first half against Green Bay", published: now - 40 * MIN },
      { key: "cubs", emoji: "⚾", headline: "Cubs even NLCS behind six scoreless innings from the bullpen", published: now - 3 * HOUR },
      { key: "blackhawks", emoji: "🏒", headline: "Blackhawks recall forward from Rockford ahead of road trip", published: now - 6 * HOUR },
      { key: "nu-football", emoji: "🏈", headline: "Northwestern prepares for Iowa's top-ranked run defense", published: now - 20 * HOUR },
      { key: "bulls", emoji: "🐂", headline: "Bulls finalize opening-night rotation after preseason finale", published: now - 30 * HOUR },
    ] };
  }

  function demoSpotify() {
    return { demo: true, active: true, playing: true, title: "Lake Shore Drive", artist: "Aliotta Haynes Jeremiah", art: null, progressMs: 70000, durationMs: 220000 };
  }

  // ------------------------------------------------------------- self-update
  // Shares ../version.json with the iPad hub; a newer version reloads through a fresh URL.

  function freshReload(version) {
    location.replace(location.pathname + "?v=" + encodeURIComponent(version || Date.now()));
  }

  function checkForUpdate() {
    if (!window.HUB_VERSION) return;
    fetch("../version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.version || v.version === window.HUB_VERSION) return;
        var last = 0;
        try { last = +localStorage.getItem("homehub.tv.updateReload") || 0; } catch (e) {}
        if (Date.now() - last < 30 * MIN) return;
        try { localStorage.setItem("homehub.tv.updateReload", String(Date.now())); } catch (e) {}
        freshReload(v.version);
      })
      .catch(function () {});
  }

  // ------------------------------------------------------------- boot + refresh loop

  function refreshAll() {
    return Promise.all([loadWeather(), loadCalendar(), loadSports(), loadNews(), loadSpotify()]).then(function () {
      renderNews(); // team logos arrive with /sports
      renderStatus();
    });
  }

  renderStatus();
  tickClock();
  refreshAll();

  setInterval(function () { tickClock(); renderSpotifyProgress(); }, 1000); // the countdown ticks by the second near the end
  setInterval(function () { renderTimeline(); renderStatus(); renderWeather(); }, 60 * 1000);
  setInterval(loadCalendar, 5 * MIN);
  setInterval(loadWeather, 15 * MIN);
  setInterval(loadNews, 15 * MIN);
  var sportsTicks = 0;
  setInterval(function () { sportsTicks++; if (sportsLive() || sportsTicks % 5 === 0) loadSports(); }, 60 * 1000);
  setInterval(function () {
    spotifyPolls++;
    if ((spotify && spotify.playing) || spotifyPolls % 3 === 0) loadSpotify();
  }, 10 * 1000);
  setInterval(checkForUpdate, 10 * MIN);
  setTimeout(checkForUpdate, 30 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refreshAll(); checkForUpdate(); } });
})();
