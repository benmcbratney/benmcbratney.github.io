// Home Hub — front end. Plain JS, no build step, written for Safari 15 on an iPad Air 2.
(function () {
  "use strict";

  // ------------------------------------------------------------- settings

  var DEFAULTS = {
    workerUrl: "",
    hubKey: "",
    placeName: "Lake Forest",
    lat: "42.2586",
    lon: "-87.8406",
    nightStart: "22",
    nightEnd: "6",
    days: "5",
    photoUrl: "",
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
    s.photoUrl = saved.photoUrl || "";
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
      if (res.ok) return res.json();
      // Keep the Worker's own explanation (e.g. "Spotify Premium is needed…").
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(path + " → HTTP " + res.status + (body && body.error ? ": " + body.error : ""));
      });
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ------------------------------------------------------------- status line

  var problems = {};
  var lastSync = null;
  // Every loader reports here; a clean report also means fresh data, so bump "Updated".
  function setProblem(key, msg) {
    if (msg) problems[key] = msg; else { delete problems[key]; lastSync = new Date(); }
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
    renderPrecipAlert(now);
    updateBackdrop();

    var night = isNightHour(h) && Date.now() > wakeUntil && $("settings").hidden;
    $("night").hidden = !night;
    document.body.classList.toggle("is-night", night);
    if (night) {
      $("night-time").textContent = timeText;
      $("night-next").textContent = nextEventLine(now);
      $("night-wx").textContent = nightForecastLine(now);
    }

    // Reload once a night to keep an old iPad's memory tidy and pick up code updates.
    if (h === 3 && now.getMinutes() === 30 && performance.now() > 120000 && !timers.length) freshReload(window.HUB_VERSION || "");
  }

  $("night").addEventListener("click", function () {
    wakeUntil = Date.now() + 2 * 60 * 1000;
    tickClock();
  });

  // ------------------------------------------------------------- photo backdrop
  // A freely licensed Wikimedia Commons photo that matches the current weather
  // (photographers are credited in README.md rather than on the wall),
  // loaded by the iPad at runtime. At night the photo is dimmed (or swapped for a
  // starry sky when it's clear).

  var PHOTOS = {
    clear: { file: "Gfp-illinois-chicago-lake-michigan-horizon.jpg", credit: "Yinan Chen, public domain" },
    partly: { file: "Blue-skies-cumulus-clouds.jpg", credit: "Cbuske46" },
    night: { file: "Starry night sky.jpg", credit: "Eddie Basler" },
    cloudy: { file: "Grey cloudy sky.jpg", credit: "Gnu-Bricoleur, CC BY 4.0" },
    fog: { file: "Early morning fog.jpg", credit: "public domain" },
    rain: { file: "Raindrops on a window.jpg", credit: "Andromeda2064" },
    snow: { file: "Winter forest after snow storm (45643768335).jpg", credit: "Tom Ek" },
    storm: { file: "Lightning cloud to cloud (aka).jpg", credit: "André Karwath, CC BY-SA 2.5" },
  };
  var sun = null; // { rise: Date, set: Date } from the weather feed
  var currentWx = null; // { code, isDay } from the weather feed
  var shownPhoto = null;
  var frontLayer = "bg-a";
  var failedPhotos = {}; // url -> time to try again

  function commonsUrl(file, width) {
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file.replace(/ /g, "_")) + "?width=" + width;
  }

  // WMO weather code → photo.
  function photoKind(code, isDay) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code === 3) return "cloudy";
    if (!isDay) return code === 2 ? "cloudy" : "night";
    return code === 2 ? "partly" : "clear";
  }

  function currentPhoto() {
    if (settings.photoUrl) return { url: settings.photoUrl };
    if (!currentWx) return null; // keep the plain gradient until the first forecast arrives
    var p = PHOTOS[photoKind(currentWx.code, currentWx.isDay)];
    return { url: commonsUrl(p.file, 1920) };
  }

  function updateBackdrop() {
    // Dim photos after dark, except the starry sky, which is already dark.
    var dim = !!currentWx && !currentWx.isDay && !settings.photoUrl &&
      photoKind(currentWx.code, currentWx.isDay) !== "night";
    document.querySelector(".backdrop").classList.toggle("dim", dim);
    // Smoky dark panels with light text once the sun is down (any photo).
    document.body.classList.toggle("glass-dark", !!currentWx && !currentWx.isDay && !settings.photoUrl);
    var photo = currentPhoto();
    if (!photo || shownPhoto === photo.url) return;
    if (failedPhotos[photo.url] > Date.now()) return;
    shownPhoto = photo.url;
    // Preload, then crossfade, so the wall never flashes blank.
    var img = new Image();
    img.onload = function () {
      if (shownPhoto !== photo.url) return;
      var back = frontLayer === "bg-a" ? "bg-b" : "bg-a";
      $(back).style.backgroundImage = "url(\"" + photo.url + "\")";
      $(back).classList.add("show");
      $(frontLayer).classList.remove("show");
      frontLayer = back;
    };
    img.onerror = function () {
      failedPhotos[photo.url] = Date.now() + 10 * 60 * 1000; // try again in 10 minutes
      if (shownPhoto === photo.url) shownPhoto = null;
    };
    img.src = photo.url;
  }

  function nthWeekday(year, month, weekday, n) {
    var first = new Date(year, month, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }

  // ------------------------------------------------------------- family
  // Names come from the Worker's FAMILY secret, so they never live in this public repo.
  // They pick out family birthdays for the countdowns.

  var fam = null;

  function loadFamily() {
    if (demo) {
      kidsQuickAdd = ["Kid One school clothes", "Kid Two school clothes", "More pull-ups"];
      return Promise.resolve();
    }
    return api("/family").then(function (data) {
      fam = data.family || null;
      kidsQuickAdd = data.kidsQuickAdd || [];
    }).catch(function () {});
  }

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
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max" +
      "&hourly=precipitation_probability,temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m&minutely_15=precipitation,snowfall&forecast_minutely_15=8" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var c = d.current, day = d.daily;
        dailyWx = day;
        hourlyWx = d.hourly;
        currentWx = { code: c.weather_code, isDay: !!c.is_day, tempF: c.temperature_2m };
        updateBackdrop();
        storePrecip(d);
        if (day.sunrise && day.sunset) {
          sun = { rise: parseWall(day.sunrise[0]), set: parseWall(day.sunset[0]) };
          updateBackdrop();
        }
        var now = wmo(c.weather_code, c.is_day);
        var box = $("weather");
        box.innerHTML = "";

        // 5-day strip: today + the next four days.
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
          cell.appendChild(el("div", "fc-pop", pop >= 20 ? "💧" + pop + "%" : "\u00a0"));
          strip.appendChild(cell);
        }

        var detail = el("div", "wx-detail");
        detail.appendChild(el("b", null, now[1]));
        detail.appendChild(el("div", null, "Feels " + Math.round(c.apparent_temperature) + "° · wind " + Math.round(c.wind_speed_10m)));
        if (sun) {
          var t = new Date();
          var sunLine = t < sun.rise ? "Sunrise " + fmtTime(sun.rise) : t < sun.set ? "Sunset " + fmtTime(sun.set) : settings.placeName;
          detail.appendChild(el("div", null, sunLine));
        }

        var nowBox = el("div", "wx-now");
        nowBox.appendChild(el("span", "wx-icon", now[0]));
        nowBox.appendChild(el("span", "wx-temp", Math.round(c.temperature_2m) + "°"));

        var main = el("div", "wx-main");
        main.appendChild(detail);
        main.appendChild(nowBox);
        main.appendChild(strip);
        box.appendChild(main);
        renderWearCard();
        if (!$("hourly").hidden) renderHourly();
        setProblem("weather", null);
      })
      .catch(function (e) { setProblem("weather", e.message); });
  }

  // ------------------------------------------------------------- what to wear
  // Picture-first clothing tips for the kids, from the "feels like" temperatures,
  // rain/snow chances, wind and UV across the daytime (7am–7pm). From 5pm it
  // looks ahead to tomorrow, so it's ready for getting dressed in the morning.

  function outfit(now) {
    if (!hourlyWx || !hourlyWx.time || !dailyWx) return null;
    var tomorrow = now.getHours() >= 17;
    var day = tomorrow ? addDays(now, 1) : now;
    var key = ymd(day), from = 7, to = 19;
    var feels = [], pop = 0, wind = 0, snowy = false, rainy = false;
    hourlyWx.time.forEach(function (t, i) {
      var at = parseWall(t);
      if (ymd(at) !== key || at.getHours() < from || at.getHours() >= to) return;
      if (!tomorrow && at.getTime() + 3600e3 < now.getTime()) return; // rest of today only
      var feel = hourlyWx.apparent_temperature ? hourlyWx.apparent_temperature[i] : hourlyWx.temperature_2m[i];
      feels.push(feel);
      var p = hourlyWx.precipitation_probability[i] || 0, c = hourlyWx.weather_code[i];
      pop = Math.max(pop, p);
      wind = Math.max(wind, hourlyWx.wind_speed_10m[i] || 0);
      var snowCode = (c >= 71 && c <= 77) || c === 85 || c === 86;
      if (p >= 40 && snowCode) snowy = true;
      if (p >= 40 && !snowCode && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95)) rainy = true;
    });
    if (!feels.length) return null;
    var lo = Math.min.apply(null, feels), hi = Math.max.apply(null, feels);
    var di = dailyWx.time.indexOf(key);
    var uv = di >= 0 && dailyWx.uv_index_max ? dailyWx.uv_index_max[di] : 0;

    var items = [];
    if (lo < 33) items.push(["🧥", "Big coat"], ["🧣", "Hat & scarf"], ["🧤", "Mittens"]);
    else if (lo < 50) items.push(["🧥", "Coat"]);
    else if (lo < 60) items.push(["🧥", "Light jacket"]);
    if (hi >= 70) items.push(["👕", "T-shirt"], ["🩳", "Shorts"]);
    else {
      items.push(["👔", "Long sleeves"]);
      if (!snowy) items.push(["👖", "Pants"]);
    }
    if (snowy) items.push(["👖", "Snow pants"], ["🥾", "Snow boots"]);
    else if (rainy) items.push(["☂️", "Umbrella"], ["🥾", "Rain boots"]);
    else if (pop >= 40) items.push(["☂️", "Umbrella"]);
    if (uv >= 6 && hi >= 60) items.push(["🧴", "Sunscreen"]);
    if (wind >= 20) items.push(["💨", "Windy!"]);
    return { when: tomorrow ? "Tomorrow" : "Today", items: items.slice(0, 7), lo: Math.round(lo), hi: Math.round(hi) };
  }

  function outfitRow(wear, cls) {
    var row = el("div", cls);
    row.appendChild(el("span", "wear-when", wear.when + ", wear"));
    wear.items.forEach(function (it) {
      var item = el("span", "wear-item");
      item.appendChild(el("span", "wear-icon", it[0]));
      item.appendChild(el("span", "wear-label", it[1]));
      row.appendChild(item);
    });
    return row;
  }

  // Big "What to wear" card in the right column, sized for kids across the room.
  function renderWearCard() {
    var wear = outfit(new Date());
    $("wear-card").hidden = !wear;
    layoutColumns();
    if (!wear) return;
    $("wear-title").textContent = "What to wear " + wear.when.toLowerCase();
    var box = $("wear-items");
    box.innerHTML = "";
    box.className = "wear-grid" + (wear.items.length > 4 ? " many" : ""); // 5+ items: two rows of smaller tiles
    wear.items.forEach(function (it) {
      var item = el("div", "wear-tile");
      item.appendChild(el("div", "wear-tile-icon", it[0]));
      item.appendChild(el("div", "wear-tile-label", it[1]));
      box.appendChild(item);
    });
    $("wear-sub").textContent = "Feels like " + wear.lo + "° to " + wear.hi + "°";
  }

  // ------------------------------------------------------------- hourly forecast pop-up
  // Tap the weather in the header: the next 24 hours as columns, with each hour's
  // temperature riding higher or lower so the day's curve is easy to see.

  var hourlyWx = null;
  var HOURS_SHOWN = 24;

  function renderHourly() {
    var box = $("hourly-list");
    box.innerHTML = "";
    if (!hourlyWx || !hourlyWx.time) { box.appendChild(el("div", "music-note", "Forecast is still loading…")); return; }
    var now = new Date();
    var thisHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    var hours = [];
    hourlyWx.time.forEach(function (t, i) {
      var at = parseWall(t);
      if (at >= thisHour && hours.length < HOURS_SHOWN) hours.push({ at: at, i: i });
    });
    if (!hours.length) return;
    var temps = hours.map(function (h) { return hourlyWx.temperature_2m[h.i]; });
    var hi = Math.max.apply(null, temps), lo = Math.min.apply(null, temps);

    // Sunrise/sunset markers that fall inside the window.
    var marks = [];
    if (dailyWx && dailyWx.sunrise) {
      dailyWx.sunrise.forEach(function (t) { marks.push({ at: parseWall(t), icon: "🌅", label: "Sunrise" }); });
      dailyWx.sunset.forEach(function (t) { marks.push({ at: parseWall(t), icon: "🌇", label: "Sunset" }); });
    }
    var end = new Date(hours[hours.length - 1].at.getTime() + 3600e3);

    var lastDay = thisHour.getDate();
    hours.forEach(function (h, n) {
      var i = h.i, temp = Math.round(hourlyWx.temperature_2m[i]);
      var icon = wmo(hourlyWx.weather_code[i], hourlyWx.is_day[i])[0];
      // "Now" matches the big current reading in the header.
      if (n === 0 && currentWx) { temp = Math.round(currentWx.tempF); icon = wmo(currentWx.code, currentWx.isDay)[0]; }
      var col = el("div", "hr-col" + (n === 0 ? " now" : ""));
      var label = n === 0 ? "Now" : fmtTime(h.at);
      if (h.at.getDate() !== lastDay) { col.className += " new-day"; label = DAY_NAMES[h.at.getDay()].slice(0, 3) + " " + label; lastDay = h.at.getDate(); }
      col.appendChild(el("div", "hr-time", label));
      col.appendChild(el("div", "hr-icon", icon));
      // Higher temperature = sits higher in its 60px lane.
      var lane = el("div", "hr-lane");
      var t = el("div", "hr-temp", temp + "°");
      t.style.top = (hi === lo ? 30 : Math.round((hi - hourlyWx.temperature_2m[i]) / (hi - lo) * 60)) + "px";
      lane.appendChild(t);
      col.appendChild(lane);
      var pop = hourlyWx.precipitation_probability[i] || 0;
      var bar = el("div", "hr-bar");
      var fill = el("div", "hr-fill");
      fill.style.height = pop + "%";
      bar.appendChild(fill);
      col.appendChild(bar);
      col.appendChild(el("div", "hr-pop", pop >= 10 ? pop + "%" : "\u00a0"));
      col.appendChild(el("div", "hr-wind", Math.round(hourlyWx.wind_speed_10m[i]) + " mph"));
      box.appendChild(col);

      marks.forEach(function (m) {
        if (m.at >= h.at && m.at < new Date(h.at.getTime() + 3600e3) && m.at > now && m.at < end) {
          var mk = el("div", "hr-col hr-mark");
          mk.appendChild(el("div", "hr-time", fmtTime(m.at)));
          mk.appendChild(el("div", "hr-icon", m.icon));
          mk.appendChild(el("div", "hr-mark-label", m.label));
          box.appendChild(mk);
        }
      });
    });

    var wearBox = $("hourly-wear");
    wearBox.innerHTML = "";
    var wear = outfit(now);
    if (wear) {
      wearBox.appendChild(outfitRow(wear, "wear-big"));
      wearBox.lastChild.appendChild(el("span", "wear-feels", "Feels like " + wear.lo + "°–" + wear.hi + "°"));
    }

    var summary = settings.placeName + " · next 24 hours: high " + Math.round(hi) + "°, low " + Math.round(lo) + "°";
    var maxPop = Math.max.apply(null, hours.map(function (h) { return hourlyWx.precipitation_probability[h.i] || 0; }));
    if (maxPop >= 30) summary += " · up to " + maxPop + "% chance of precipitation";
    $("hourly-summary").textContent = summary;
  }

  $("weather").addEventListener("click", function () {
    renderHourly();
    $("hourly").hidden = false;
    $("hourly-list").scrollLeft = 0;
  });
  $("hourly-done").addEventListener("click", function () { $("hourly").hidden = true; });

  // ------------------------------------------------------------- rain / snow in the next hour
  // Open-Meteo's 15-minute data (NOAA HRRR in the US). Each value is the total for
  // the 15 minutes *ending* at its timestamp.

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
    var Q = 15 * 60 * 1000, H = 60 * 60 * 1000;
    var horizon = new Date(now.getTime() + H);
    var slots = precip.slots.filter(function (s) { return s.end > now && s.end - Q < horizon; });
    var wet = function (s) { return s.mm >= 0.1 || s.snowCm >= 0.05; };
    var firstWet = -1;
    for (var i = 0; i < slots.length; i++) if (wet(slots[i])) { firstWet = i; break; }

    if (firstWet >= 0) {
      var run = slots.slice(firstWet);
      var snow = run.some(function (s) { return wet(s) && s.snowCm >= 0.05; });
      var word = snow ? "Snow" : "Rain";
      var icon = snow ? "🌨" : "☔";
      var start = new Date(slots[firstWet].end - Q);
      if (start <= now) {
        // Already falling: say when it lets up, if that's within the hour.
        for (var j = 0; j < run.length; j++) {
          if (!wet(run[j])) return { text: icon + " " + word + " now · letting up around " + fmtTime(run[j - 1].end), snow: snow };
        }
        return { text: icon + " " + word + " now · grab an umbrella", snow: snow };
      }
      return { text: icon + " " + word + " starting around " + fmtTime(start), snow: snow };
    }

    // Nothing in the 15-minute data: fall back to the hourly chance of precipitation.
    var best = 0;
    precip.hours.forEach(function (hr) {
      if (hr.start < horizon && hr.start.getTime() + H > now.getTime()) best = Math.max(best, hr.prob || 0);
    });
    if (best >= 50) {
      var cold = precip.tempF != null && precip.tempF <= 34;
      return { text: (cold ? "🌨 " : "☔ ") + best + "% chance of " + (cold ? "snow" : "rain") + " this hour", snow: cold };
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

  // ------------------------------------------------------------- sports scores
  // From the Worker's /sports (ESPN). A Scores card under the calendar shows each
  // active team's live/last result and next game; tap it for the full pop-up.

  var sports = null;
  var DAY_MS = 864e5;

  function loadSports() {
    var p = demo ? Promise.resolve(demoSports()) : api("/sports");
    return p.then(function (data) {
      sports = data.teams || [];
      layoutColumns();
      if (!$("scores-modal").hidden) renderScores();
      setProblem("scores", null);
    }).catch(function (e) {
      if (/HTTP 404/.test(e.message)) { sports = null; layoutColumns(); return; } // older Worker
      setProblem("scores", e.message);
    });
  }

  function sportsLive() {
    return !!sports && sports.some(function (t) { return t.live; });
  }

  function gameWhen(ms, now) {
    var d = new Date(ms);
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / DAY_MS);
    var day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
      : days > 1 && days < 7 ? DAY_NAMES[d.getDay()].slice(0, 3) : MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
    return days < 0 ? day : day + " " + fmtTime(d);
  }

  function vsLine(g) { return (g.home ? "vs " : "@ ") + g.them; }

  var SHORT_NAMES = { Blackhawks: "Hawks", Northwestern: "NU" };
  // "Today 6p" / "Tmrw 12p" (tiles only ever show today's and tomorrow's games).
  function shortWhen(ms, now) {
    return gameWhen(ms, now).replace("Tomorrow", "Tmrw");
  }

  // Compact two-column grid under the calendar (today/tomorrow's games only). Returns false
  // when nobody's playing, which hides the card.
  function renderScoreCard() {
    var box = $("scores-mini");
    box.innerHTML = "";
    if (!sports) return false;
    var now = new Date();
    // Only teams with a game yesterday, today or tomorrow.
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var within = function (g, from, to) { return !!(g && g.start && g.start >= from && g.start < to); };
    var shown = sports.filter(function (t) {
      return !t.error && (t.live || within(t.next, today, today + 2 * DAY_MS) || within(t.last, today - DAY_MS, today + DAY_MS));
    });
    // One line per team showing just one game, in this order: live now, finished today,
    // yesterday's final, else the next game ("🐻 Bears @ GB · Tmrw 12p"). Sorted the same
    // way; the game clock and TV channel are in the pop-up.
    var opp = function (x) { return (x.home ? "vs " : "@ ") + (x.themAbbr || x.them); };
    var rank = function (t) {
      return t.live ? 0 : within(t.last, today, today + DAY_MS) ? 1 : within(t.last, today - DAY_MS, today) ? 2 : 3;
    };
    shown.sort(function (a, b) { return rank(a) - rank(b); });
    shown.forEach(function (t) {
      var r = rank(t);
      var final = r === 1 || r === 2 ? t.last : null;
      var g = t.live || final || t.next;
      var tile = el("div", "sm-tile" + (t.live ? " live" : ""));
      tile.appendChild(el("span", "sm-emoji", t.emoji));
      var info = el("span", "sm-name", SHORT_NAMES[t.name] || t.name);
      info.appendChild(el("span", "sm-opp", " " + opp(g)));
      tile.appendChild(info);
      var main = el("span", "sm-result");
      if (t.live || final) {
        if (r === 2) main.appendChild(el("span", "sm-when", "Yest "));
        if (t.live) main.appendChild(el("span", "sc-badge live", "LIVE"));
        else main.appendChild(el("b", "sm-wl " + (g.won ? "win" : g.won === false ? "loss" : ""), g.won ? "W" : g.won === false ? "L" : "T"));
        main.appendChild(el("b", null, " " + g.usScore + "–" + g.themScore));
      } else {
        main.appendChild(el("b", null, shortWhen(g.start, now)));
      }
      tile.appendChild(main);
      box.appendChild(tile);
    });
    return shown.length > 0;
  }
  $("scores-card").addEventListener("click", function () { openScores(); });

  function renderScores() {
    var box = $("scores-list");
    box.innerHTML = "";
    if (!sports) { box.appendChild(el("div", "music-note", "Loading scores…")); return; }
    var now = new Date();
    sports.forEach(function (t) {
      var row = el("div", "sc-row" + (t.live ? " live" : ""));
      var who = el("div", "sc-team");
      who.appendChild(el("span", "sc-emoji", t.emoji));
      var nm = el("div", "sc-name", t.name);
      if (t.record) nm.appendChild(el("span", "sc-record", t.record));
      who.appendChild(nm);
      row.appendChild(who);

      if (t.error) { row.appendChild(el("div", "sc-cell sc-muted", "Couldn't load (" + t.error + ")")); box.appendChild(row); return; }

      var lastCell = el("div", "sc-cell");
      if (t.live) {
        lastCell.appendChild(el("span", "sc-badge live", "LIVE"));
        lastCell.appendChild(el("b", null, " " + t.live.usScore + "–" + t.live.themScore + " "));
        lastCell.appendChild(document.createTextNode(vsLine(t.live) + " · " + t.live.detail));
      } else if (t.last) {
        var res = t.last.won ? "W" : t.last.won === false ? "L" : "T";
        lastCell.appendChild(el("span", "sc-badge " + (t.last.won ? "win" : t.last.won === false ? "loss" : ""), res));
        lastCell.appendChild(el("b", null, " " + t.last.usScore + "–" + t.last.themScore + " "));
        lastCell.appendChild(document.createTextNode(vsLine(t.last) + " · " + gameWhen(t.last.start, now)));
      } else lastCell.appendChild(el("span", "sc-muted", "No games yet"));
      row.appendChild(lastCell);

      var nextCell = el("div", "sc-cell");
      if (t.next) {
        nextCell.appendChild(el("span", "sc-label", "Next "));
        nextCell.appendChild(document.createTextNode(vsLine(t.next) + " · " + gameWhen(t.next.start, now) + (t.next.tv ? " · " + t.next.tv : "")));
      } else nextCell.appendChild(el("span", "sc-muted", t.live ? "" : "Off-season"));
      row.appendChild(nextCell);
      box.appendChild(row);
    });
  }

  function openScores() {
    renderScores();
    $("scores-modal").hidden = false;
    loadSports();
  }
  $("scores-done").addEventListener("click", function () { $("scores-modal").hidden = true; });

  function demoSports() {
    var now = Date.now(), H = 3600e3;
    var g = function (o) { return Object.assign({ id: String(Math.random()), tv: null, won: null, usScore: null, themScore: null, detail: "" }, o); };
    return { teams: [
      { key: "bears", name: "Bears", emoji: "🐻", record: "3-2", live: g({ state: "in", start: now - 2 * H, home: true, them: "Packers", usScore: "17", themScore: "10", detail: "3rd 8:12", tv: "FOX" }),
        last: g({ state: "post", start: now - 7 * DAY_MS, home: false, them: "Lions", usScore: "24", themScore: "20", won: true }), next: null },
      { key: "cubs", name: "Cubs", emoji: "⚾", record: "92-70", live: null,
        last: g({ state: "post", start: now - 14 * H, home: true, them: "Brewers", usScore: "5", themScore: "3", won: true }),
        next: g({ state: "pre", start: now + 26 * H, home: false, them: "Brewers", tv: "TBS" }) },
      { key: "bulls", name: "Bulls", emoji: "🐂", record: null, live: null, last: null,
        next: g({ state: "pre", start: now + 11 * DAY_MS, home: true, them: "Pistons", tv: "CHSN" }) },
      { key: "blackhawks", name: "Blackhawks", emoji: "🏒", record: "1-1-0", live: null,
        last: g({ state: "post", start: now - 2 * DAY_MS, home: true, them: "Blues", usScore: "2", themScore: "4", won: false }),
        next: g({ state: "pre", start: now + 4 * H, home: false, them: "Wild" }) },
      { key: "nu-football", name: "Northwestern", emoji: "🏈", record: "3-2", live: null,
        last: g({ state: "post", start: now - 7 * DAY_MS, home: true, them: "Purdue", usScore: "31", themScore: "17", won: true }),
        next: g({ state: "pre", start: now + DAY_MS, home: false, them: "Iowa", tv: "BTN" }) },
      { key: "nu-hoops", name: "Northwestern", emoji: "🏀", record: null, live: null, last: null, next: null },
    ] };
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
        var bar = el("span", "bar");
        if (e.color) bar.style.background = e.color;
        row.appendChild(bar);
        row.appendChild(el("span", "when", e.allDay ? "All day" : fmtTime(e.start)));
        var what = el("span", "what", e.title);
        if (e.location) what.appendChild(el("span", "where", e.location));
        row.appendChild(what);
        if (!e.allDay && e.start <= now && e.end > now) {
          row.appendChild(el("span", "pill", "Now"));
        } else if (!e.allDay && e.start > now && e.start - now <= 60 * 60 * 1000) {
          row.appendChild(el("span", "pill", "in " + Math.max(1, Math.round((e.start - now) / 60000)) + " min"));
        }
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    }
  }

  // Before midnight the next day is "tomorrow" (daily[1]); after midnight it's today (daily[0]).
  var dailyWx = null;
  function nightForecastLine(now) {
    if (!dailyWx || !dailyWx.time) return "";
    var target = now.getHours() < 12 ? now : addDays(now, 1);
    var i = dailyWx.time.indexOf(ymd(target));
    if (i < 0) return "";
    var label = now.getHours() < 12 ? "Today" : "Tomorrow";
    return label + ": " + wmo(dailyWx.weather_code[i], 1)[0] + " " + wmo(dailyWx.weather_code[i], 1)[1] + " · " +
      Math.round(dailyWx.temperature_2m_max[i]) + "° / " + Math.round(dailyWx.temperature_2m_min[i]) + "° · " +
      dailyWx.precipitation_probability_max[i] + "% precip";
  }

  function nextEventLine(now) {
    var tomorrowEnd = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 2);
    var next = events.filter(function (e) { return !e.allDay && e.start > now && e.start < tomorrowEnd; })
      .sort(function (a, b) { return a.start - b.start; })[0];
    if (!next) return "";
    var isToday = next.start.getDate() === now.getDate();
    return "Next: " + next.title + " · " + (isToday ? "" : "tomorrow ") + fmtTime(next.start);
  }

  // ------------------------------------------------------------- countdowns
  // Days-until pills in a row along the bottom of the header. Three sources, in priority order:
  //   1. Calendar events tagged with ⏳ or "countdown" in the title (a year ahead)
  //   2. Family birthdays (all-day "birthday" events naming someone in FAMILY)
  //   3. Built-in holidays, once they're within HOLIDAY_WINDOW days
  // Tag an event "🏖️ Florida trip ⏳" in Google Calendar and it shows up here.

  var MAX_COUNTDOWNS = 4;
  var HOLIDAY_WINDOW = 60;
  var BIRTHDAY_WINDOW = 60;
  var calCountdowns = [];

  function easter(year) {
    // Anonymous Gregorian algorithm.
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function holidays(year) {
    return [
      ["🎆", "New Year's", new Date(year, 0, 1)],
      ["❤️", "Valentine's Day", new Date(year, 1, 14)],
      ["☘️", "St. Patrick's Day", new Date(year, 2, 17)],
      ["🐣", "Easter", easter(year)],
      ["💐", "Mother's Day", new Date(year, 4, nthWeekday(year, 4, 0, 2))],
      ["👔", "Father's Day", new Date(year, 5, nthWeekday(year, 5, 0, 3))],
      ["🎇", "Fourth of July", new Date(year, 6, 4)],
      ["🎃", "Halloween", new Date(year, 9, 31)],
      ["🦃", "Thanksgiving", new Date(year, 10, nthWeekday(year, 10, 4, 4))],
      ["🎄", "Christmas", new Date(year, 11, 25)],
    ];
  }

  // Leading emoji (with skin tones, flags and ZWJ sequences) becomes the tile icon.
  var LEAD_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator})*)\s*/u;

  function cleanCountdownTitle(title) {
    var t = title.replace(/⏳️?/g, "").replace(/\bcountdown\b\s*:?/ig, "")
      .replace(/\s{2,}/g, " ").replace(/^[\s:–—-]+|[\s:–—-]+$/g, "");
    var m = LEAD_EMOJI.exec(t);
    return m ? { icon: m[1], label: t.slice(m[0].length) || t } : { icon: "⏳", label: t || title };
  }

  function daysUntil(date, today) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((d - today) / 864e5); // round() absorbs DST's 23/25-hour days
  }

  function familyName(title) {
    if (!fam) return null;
    var everyone = fam.parents.concat(fam.kids, fam.dog ? [fam.dog] : []);
    return everyone.filter(function (n) { return title.toLowerCase().indexOf(n.toLowerCase()) >= 0; })[0] || null;
  }

  function countdownItems(now) {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tagged = [], bdays = [], hols = [];
    calCountdowns.forEach(function (e) {
      if (!e.allDay && e.end <= now) return; // already over
      var days = Math.max(0, daysUntil(e.start, today));
      if (/⏳|\bcountdown\b/i.test(e.title)) {
        var c = cleanCountdownTitle(e.title);
        tagged.push({ icon: c.icon, label: c.label, days: days });
      } else {
        var who = familyName(e.title);
        if (who && days <= BIRTHDAY_WINDOW) bdays.push({ icon: "🎂", label: who + "'s birthday", short: who, days: days });
      }
    });
    [now.getFullYear(), now.getFullYear() + 1].forEach(function (y) {
      holidays(y).forEach(function (h) {
        var days = daysUntil(h[2], today);
        if (days >= 0 && days <= HOLIDAY_WINDOW) hols.push({ icon: h[0], label: h[1], days: days });
      });
    });
    var byDays = function (a, b) { return a.days - b.days; };
    [tagged, bdays, hols].forEach(function (g) { g.sort(byDays); });
    return tagged.concat(bdays, hols).slice(0, MAX_COUNTDOWNS).sort(byDays);
  }

  function loadCountdowns() {
    var p = demo ? Promise.resolve(demoCountdowns()) : api("/countdowns");
    return p.then(function (data) {
      calCountdowns = data.events.map(function (e) {
        return { title: e.title, allDay: e.allDay, start: parseWall(e.start), end: parseWall(e.end || e.start) };
      });
      renderCountdowns();
    }).catch(function (e) {
      // An older Worker without /countdowns still gets the built-in holidays.
      if (!/HTTP 404/.test(e.message)) setProblem("countdowns", e.message);
      renderCountdowns();
    });
  }

  function renderCountdowns() {
    var box = $("countdowns");
    var items = countdownItems(new Date());
    box.innerHTML = "";
    box.hidden = !items.length;
    // Header pills, soonest first; any that don't fit on one line are clipped.
    items.forEach(function (c) {
      var pill = el("span", "cd-pill" + (c.days === 0 ? " today" : ""), c.icon + " " + c.label + " · ");
      pill.appendChild(el("b", null, c.days === 0 ? "Today!" : c.days === 1 ? "Tomorrow" : c.days + " days"));
      box.appendChild(pill);
    });
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
      learnGroceries(lists.grocery);
      if (!$("picker").hidden) renderChips();
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

  // Kids and Groceries live in footer pills with a count; tapping one opens a pop-up
  // with the list (tap to check off) and the one-tap add buttons.
  function renderList(name) {
    var items = name === "chores" ? visibleChores() : lists.grocery;
    $(name + "-count").textContent = items.length;
    $("pill-" + name).classList.toggle("has-items", items.length > 0);
    if ($("picker").hidden || pickerList !== name) return;
    var ul = $("picker-tasks");
    ul.innerHTML = "";
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

  // Left: calendar, Scores, Spotify. Right: thermostats and What to wear. If nothing's
  // on the right, the left column takes the full width.
  function layoutColumns() {
    $("scores-card").hidden = !renderScoreCard();
    var cards = document.querySelectorAll(".col-right > .card");
    var any = false;
    for (var i = 0; i < cards.length; i++) if (!cards[i].hidden) any = true;
    $("hub").classList.toggle("right-empty", !any);
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
          if (name === "chores" && !visibleChores().length) celebrate();
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

  function celebrate() {
    var card = document.querySelector(".list-card");
    var colors = ["#c8553d", "#f2b134", "#4f8cff", "#7a9e7e", "#b07cc6", "#ffffff"];
    for (var i = 0; i < 36; i++) {
      var c = el("span", "confetti");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.5 + "s";
      c.style.setProperty("--drift", (Math.random() * 120 - 60) + "px");
      card.appendChild(c);
    }
    setTimeout(function () {
      var bits = card.querySelectorAll(".confetti");
      for (var j = 0; j < bits.length; j++) bits[j].remove();
    }, 3200);
  }

  // ------------------------------------------------------------- one-tap groceries
  // The wall iPad's keyboard is unreliable (an iPadOS home-screen app bug), so + opens
  // a grid of one-tap items: the household staples first, then anything else that's
  // shown up on the list before, most frequent first. "Type something else…" uses the
  // system prompt for when the keyboard cooperates.

  var GROCERY_STAPLES = [
    "Milk", "Sandy bread", "Kids yogurt", "Dad yogurt", "Bagels", "Mofns",
    "Bananas", "Strawberries", "Blueberries", "Turkey", "Cheese",
  ];
  var HISTORY_KEY = "homehub.groceryHistory";
  var groceryHistory = { counts: {}, seen: [] };
  try { groceryHistory = JSON.parse(localStorage.getItem(HISTORY_KEY)) || groceryHistory; } catch (e) {}
  var pendingAdds = {}; // "list:lowercased name" -> true while the add is in flight

  function norm(name) { return String(name).trim().toLowerCase(); }

  // Learn items as they appear on the list (including ones added from a phone).
  function learnGroceries(items) {
    var seen = groceryHistory.seen || [];
    var changed = false;
    items.forEach(function (t) {
      if (!t.id || seen.indexOf(t.id) >= 0) return;
      seen.push(t.id);
      var key = (t.content || "").trim();
      if (!key) return;
      groceryHistory.counts[key] = (groceryHistory.counts[key] || 0) + 1;
      changed = true;
    });
    if (!changed) return;
    groceryHistory.seen = seen.slice(-500);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(groceryHistory)); } catch (e) {}
  }

  function groceryChoices() {
    var staples = {};
    GROCERY_STAPLES.forEach(function (n) { staples[norm(n)] = true; });
    var learned = Object.keys(groceryHistory.counts)
      .filter(function (n) { return !staples[norm(n)]; })
      .sort(function (a, b) { return groceryHistory.counts[b] - groceryHistory.counts[a]; })
      .slice(0, 9);
    return GROCERY_STAPLES.concat(learned);
  }

  // Kids quick-adds come from the Worker's KIDS_QUICK_ADD variable (they name the
  // kids, so they stay out of this public repo).
  var kidsQuickAdd = [];
  var PICKERS = {
    grocery: { title: "🛒 Groceries", choices: groceryChoices },
    chores: { title: "🧒 Kids", choices: function () { return kidsQuickAdd; } },
  };
  var pickerList = "grocery";

  function onList(list, name) {
    var n = norm(name);
    return lists[list].some(function (t) { return norm(t.content) === n; });
  }

  function renderChips() {
    var list = pickerList, box = $("picker-chips");
    box.innerHTML = "";
    var choices = PICKERS[list].choices();
    if (!choices.length) box.appendChild(el("div", "empty", "No quick-add buttons yet — see KIDS_QUICK_ADD in the README."));
    choices.forEach(function (name) {
      var on = onList(list, name), busy = pendingAdds[list + ":" + norm(name)];
      var chip = el("button", "chip" + (on ? " on" : "") + (busy ? " busy" : ""), (on ? "✓ " : "") + name);
      chip.type = "button";
      chip.addEventListener("click", function () {
        if (onList(list, name) || pendingAdds[list + ":" + norm(name)]) return;
        addTask(list, name);
      });
      box.appendChild(chip);
    });
  }

  function addTask(list, content) {
    content = String(content).trim();
    if (!content) return;
    var key = list + ":" + norm(content);
    pendingAdds[key] = true;
    renderChips();
    var p = demo
      ? Promise.resolve({ id: "demo-" + Date.now(), content: content })
      : api("/todoist/add", { method: "POST", body: { list: list, content: content } });
    p.then(function (task) {
      lists[list].push(task);
      if (list === "grocery") learnGroceries([task]);
      renderList(list);
    }).catch(function (e) {
      setProblem("todoist", "couldn't add \"" + content + "\": " + e.message);
    }).then(function () {
      delete pendingAdds[key];
      if (!$("picker").hidden) renderChips();
    });
  }

  function openPicker(list) {
    pickerList = list;
    $("picker-title").textContent = PICKERS[list].title;
    $("picker").hidden = false;
    renderList(list);
    renderChips();
  }

  $("pill-chores").addEventListener("click", function () { openPicker("chores"); });
  $("pill-grocery").addEventListener("click", function () { openPicker("grocery"); });
  $("picker-done").addEventListener("click", function () { $("picker").hidden = true; });
  $("picker-type").addEventListener("click", function () {
    var list = pickerList;
    var content = (window.prompt("Add to " + PICKERS[list].title.replace(/^\S+ /, "")) || "").trim();
    if (content) addTask(list, content);
  });

  // ------------------------------------------------------------- Nest thermostats

  var thermostats = [];
  var pendingSet = {}; // id -> { heatF, coolF, timer }
  var demoThermostatList = null;

  function deg(f) { return f == null ? "--" : f + "°"; }
  function cToF(c) { return Math.round(c * 9 / 5 + 32); }
  function fToC(f) { return Math.round((f - 32) * 5 / 9 * 100) / 100; }

  function loadNest() {
    if (demo && !demoThermostatList) demoThermostatList = demoThermostats(); // keep demo taps
    var p = demo ? Promise.resolve({ thermostats: demoThermostatList }) : api("/nest");
    return p.then(function (data) {
      thermostats = data.thermostats || [];
      renderNest();
      setProblem("thermostat", null);
    }).catch(function (e) {
      // An older Worker without Nest support answers 404: just hide the card.
      if (/HTTP 404/.test(e.message)) { thermostats = []; renderNest(); return; }
      setProblem("thermostat", e.message);
    });
  }

  function targets(t) {
    var p = pendingSet[t.id];
    return {
      heatF: p && p.heatF != null ? p.heatF : t.heatC != null ? cToF(t.heatC) : null,
      coolF: p && p.coolF != null ? p.coolF : t.coolC != null ? cToF(t.coolC) : null,
      pending: !!p,
    };
  }

  function renderNest() {
    var card = $("nest-card");
    var show = thermostats.length > 0;
    card.hidden = !show;
    layoutColumns();
    if (!show) return;
    $("nest-title").textContent = thermostats.length > 1 ? "Thermostats" : "Thermostat";

    var box = $("nest");
    box.innerHTML = "";
    thermostats.forEach(function (t) {
      var tg = targets(t);
      var adjustable = t.online && !t.eco && t.mode !== "OFF";
      var row = el("div", "tstat" + (t.hvac === "HEATING" ? " heating" : t.hvac === "COOLING" ? " cooling" : ""));

      // Tap anywhere but the −/+ for the full controls (mode, Eco, off).
      row.addEventListener("click", function (ev) {
        if (!ev.target.closest(".t-ctrl")) openNestModal(t.id);
      });

      var info = el("div", "t-info");
      info.appendChild(el("div", "t-name", t.name));
      var status = nestStatus(t);
      if (t.humidity != null) status += " · 💧" + Math.round(t.humidity) + "%";
      info.appendChild(el("div", "t-status", status));
      row.appendChild(info);

      row.appendChild(el("div", "t-now", t.ambientC != null ? cToF(t.ambientC) + "°" : "--"));

      var ctrl = el("div", "t-ctrl");
      var minus = el("button", null, "−");
      var plus = el("button", null, "+");
      minus.setAttribute("aria-label", "Lower " + t.name);
      plus.setAttribute("aria-label", "Raise " + t.name);
      var label;
      if (t.mode === "OFF") label = "Off";
      else if (t.eco) label = "Eco";
      else if (t.mode === "HEATCOOL") label = deg(tg.heatF) + "–" + deg(tg.coolF);
      else if (t.mode === "COOL") label = deg(tg.coolF);
      else label = deg(tg.heatF);
      var target = el("span", "t-target" + (t.mode === "HEATCOOL" ? " range" : "") + (tg.pending ? " pending" : ""), label);
      // Right after a mode switch the new setpoint isn't known until the next refresh.
      minus.disabled = plus.disabled = !adjustable || label.indexOf("--") >= 0;
      minus.addEventListener("click", function () { nudge(t, -1); });
      plus.addEventListener("click", function () { nudge(t, 1); });
      ctrl.appendChild(minus);
      ctrl.appendChild(target);
      ctrl.appendChild(plus);
      row.appendChild(ctrl);

      box.appendChild(row);
    });
    renderNestModal();
  }

  function nestStatus(t) {
    return !t.online ? "Offline"
      : t.hvac === "HEATING" ? "🔥 Heating"
      : t.hvac === "COOLING" ? "❄️ Cooling"
      : t.mode === "OFF" ? "Off"
      : t.eco ? "Eco"
      : "Holding";
  }

  // `which` ("heat"/"cool") moves one end of a Heat·Cool range; the card's −/+ moves both.
  var RANGE_GAP_F = 3; // Nest keeps heat and cool setpoints at least this far apart
  function nudge(t, delta, which) {
    var tg = targets(t);
    if ((t.mode === "HEAT" || t.mode === "HEATCOOL") && tg.heatF == null) return;
    if ((t.mode === "COOL" || t.mode === "HEATCOOL") && tg.coolF == null) return;
    var clamp = function (f) { return Math.max(50, Math.min(90, f)); };
    var p = pendingSet[t.id] || {};
    if (t.mode === "HEAT" || (t.mode === "HEATCOOL" && which !== "cool")) p.heatF = clamp(tg.heatF + delta);
    if (t.mode === "COOL" || (t.mode === "HEATCOOL" && which !== "heat")) p.coolF = clamp(tg.coolF + delta);
    if (t.mode === "HEATCOOL") {
      // A range has to go out as both ends (SetRange), even if only one moved.
      if (p.heatF == null) p.heatF = tg.heatF;
      if (p.coolF == null) p.coolF = tg.coolF;
      if (p.coolF - p.heatF < RANGE_GAP_F) {
        if (which === "cool") p.heatF = p.coolF - RANGE_GAP_F; else p.coolF = p.heatF + RANGE_GAP_F;
      }
    }
    clearTimeout(p.timer);
    // Wait for the taps to stop, then send one change (Google rate-limits commands).
    p.timer = setTimeout(function () { sendSetpoint(t, p); }, 1200);
    pendingSet[t.id] = p;
    renderNest();
  }

  function sendSetpoint(t, p) {
    var body = { id: t.id };
    if (p.heatF != null) body.heatC = fToC(p.heatF);
    if (p.coolF != null) body.coolC = fToC(p.coolF);
    var send = demo ? Promise.resolve().then(function () {
      if (body.heatC != null) t.heatC = body.heatC;
      if (body.coolC != null) t.coolC = body.coolC;
    }) : api("/nest/set", { method: "POST", body: body });
    send.then(function () {
      if (pendingSet[t.id] === p) delete pendingSet[t.id];
      if (demo) renderNest(); else setTimeout(loadNest, 3000);
    }).catch(function (e) {
      if (pendingSet[t.id] === p) delete pendingSet[t.id];
      renderNest();
      setProblem("thermostat", e.message);
    });
  }

  // Thermostat pop-up: mode buttons (whatever this thermostat supports, plus Eco)
  // and big setpoint controls.
  var NEST_MODES = [["HEAT", "🔥", "Heat"], ["COOL", "❄️", "Cool"], ["HEATCOOL", "🔥❄️", "Heat · Cool"], ["OFF", "💤", "Off"]];
  var nestModalId = null;
  var pendingMode = {}; // id -> mode being sent

  function openNestModal(id) {
    nestModalId = id;
    $("tstat-modal").hidden = false;
    renderNestModal();
  }

  function closeNestModal() {
    nestModalId = null;
    $("tstat-modal").hidden = true;
  }
  $("tm-done").addEventListener("click", closeNestModal);

  function setpointRow(t, label, value, which) {
    var row = el("div", "tm-row");
    row.appendChild(el("div", "tm-label", label));
    var minus = el("button", "tm-btn", "−"), plus = el("button", "tm-btn", "+");
    minus.type = plus.type = "button";
    minus.disabled = plus.disabled = value == null || !!pendingMode[t.id];
    minus.addEventListener("click", function () { nudge(t, -1, which); });
    plus.addEventListener("click", function () { nudge(t, 1, which); });
    row.appendChild(minus);
    row.appendChild(el("div", "tm-temp" + (targets(t).pending ? " pending" : ""), deg(value)));
    row.appendChild(plus);
    return row;
  }

  function renderNestModal() {
    if (!nestModalId) return;
    var t = thermostats.filter(function (x) { return x.id === nestModalId; })[0];
    if (!t) { closeNestModal(); return; }
    var current = t.eco ? "ECO" : t.mode, sending = pendingMode[t.id];
    var tg = targets(t);

    $("tm-name").textContent = t.name;
    var info = "Inside " + (t.ambientC != null ? cToF(t.ambientC) + "°" : "--");
    if (t.humidity != null) info += " · " + Math.round(t.humidity) + "% humidity";
    $("tm-status").textContent = info + " · " + nestStatus(t);

    var modes = $("tm-modes");
    modes.innerHTML = "";
    var options = NEST_MODES.filter(function (m) { return (t.modes || ["HEAT", "COOL", "HEATCOOL", "OFF"]).indexOf(m[0]) >= 0; });
    if (t.ecoAvailable) options.push(["ECO", "🍃", "Eco"]);
    options.forEach(function (m) {
      var on = (sending || current) === m[0];
      var b = el("button", "tm-mode" + (on ? " on" : "") + (sending === m[0] ? " busy" : ""));
      b.type = "button";
      b.appendChild(el("span", "tm-mode-icon", m[1]));
      b.appendChild(el("span", null, m[2]));
      b.disabled = !t.online || !!sending;
      b.addEventListener("click", function () { if (m[0] !== current) setNestMode(t, m[0]); });
      modes.appendChild(b);
    });

    var set = $("tm-set");
    set.innerHTML = "";
    if (sending) set.appendChild(el("div", "tm-note", "Switching to " + options.filter(function (m) { return m[0] === sending; })[0][2] + "…"));
    else if (!t.online) set.appendChild(el("div", "tm-note", "This thermostat is offline."));
    else if (t.eco) set.appendChild(el("div", "tm-note", "Eco holds it between " + deg(tg.heatF) + " and " + deg(tg.coolF) +
      " to save energy. Pick a mode to take it off Eco."));
    else if (t.mode === "OFF") set.appendChild(el("div", "tm-note", "Heating and cooling are off."));
    else {
      if (t.mode === "HEAT" || t.mode === "HEATCOOL") set.appendChild(setpointRow(t, "🔥 Heat to", tg.heatF, "heat"));
      if (t.mode === "COOL" || t.mode === "HEATCOOL") set.appendChild(setpointRow(t, "❄️ Cool to", tg.coolF, "cool"));
    }
  }

  function setNestMode(t, mode) {
    if (pendingMode[t.id]) return;
    pendingMode[t.id] = mode;
    var p = pendingSet[t.id];
    if (p) { clearTimeout(p.timer); delete pendingSet[t.id]; } // the mode change wins
    renderNest();
    var send = demo ? Promise.resolve() : api("/nest/mode", { method: "POST", body: { id: t.id, mode: mode } });
    send.then(function () {
      // Show the new mode right away; the real setpoints arrive with the next refresh.
      if (mode === "ECO") t.eco = true;
      else {
        t.eco = false;
        t.mode = mode;
        if (demo) {
          if (t.heatC == null) t.heatC = 20;
          if (t.coolC == null) t.coolC = 24.4;
        }
      }
      t.hvac = "OFF";
      delete pendingMode[t.id];
      renderNest();
      if (!demo) setTimeout(loadNest, 3000);
    }).catch(function (e) {
      delete pendingMode[t.id];
      renderNest();
      setProblem("thermostat", e.message);
    });
  }

  // ------------------------------------------------------------- kitchen timers
  // Timers are saved with their end time, so a reload doesn't lose them. The chime
  // uses Web Audio, which iPadOS only allows after a tap, so audio is unlocked on the
  // tap that starts a timer (and on any later tap).

  var TIMER_KEY = "homehub.timers";
  var timers = [];
  try { timers = JSON.parse(localStorage.getItem(TIMER_KEY) || "[]") || []; } catch (e) { timers = []; }
  var audio = null;
  var lastChime = 0;

  function saveTimers() {
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(timers)); } catch (e) {}
  }

  function unlockAudio() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audio) { try { audio = new Ctx(); } catch (e) { return; } }
    if (audio.state === "suspended" && audio.resume) audio.resume();
  }
  document.addEventListener("touchend", unlockAudio);
  document.addEventListener("click", unlockAudio);

  // Urgent alarm: four fast, piercing square-wave beeps (like a kitchen timer's piezo
  // buzzer), alternating pitch. Square waves sit in the range small tablet speakers
  // reproduce loudest, so this cuts through a noisy kitchen far better than a chime.
  function alarm() {
    if (!audio || audio.state !== "running") return;
    var t0 = audio.currentTime + 0.01;
    for (var i = 0; i < 4; i++) {
      var start = t0 + i * 0.15;
      var osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = i % 2 ? 2637 : 2093;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 0.005);
      gain.gain.setValueAtTime(0.5, start + 0.095);
      gain.gain.linearRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(start); osc.stop(start + 0.11);
    }
  }

  function fmtLeft(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + pad(m) : m) + ":" + pad(sec);
  }

  function addTimer(minutes, label) {
    unlockAudio();
    timers.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 6), label: label, ends: Date.now() + minutes * 60000 });
    saveTimers();
    renderTimers();
  }

  function removeTimer(id) {
    timers = timers.filter(function (t) { return t.id !== id; });
    saveTimers();
    renderTimers();
  }

  // Build the pills only when timers are added or removed; the 1-second tick just
  // updates text, so a tap never lands on a pill that's being swapped out.
  var timerRows = {};

  function renderTimers() {
    var box = $("timers");
    box.innerHTML = "";
    timerRows = {};
    timers.forEach(function (t) {
      var row = el("div", "timer");
      var left = el("span", "t-left");
      var label = el("span", "t-label");
      var x = el("button", "t-x", "✕");
      x.type = "button";
      x.addEventListener("click", function (ev) { ev.stopPropagation(); removeTimer(t.id); });
      row.appendChild(left); row.appendChild(label); row.appendChild(x);
      box.appendChild(row);
      timerRows[t.id] = { row: row, left: left, label: label, x: x, t: t, done: null };
    });
    updateTimerText();
  }

  function updateTimerText() {
    var now = Date.now(), doneLabels = [];
    Object.keys(timerRows).forEach(function (id) {
      var r = timerRows[id], done = now >= r.t.ends;
      if (done) doneLabels.push(r.t.label);
      if (r.done !== done) {
        r.done = done;
        r.row.style.display = done ? "none" : ""; // finished timers move to the full-screen alert
        r.label.textContent = r.t.label;
        r.x.setAttribute("aria-label", "Cancel timer");
      }
      if (!done) {
        var text = fmtLeft(r.t.ends - now);
        if (r.left.textContent !== text) r.left.textContent = text;
      }
    });
    // Full-screen "time's up" over everything (including the night clock).
    var alertBox = $("timer-alert");
    var wasHidden = alertBox.hidden;
    alertBox.hidden = !doneLabels.length;
    if (doneLabels.length) {
      var text = doneLabels.join(" · ") + (doneLabels.length > 1 ? " timers" : " timer");
      if ($("ta-label").textContent !== text) $("ta-label").textContent = text;
      if (wasHidden) lastChime = 0; // ring immediately
    }
  }

  function dismissDoneTimers() {
    var now = Date.now();
    timers = timers.filter(function (t) { return now < t.ends; });
    saveTimers();
    renderTimers();
  }
  $("ta-dismiss").addEventListener("click", function (ev) { ev.stopPropagation(); dismissDoneTimers(); });
  $("timer-alert").addEventListener("click", dismissDoneTimers);

  function tickTimers() {
    if (!timers.length) return;
    updateTimerText();
    var now = Date.now();
    // Beep-beep-beep-beep every second while a finished timer is up, for up to 10 minutes.
    var ringing = timers.some(function (t) { return now >= t.ends && now - t.ends < 10 * 60000; });
    if (ringing && now - lastChime >= 950) { lastChime = now; alarm(); }
  }

  function openTimerPicker() { unlockAudio(); $("timer-picker").hidden = false; }
  function closeTimerPicker() { $("timer-picker").hidden = true; }
  $("open-timers").addEventListener("click", openTimerPicker);
  $("timer-close").addEventListener("click", closeTimerPicker);
  var presetButtons = document.querySelectorAll("#timer-picker [data-min]");
  for (var pb = 0; pb < presetButtons.length; pb++) {
    presetButtons[pb].addEventListener("click", function (ev) {
      var min = +ev.currentTarget.getAttribute("data-min");
      addTimer(min, min >= 60 ? min / 60 + " hour" : min + " min");
      closeTimerPicker();
    });
  }
  $("timer-custom").addEventListener("click", function () {
    var raw = window.prompt("Timer length in minutes");
    var min = parseFloat(raw);
    if (!(min > 0) || min > 24 * 60) return;
    addTimer(min, (Math.round(min * 10) / 10) + " min");
    closeTimerPicker();
  });

  // ------------------------------------------------------------- Spotify now playing

  var spotify = null;       // last state from the Worker
  var spotifyAt = 0;        // when it arrived (for smooth progress between polls)
  var spotifyPolls = 0;

  function loadSpotify() {
    var p = demo ? Promise.resolve({ spotify: spotify && spotify.demo ? spotify : demoSpotify() }) : api("/spotify");
    return p.then(function (data) {
      spotify = data.spotify || null;
      spotifyAt = Date.now();
      renderSpotify();
      setProblem("spotify", null);
    }).catch(function (e) {
      if (/HTTP 404/.test(e.message)) { spotify = null; renderSpotify(); return; } // older Worker
      setProblem("spotify", e.message);
    });
  }

  // Once Spotify is set up the card stays put, so there's always something to tap
  // for the music picker; when nothing's playing it just says so.
  function renderSpotify() {
    var show = !!spotify;
    $("spotify-card").hidden = !show;
    if (!show) return;
    var idle = !spotify.active;
    $("spotify-card").classList.toggle("idle", idle);
    $("sp-title").textContent = idle ? "Nothing playing" : spotify.title || "";
    $("sp-artist").textContent = idle ? "Tap to pick a playlist and speaker" : spotify.artist || "";
    $("sp-art").style.backgroundImage = !idle && spotify.art ? "url(\"" + spotify.art + "\")" : "";
    $("spotify-card").classList.toggle("paused", !idle && !spotify.playing);
    $("sp-icon-play").style.display = spotify.playing ? "none" : "";
    $("sp-icon-pause").style.display = spotify.playing ? "" : "none";
    renderSpotifyProgress();
  }

  function renderSpotifyProgress() {
    if (!spotify || !spotify.active || !spotify.durationMs) return;
    var ms = spotify.progressMs + (spotify.playing ? Date.now() - spotifyAt : 0);
    $("sp-progress").style.width = Math.min(100, (ms / spotify.durationMs) * 100) + "%";
    // Song probably ended: check sooner than the next scheduled poll.
    if (spotify.playing && ms > spotify.durationMs + 1500 && Date.now() - spotifyAt > 3000) loadSpotify();
  }

  function spotifyControl(action) {
    if (!spotify) return;
    if (action === "toggle") action = spotify.playing ? "pause" : "play";
    // Show the change right away; the next poll confirms it.
    if (action === "pause" || action === "play") {
      spotify.progressMs += spotify.playing ? Date.now() - spotifyAt : 0;
      spotifyAt = Date.now();
      spotify.playing = action === "play";
      renderSpotify();
    }
    if (demo) return;
    api("/spotify/control", { method: "POST", body: { action: action } })
      .then(function () { setTimeout(loadSpotify, 700); })
      .catch(function (e) { setProblem("spotify", e.message); loadSpotify(); });
  }
  var spButtons = document.querySelectorAll("#spotify-card [data-sp]");
  for (var sb = 0; sb < spButtons.length; sb++) {
    spButtons[sb].addEventListener("click", function (ev) { spotifyControl(ev.currentTarget.getAttribute("data-sp")); });
  }

  // ------------------------------------------------------------- music picker
  // Tap the Spotify card: pick a speaker ("Play on") and a playlist.

  var library = null;       // { playlists, devices } from the Worker
  var musicDevice = null;   // chosen speaker id
  var musicBusy = null;     // playlist uri or device id being sent
  var DEVICE_ICONS = { Computer: "💻", Smartphone: "📱", Tablet: "📱", Speaker: "🔊", TV: "📺", CastAudio: "🔊",
    CastVideo: "📺", AVR: "📻", STB: "📺", AudioDongle: "🔌", GameConsole: "🎮", Automobile: "🚗" };

  function openMusic() {
    unlockAudio();
    $("music").hidden = false;
    $("music-error").hidden = true;
    loadLibrary();
  }
  function closeMusic() { $("music").hidden = true; }

  function musicError(msg) {
    var e = $("music-error");
    e.textContent = msg;
    e.hidden = !msg;
  }

  function loadLibrary() {
    if (!library) renderMusic(); // "Loading…"
    var p = demo ? Promise.resolve(demoLibrary()) : api("/spotify/library");
    $("music-refresh").classList.add("spin");
    return p.then(function (data) {
      library = data;
      var ids = library.devices.map(function (d) { return d.id; });
      if (ids.indexOf(musicDevice) < 0) {
        var active = library.devices.filter(function (d) { return d.active; })[0];
        musicDevice = active ? active.id : null;
      }
      renderMusic();
    }).catch(function (e) {
      musicError("Couldn't load your music: " + e.message +
        (/403|scope|Insufficient/i.test(e.message) ? " — re-run /spotify/connect to allow playlists." : ""));
    }).then(function () { $("music-refresh").classList.remove("spin"); });
  }

  function renderMusic() {
    var devBox = $("music-devices"), plBox = $("music-playlists");
    devBox.innerHTML = "";
    plBox.innerHTML = "";
    if (!library) { plBox.appendChild(el("div", "music-note", "Loading…")); return; }

    if (!library.devices.length) {
      devBox.appendChild(el("div", "music-note",
        "No speakers awake right now. Open Spotify on a phone or speaker (or say \"Alexa, open Spotify\"), then tap ↻."));
    }
    library.devices.forEach(function (d) {
      var b = el("button", "music-dev" + (d.id === musicDevice ? " on" : "") + (musicBusy === d.id ? " busy" : ""));
      b.type = "button";
      b.disabled = d.restricted;
      b.appendChild(el("span", "music-dev-icon", DEVICE_ICONS[d.type] || "🔈"));
      b.appendChild(el("span", null, d.name));
      if (d.active) b.appendChild(el("span", "music-dev-live", "playing"));
      b.addEventListener("click", function () { pickDevice(d); });
      devBox.appendChild(b);
    });

    if (!library.playlists.length) plBox.appendChild(el("div", "music-note", "No playlists found on this Spotify account."));
    library.playlists.forEach(function (pl) {
      var b = el("button", "music-pl" + (musicBusy === pl.uri ? " busy" : ""));
      b.type = "button";
      var cover = el("div", "music-cover", pl.image ? null : "🎵");
      if (pl.image) cover.style.backgroundImage = "url(\"" + pl.image + "\")";
      b.appendChild(cover);
      b.appendChild(el("div", "music-pl-name", pl.name));
      b.addEventListener("click", function () { playPlaylist(pl); });
      plBox.appendChild(b);
    });
  }

  function musicSend(body, busyKey) {
    musicBusy = busyKey;
    musicError("");
    renderMusic();
    var p = demo ? new Promise(function (r) { setTimeout(r, 400); }) : api("/spotify/play", { method: "POST", body: body });
    return p.then(function () {
      library.devices.forEach(function (d) { d.active = d.id === body.deviceId; });
      return true;
    }).catch(function (e) {
      musicError(/PREMIUM|Premium/.test(e.message) ? "Spotify Premium is needed to start music from here."
        : /404/.test(e.message) ? "That speaker went to sleep — wake it up and tap ↻."
        : "Spotify said no: " + e.message);
      return false;
    }).then(function (ok) {
      musicBusy = null;
      renderMusic();
      setTimeout(loadSpotify, 1200);
      return ok;
    });
  }

  function pickDevice(d) {
    if (musicBusy) return;
    musicDevice = d.id;
    musicError("");
    // Something's already playing somewhere else? Move it over.
    if (spotify && spotify.active && !d.active) musicSend({ deviceId: d.id }, d.id);
    else renderMusic();
  }

  function playPlaylist(pl) {
    if (musicBusy) return;
    if (!musicDevice) { musicError("Pick a speaker under \"Play on\" first."); return; }
    musicSend({ deviceId: musicDevice, uri: pl.uri }, pl.uri).then(function (ok) {
      if (ok) setTimeout(closeMusic, 600);
    });
  }

  $("spotify-card").addEventListener("click", function (ev) {
    if (!ev.target.closest(".sp-ctrl")) openMusic();
  });
  $("music-done").addEventListener("click", closeMusic);
  $("music-refresh").addEventListener("click", function () { loadLibrary(); });

  function demoLibrary() {
    var names = ["Saturday Morning", "Dinner Jazz", "Kids Dance Party", "Bears Game Day", "Chill Sunday", "Road Trip",
      "Focus", "90s Hits", "Christmas Classics", "Lullabies"];
    return {
      playlists: names.map(function (n, i) { return { uri: "spotify:playlist:demo" + i, name: n, image: null }; }),
      devices: [
        { id: "d1", name: "Kitchen Echo", type: "Speaker", active: true, restricted: false },
        { id: "d2", name: "Living Room TV", type: "TV", active: false, restricted: false },
        { id: "d3", name: "Ben's iPhone", type: "Smartphone", active: false, restricted: false },
      ],
    };
  }

  function demoSpotify() {
    return { demo: true, active: true, playing: true, title: "Sweet Home Chicago", artist: "The Blues Brothers",
      art: null, progressMs: 72000, durationMs: 330000 };
  }

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

  function demoCountdowns() {
    var d = new Date();
    return {
      events: [
        { title: "🏖️ Florida trip ⏳", allDay: true, start: ymd(addDays(d, 38)), end: ymd(addDays(d, 45)) },
        { title: "Countdown: Last day of school", allDay: true, start: ymd(addDays(d, 12)), end: ymd(addDays(d, 13)) },
      ],
    };
  }

  function demoThermostats() {
    return [
      { id: "demo-up", name: "Upstairs", online: true, ambientC: 21.1, humidity: 44, mode: "HEAT", hvac: "HEATING", eco: false, heatC: 22.2,
        modes: ["HEAT", "COOL", "HEATCOOL", "OFF"], ecoAvailable: true },
      { id: "demo-down", name: "Downstairs", online: true, ambientC: 21.7, humidity: 41, mode: "HEAT", hvac: "OFF", eco: false, heatC: 20.6,
        modes: ["HEAT", "COOL", "HEATCOOL", "OFF"], ecoAvailable: true },
    ];
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

  // ------------------------------------------------------------- self-update
  // Wall displays never get "refreshed" by a person, and iPads hold on to cached
  // files. Every 10 minutes, ask for version.json (uncached); if a newer version is
  // published, reload through a fresh URL so the new index.html and assets load.

  function freshReload(version) {
    location.replace(location.pathname + "?v=" + encodeURIComponent(version || Date.now()));
  }

  function checkForUpdate() {
    if (!window.HUB_VERSION || !window.fetch) return;
    fetch("version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.version || v.version === window.HUB_VERSION) return;
        // A reload would lose the timer chime (iPad audio needs a tap to unlock); wait.
        if (timers.length) return;
        // Don't yank the page out from under someone typing or in settings.
        var active = document.activeElement;
        if ((active && active.tagName === "INPUT") || document.querySelector(".modal:not([hidden])")) return;
        // At most one update reload per 30 minutes, in case a cache serves stale files.
        var last = 0;
        try { last = +localStorage.getItem("homehub.updateReload") || 0; } catch (e) {}
        if (Date.now() - last < 30 * 60 * 1000) return;
        try { localStorage.setItem("homehub.updateReload", String(Date.now())); } catch (e) {}
        freshReload(v.version);
      })
      .catch(function () {});
  }

  // ------------------------------------------------------------- boot + refresh loop

  function refreshAll() {
    return Promise.all([loadWeather(), loadCalendar(), loadLists(), loadNest(), loadFamily(), loadSpotify(), loadCountdowns(), loadSports()]).then(function () {
      lastSync = new Date();
      renderStatus();
    });
  }

  renderStatus();
  tickClock();
  refreshAll();

  setInterval(tickClock, 1000 * 10);
  setInterval(loadLists, 60 * 1000);
  setInterval(function () { if (!Object.keys(pendingSet).length) loadNest(); }, 2 * 60 * 1000);
  setInterval(loadCalendar, 5 * 60 * 1000);
  setInterval(loadWeather, 15 * 60 * 1000);
  setInterval(loadCountdowns, 60 * 60 * 1000);
  // Scores: every minute during a game, every 5 minutes otherwise.
  var sportsTicks = 0;
  setInterval(function () { sportsTicks++; if (sportsLive() || sportsTicks % 5 === 0) loadSports(); }, 60 * 1000);
  setInterval(function () { renderAgenda(); renderCountdowns(); renderWearCard(); renderStatus(); }, 60 * 1000); // keep "now"/"past" styling current
  setInterval(checkForUpdate, 10 * 60 * 1000);
  setInterval(function () { tickTimers(); renderSpotifyProgress(); }, 1000);
  // Spotify: every 10s while something's playing, every 30s otherwise.
  setInterval(function () {
    spotifyPolls++;
    if ((spotify && spotify.playing) || spotifyPolls % 3 === 0) loadSpotify();
  }, 10 * 1000);
  renderTimers();
  setTimeout(checkForUpdate, 30 * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refreshAll(); checkForUpdate(); } });
})();
