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
    nightStart: "23",
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
    setGreeting(greetingFor(now));
    renderPrecipAlert(now);
    updateBackdrop();

    var night = isNightHour(h) && Date.now() > wakeUntil && $("settings").hidden;
    $("night").hidden = !night;
    document.body.classList.toggle("is-night", night);
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

  // ------------------------------------------------------------- photo backdrop
  // A freely licensed Wikimedia Commons photo that matches the current weather,
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
    if (settings.photoUrl) return { url: settings.photoUrl, credit: "", link: "" };
    if (!currentWx) return null; // keep the plain gradient until the first forecast arrives
    var p = PHOTOS[photoKind(currentWx.code, currentWx.isDay)];
    return {
      url: commonsUrl(p.file, 1920),
      credit: "📷 " + p.credit + " · Wikimedia Commons",
      link: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(p.file.replace(/ /g, "_")),
    };
  }

  function updateBackdrop() {
    // Dim photos after dark, except the starry sky, which is already dark.
    var dim = !!currentWx && !currentWx.isDay && !settings.photoUrl &&
      photoKind(currentWx.code, currentWx.isDay) !== "night";
    document.querySelector(".backdrop").classList.toggle("dim", dim);
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
      var c = $("credit");
      c.textContent = photo.credit;
      if (photo.link) c.href = photo.link; else c.removeAttribute("href");
    };
    img.onerror = function () {
      failedPhotos[photo.url] = Date.now() + 10 * 60 * 1000; // try again in 10 minutes
      if (shownPhoto === photo.url) shownPhoto = null;
    };
    img.src = photo.url;
  }

  // ------------------------------------------------------------- greeting
  // A new line every 15 minutes, rotating between something special (holiday,
  // birthday), something about right now (weather, chores, calendar, day of the
  // week) and a time-of-day line. Stable within each 15-minute slot.

  var TIME_LINES = [
    [0, 5, ["Still up, night owl?", "Burning the midnight oil 🦉", "Bed's calling 😴"]],
    [5, 8, ["Rise and shine ☀️", "Early bird gets the worm", "Coffee's calling ☕", "Up and at 'em"]],
    [8, 11, ["Good morning", "Morning! Make it a good one", "Let's get after it", "Hope you slept well"]],
    [11, 13, ["Lunchtime — what're we thinking?", "Halfway through the day", "Snack check 🥨"]],
    [13, 17, ["Good afternoon", "Afternoon slump? Snack time", "Hang in there — dinner's coming", "Keep it rolling"]],
    [17, 19, ["What's for dinner?", "Dinner time — who's cooking?", "Good evening", "Home stretch"]],
    [19, 22, ["Good evening", "Time to unwind", "Couch o'clock 🛋️", "Feet up, you earned it"]],
    [22, 24, ["Lights out soon", "Lock up and wind down 🔒", "Almost bedtime", "Sweet dreams soon 🌙"]],
  ];

  var AFFIRMATIONS = [
    "Hey sexy 😏", "You look good today 😍", "Hey good lookin' 👀", "Looking sharp! 😎",
    "Nice hair 😉", "Somebody's glowing today ✨", "Smile — it looks good on you 😊",
    "You've got this 💪", "You're doing amazing 🌟", "You're crushing it 🔥", "Proud of you 🙌",
    "Main character energy 💅", "Big things today 🚀", "Today's gonna be a good one 🌈",
    "You're kind of a big deal 😌", "Certified awesome ✅",
  ];

  function nthWeekday(year, month, weekday, n) {
    var first = new Date(year, month, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }

  function holidayLines(now) {
    var m = now.getMonth() + 1, d = now.getDate();
    if (m === 1 && d === 1) return ["Happy New Year! 🎆", "New year, fresh start ✨"];
    if (m === 2 && d === 14) return ["Happy Valentine's Day ❤️", "Love you guys 💕"];
    if (m === 3 && d === 17) return ["Happy St. Paddy's ☘️", "Wear green or get pinched ☘️"];
    if (m === 7 && d === 4) return ["Happy Fourth! 🎆", "Fireworks tonight? 🎇"];
    if (m === 10 && d === 31) return ["Happy Halloween 🎃", "Got the candy? 🍬", "Trick or treat 👻"];
    if (m === 11 && d === nthWeekday(now.getFullYear(), 10, 4, 4)) return ["Happy Thanksgiving 🦃", "Save room for pie 🥧"];
    if (m === 12 && d === 24) return ["Merry Christmas Eve 🎄", "Santa's on the way 🎅"];
    if (m === 12 && d === 25) return ["Merry Christmas 🎄", "Ho ho ho 🎅"];
    if (m === 12 && d === 31) return ["Happy New Year's Eve 🥂", "Last one of the year — make it count"];
    return [];
  }

  function todaysEvents(now) {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = addDays(today, 1);
    return events.filter(function (e) { return e.start < tomorrow && e.end > today; });
  }

  function specialLines(now) {
    var lines = holidayLines(now);
    var everyone = fam ? fam.parents.concat(fam.kids, fam.dog ? [fam.dog] : []) : [];
    todaysEvents(now).forEach(function (e) {
      if (e.allDay && /birthday|bday/i.test(e.title)) {
        var who = everyone.filter(function (n) { return e.title.toLowerCase().indexOf(n.toLowerCase()) >= 0; })[0];
        lines.push(who ? "🎂 Happy birthday, " + who + "! 🎉" : "🎂 " + e.title + " today!");
      }
      // Subscribe to a Bears schedule calendar and game days get their own lines.
      if (!e.allDay && /\bbears\b/i.test(e.title)) {
        if (now < e.start) lines.push("Bears game today — Bear Down! 🐻", "🐻 " + e.title + " · kickoff " + fmtTime(e.start));
        else if (now < e.end) lines.push("Bears are on right now 🐻🏈");
      }
    });
    return lines;
  }

  // ------------------------------------------------------------- family greetings
  // Names come from the Worker's FAMILY secret, so they never live in this public repo.

  var fam = null;

  function loadFamily() {
    if (demo) return Promise.resolve();
    return api("/family").then(function (data) { fam = data.family || null; }).catch(function () {});
  }

  function familyLines(now) {
    if (!fam) return [];
    var h = now.getHours(), lines = [];
    var slot = Math.floor(now.getTime() / (15 * 60 * 1000));
    var kid = fam.kids.length ? fam.kids[slot % fam.kids.length] : null;
    var nick = fam.nicknames.length ? fam.nicknames[slot % fam.nicknames.length] : null;
    var parent = fam.parents.length ? fam.parents[slot % fam.parents.length] : null;
    var dog = fam.dog;

    if (dog) {
      if (h >= 6 && h < 9) lines.push("Did " + dog + " get breakfast? 🦴");
      else if (h >= 17 && h < 20) lines.push("Did " + dog + " get dinner? 🦴");
      else if (h >= 9 && h < 17) lines.push("Has anyone walked " + dog + "? 🐕");
      lines.push(dog + " says hi 🐶", "Give " + dog + " a scratch 🐾", "Who's the goodest? " + dog + " is 🐶",
        "Be the person " + dog + " thinks you are 🐶");
    }
    if (kid) {
      if (h < 11) lines.push("Good morning, " + kid + "! ☀️");
      else if (h >= 20) lines.push("Teeth brushed, " + kid + "? 🪥");
      else lines.push("Hi " + kid + "! 👋");
      lines.push(kid + ", you're awesome ⭐");
    }
    if (nick) {
      if (/stress/i.test(nick)) lines.push("Deep breaths, " + nick + " 😌", "Chill vibes only, " + nick + " 🧘");
      else lines.push("Hey " + nick + " 👋", "Looking good, " + nick + " ✨");
    }
    if (parent) lines.push("Hi " + parent + " 👋", parent + " is the best ⭐");
    if (fam.kids.length > 1 && h >= 7 && h < 21) lines.push("Love you, " + listNames(fam.kids) + " ❤️");
    return lines;
  }

  function listNames(names) {
    if (names.length <= 2) return names.join(" & ");
    return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  }

  function contextLines(now) {
    var lines = [], h = now.getHours(), dow = now.getDay();

    // Weather
    if (currentWx) {
      var code = currentWx.code, t = currentWx.tempF;
      if (t != null && t <= 0) lines.push("Chiberia out there 🥶 — bundle up");
      else if (t != null && t <= 25) lines.push("Brr, it's a cold one — hats and gloves 🧤");
      else if (t != null && t >= 88) lines.push("Hot one today — stay hydrated 💧");
      if (code >= 95) lines.push("Stormy out — stay in, stay dry ⛈");
      else if ((code >= 71 && code <= 77) || code === 85 || code === 86) lines.push("Snowy out there — boots on ❄️", "Snow day vibes ☃️");
      else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) lines.push("Rainy day — good day for soup 🍲", "Don't forget an umbrella ☔");
      else if (code === 45 || code === 48) lines.push("Foggy out — drive careful 🌫");
      else if (currentWx.isDay && code <= 1 && t >= 62 && t <= 80) lines.push("Gorgeous out — get some fresh air 🌞", "Perfect day for a walk");
    }

    // Bears (regular season runs September into early January)
    var month = now.getMonth() + 1;
    if (month >= 9 || month === 1) {
      lines.push("Bear Down 🐻");
      if (dow === 0) lines.push("Bears Sunday? 🐻🏈");
    } else if (month === 8) {
      lines.push("Football's almost back — Bear Down 🐻");
    }

    // Day of the week
    if (dow === 1 && h < 12) lines.push("Happy Monday. Coffee first ☕");
    if (dow === 2) lines.push("Taco Tuesday? 🌮");
    if (dow === 3) lines.push("Hump day — halfway there 🐪");
    if (dow === 4) lines.push("Almost Friday 🙌");
    if (dow === 5) lines.push(h >= 16 ? "Weekend starts now 🎉" : "Happy Friday! 🎉");
    if (dow === 6) lines.push("Happy Saturday — no alarms ⏰");
    if (dow === 0) lines.push(h >= 17 ? "Peek at the week ahead 📅" : "Lazy Sunday ☕");

    // Chores and calendar
    if (lists.chores.length) {
      var todo = visibleChores();
      var today = ymd(now);
      if (!todo.length) lines.push("Chores all done — nice work! 🙌");
      else if (todo.some(function (c) { return c.due && c.due.slice(0, 10) < today; })) lines.push("A few chores are waiting on you ✋");
    }
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()), end = addDays(start, 1);
    var todayCount = events.filter(function (e) { return e.start < end && e.end > start; }).length;
    if (todayCount >= 4) lines.push("Busy day — " + todayCount + " things on the calendar");
    else if (todayCount === 0 && h < 17) lines.push("Nothing on the calendar today 😌");
    return lines;
  }

  function greetingFor(now) {
    var h = now.getHours();
    var timeLines = ["Hello"];
    TIME_LINES.forEach(function (r) { if (h >= r[0] && h < r[1]) timeLines = r[2]; });
    var special = specialLines(now), context = contextLines(now), family = familyLines(now);
    var slot = Math.floor(now.getTime() / (15 * 60 * 1000));
    var pick = function (list) { return list[Math.floor(slot / 4) % list.length]; };
    // An hour cycles: special (or family) → the moment → family or a pep talk → time of day.
    var turn = slot % 4;
    if (turn === 0) return special.length ? pick(special) : family.length ? pick(family) : pick(context.length ? context : timeLines);
    if (turn === 1) return context.length ? pick(context) : pick(timeLines);
    if (turn === 2) return pick(family.concat(AFFIRMATIONS));
    return pick(timeLines);
  }

  function setGreeting(text) {
    var g = $("greeting");
    if (g.textContent === text) return;
    g.textContent = text;
    g.classList.remove("swap");
    void g.offsetWidth; // restart the fade
    g.classList.add("swap");
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
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      "&hourly=precipitation_probability&minutely_15=precipitation,snowfall&forecast_minutely_15=8" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var c = d.current, day = d.daily;
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
        var sunLine = "";
        if (sun) {
          var t = new Date();
          sunLine = t < sun.rise ? " · sunrise " + fmtTime(sun.rise) : t < sun.set ? " · sunset " + fmtTime(sun.set) : "";
        }
        detail.appendChild(el("div", null, settings.placeName + " · wind " + Math.round(c.wind_speed_10m) + " mph" + sunLine));

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
    $("greeting").hidden = !!msg;
    if (msg) {
      box.textContent = msg.text;
      box.className = "precip-alert" + (msg.snow ? " snow" : "");
    }
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
    var card = document.querySelector(".chores");
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

  // ------------------------------------------------------------- Nest thermostats

  var thermostats = [];
  var pendingSet = {}; // id -> { heatF, coolF, timer }
  var demoThermostatList = null;

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
    $("hub").classList.toggle("has-nest", show);
    if (!show) return;
    $("nest-title").textContent = thermostats.length > 1 ? "Thermostats" : "Thermostat";

    var box = $("nest");
    box.innerHTML = "";
    thermostats.forEach(function (t) {
      var tg = targets(t);
      var adjustable = t.online && !t.eco && t.mode !== "OFF";
      var row = el("div", "tstat" + (t.hvac === "HEATING" ? " heating" : t.hvac === "COOLING" ? " cooling" : ""));

      var info = el("div", "t-info");
      info.appendChild(el("div", "t-name", t.name));
      var status = !t.online ? "Offline"
        : t.hvac === "HEATING" ? "🔥 Heating"
        : t.hvac === "COOLING" ? "❄️ Cooling"
        : t.mode === "OFF" ? "Off"
        : t.eco ? "Eco"
        : "Holding";
      if (t.humidity != null) status += " · " + Math.round(t.humidity) + "% humidity";
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
      else if (t.mode === "HEATCOOL") label = tg.heatF + "–" + tg.coolF + "°";
      else if (t.mode === "COOL") label = tg.coolF + "°";
      else label = tg.heatF + "°";
      var target = el("span", "t-target" + (t.mode === "HEATCOOL" ? " range" : "") + (tg.pending ? " pending" : ""), label);
      minus.disabled = plus.disabled = !adjustable;
      minus.addEventListener("click", function () { nudge(t, -1); });
      plus.addEventListener("click", function () { nudge(t, 1); });
      ctrl.appendChild(minus);
      ctrl.appendChild(target);
      ctrl.appendChild(plus);
      row.appendChild(ctrl);

      box.appendChild(row);
    });
  }

  function nudge(t, delta) {
    var tg = targets(t);
    var clamp = function (f) { return Math.max(50, Math.min(90, f)); };
    var p = pendingSet[t.id] || {};
    if (t.mode === "HEAT" || t.mode === "HEATCOOL") p.heatF = clamp(tg.heatF + delta);
    if (t.mode === "COOL" || t.mode === "HEATCOOL") p.coolF = clamp(tg.coolF + delta);
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

  function demoThermostats() {
    return [
      { id: "demo-up", name: "Upstairs", online: true, ambientC: 21.1, humidity: 44, mode: "HEAT", hvac: "HEATING", eco: false, heatC: 22.2 },
      { id: "demo-down", name: "Downstairs", online: true, ambientC: 21.7, humidity: 41, mode: "HEAT", hvac: "OFF", eco: false, heatC: 20.6 },
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

  // ------------------------------------------------------------- boot + refresh loop

  function refreshAll() {
    return Promise.all([loadWeather(), loadCalendar(), loadLists(), loadNest(), loadFamily()]).then(function () {
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
  setInterval(function () { renderAgenda(); renderStatus(); }, 60 * 1000); // keep "now"/"past" styling current
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAll(); });
})();
