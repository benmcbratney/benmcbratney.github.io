# Home Hub

A Skylight-style wall display — calendar, chores, groceries, weather — built for an
old iPad Air 2 (iPadOS 15) hanging on the wall. No subscription, no app store.

- **Front end** (`index.html`, `hub.css`, `hub.js`): served by GitHub Pages at
  `https://benmcbratney.github.io/hub/`. Plain JS, no build step.
- **Backend** (`worker/worker.js`): a free Cloudflare Worker that holds the secrets
  and turns calendar feeds into simple JSON. This repo is public, so secrets never
  go in it.

With no backend configured the hub runs on demo data, so you can try it right away.

## 1. Set up the backend (one time, ~15 min)

1. Sign up at cloudflare.com (free plan is plenty), then
   **Workers & Pages → Create → Create Worker**, name it `home-hub`, **Deploy**.
2. **Edit code**, replace everything with the contents of `worker/worker.js`, **Deploy**.
3. **Settings → Variables and Secrets**, add:

   | Name | Type | Value |
   |---|---|---|
   | `HUB_KEY` | Secret | a long random string (password-manager generated) |
   | `TODOIST_TOKEN` | Secret | Todoist → Settings → Integrations → Developer → API token |
   | `CALENDARS` | Secret | see below |
   | `HOME_TZ` | Text | `America/Chicago` |
   | `CHORES_PROJECT` | Text | Todoist project name, default `Chores` |
   | `GROCERY_PROJECT` | Text | Todoist project name, default `Groceries` |
   | `FAMILY` | Secret | optional, picks out family birthdays for the countdowns (see below) |
   | `KIDS_QUICK_ADD` | Text | optional JSON list of one-tap buttons for the Kids list, e.g. `["Kid One school clothes","More pull-ups"]` |
   | `NEWS_FEEDS` | Text | optional, RSS feeds for The Study's paper (see [The Study](#the-study-fire-tv-retro)) |
   | `WORK_CALENDARS` | Secret | optional, your work calendar's ICS link; only the office TV shows it (see [Office TV](#office-tv-fire-tv)) |
   | `TV_CALENDARS` | Text | optional, which of `CALENDARS` the office TV also shows, e.g. `Ben` |

   `CALENDARS` is a JSON list. For each Google calendar: Google Calendar on the web →
   ⚙ Settings → pick the calendar → *Integrate calendar* → **Secret address in iCal format**.

   ```json
   [
     {"name": "Ben",    "color": "#4f8cff", "url": "https://calendar.google.com/calendar/ical/…/private-…/basic.ics"},
     {"name": "Family", "color": "#c8553d", "url": "https://calendar.google.com/calendar/ical/…/private-…/basic.ics"}
   ]
   ```

   Treat those secret iCal URLs like passwords — anyone with one can read that calendar.

4. Make `Chores` and `Groceries` projects in Todoist if you don't have them.
   Recurring chores ("every day", "every Sat") work best: checking one off on the wall
   pushes it to its next date and it disappears until it's due again.

## 2. Set up the iPad

1. Open this link once in Safari on the iPad (fill in your values) — it saves the
   settings on the iPad and removes them from the address bar:
   `https://benmcbratney.github.io/hub/#worker=https://home-hub.YOURNAME.workers.dev&key=YOUR_HUB_KEY`
2. Share → **Add to Home Screen**, then launch it from the home screen icon (full screen, no Safari bars).
3. Settings → Display & Brightness → **Auto-Lock: Never**.
4. Settings → Accessibility → **Guided Access: On**. Open Home Hub, triple-click the
   home button, Start. Now it's locked to the hub.
5. Tap ⚙︎ (bottom right) to change the weather location, night hours, or days shown.

**Battery:** an old battery held at 100% around the clock can swell. Check that the
screen isn't lifting before mounting, and consider a smart plug that cuts power
overnight so the battery cycles a bit.

## 3. Optional: Nest thermostats (~20 min, one-time $5)

Adds a thermostat card with the current temperature, what it's doing, and −/+ to
change the target. Uses Google's official Device Access program. Your Nest needs to
be in the Google Home app (not an old Nest account), on a personal Gmail account.

1. **Device Access:** go to console.nest.google.com/device-access, accept the terms
   and pay the one-time $5 fee. Don't create the project yet.
2. **Google Cloud** (console.cloud.google.com), in a new project:
   - *APIs & Services → Library:* enable **Smart Device Management API**.
   - *OAuth consent screen:* choose **External**, fill in the app name and your email.
     Then **Publish app** so it's "In production". If you leave it in "Testing",
     Google signs you out every 7 days.
   - *Credentials → Create credentials → OAuth client ID:* type **Web application**,
     with Authorized redirect URI `https://home-hub.YOURNAME.workers.dev/nest/callback`.
     Copy the **client ID** and **client secret**.
3. **Back in Device Access:** create a project, paste the OAuth client ID, and say no
   to events. Copy the **Project ID**.
4. **Worker → Settings → Variables and Secrets**, add `NEST_PROJECT_ID` (Text),
   `NEST_CLIENT_ID` (Text), `NEST_CLIENT_SECRET` (Secret). Deploy.
5. Open `https://home-hub.YOURNAME.workers.dev/nest/connect` in a browser and sign in.
   Google will warn that it "hasn't verified this app". That's expected, because it's
   your own app: tap Advanced → Continue. **Turn on access for your thermostats**
   on the permissions screen. The last page shows a token; add it as a Secret named
   `NEST_REFRESH_TOKEN` and deploy.
6. Reopen Home Hub. The thermostat card appears on its own.

## 4. Optional: Spotify "now playing" (~10 min, free)

Adds a card under the calendar with album art, the song and artist, a progress bar,
and ⏮ ⏯ ⏭ for whatever's playing on your Spotify account (phone, speaker, Echo, …).
When nothing's playing the card hides and a **🎵 Music** button appears in the footer. **Tap the card (or 🎵 Music)** for a music picker: choose a
speaker under "Play on" and tap a playlist (yours and ones you follow, up to 100).
Tapping a different speaker while music is playing moves it there. Smart speakers
like Echo only appear while they're awake, so say "Alexa, open Spotify" (or play
something on it once) and tap ↻. Seeing what's playing works on any account;
**play/pause/skip and starting music need Spotify Premium** (Spotify's rule).

> Connected Spotify before the music picker existed? Re-run step 4 (`/spotify/connect`)
> once and replace `SPOTIFY_REFRESH_TOKEN`, because playlists need an extra permission.

> If you set up the Worker before Spotify support existed, re-paste the latest
> `worker/worker.js` into the Cloudflare editor and Deploy first.

1. Go to **developer.spotify.com/dashboard**, log in, **Create app**:
   - App name/description: anything (`Home Hub`).
   - Redirect URI: `https://home-hub.YOURNAME.workers.dev/spotify/callback` → **Add**.
   - APIs used: **Web API**. Agree and **Save**.
2. Open the app → **Settings** → copy the **Client ID**, click **View client secret**
   and copy that too.
3. Worker → **Settings → Variables and Secrets**: `SPOTIFY_CLIENT_ID` (Text),
   `SPOTIFY_CLIENT_SECRET` (Secret). Deploy.
4. Open `https://home-hub.YOURNAME.workers.dev/spotify/connect`, log in to Spotify and
   **Agree**. Copy the token from the "Connected ✅" page into a Secret named
   `SPOTIFY_REFRESH_TOKEN` and deploy.
5. Play something on Spotify. The card appears within about 30 seconds.

If the sign-in page says the user isn't registered, add your Spotify email under the
app's **User Management** in the Spotify dashboard (new apps start in development mode).

## Office TV (Fire TV)

A second, look-only board at `https://benmcbratney.github.io/hub/tv/` for the Fire TV in the
office, built for a 1080p/4K TV read from the desk. It uses the same Worker:

- **Clock and weather:** current conditions, sunset (sunrise after dark), a 5-day strip, and the same
  rain/snow heads-up as the iPad.
- **Today timeline:** the work day left to right (default 8a–6p, stretched for anything
  earlier or later) with meetings as blocks, overlaps stacked, a red "now" line, and open
  time from now to the end of the day outlined in green. The longest open stretch (an hour
  or more) is marked "Focus". All-day events show as chips above it.
- **Next meeting countdown:** "Next up · Design review · in 42 min". Turns amber at
  5 minutes (counting down m:ss) and pulses red in the last minute. During a meeting it shows
  how long is left and what's after. Zoom/Meet/Teams/Webex links show as just the service name.
- **Scores:** the iPad's one-line-per-team list. When a team is playing, a big scoreboard
  takes over the column, with ESPN's live win probability when it has one (mostly football
  and basketball). Quiet stretches show the next few games instead.
- **Headlines:** recent ESPN stories tagged with your teams (hidden during a game).
- **Spotify:** now playing. The remote's ⏯ and ⏪/⏩ buttons play/pause and skip.
- **After hours** (8pm–7am by default; see `on` below) the screen goes black with a dim clock,
  unless a game is on. Any remote button wakes it for 5 minutes.

**Which calendars:** the TV (both pages) shows your work calendar, which the family iPad
never sees. Get its private ICS link:

- **Outlook / Microsoft 365:** Outlook on the web → ⚙︎ Settings → Calendar → *Shared calendars*
  → *Publish a calendar* → pick your calendar and **Can view all details** → Publish → copy the
  **ICS** link (not the HTML one).
- **Google Workspace:** Google Calendar → ⚙︎ Settings → your work calendar → *Integrate
  calendar* → **Secret address in iCal format**.

Some companies turn both of these off; if the option isn't there, that's why. Treat the link
like a password. In the Worker add a **Secret** named `WORK_CALENDARS` and paste the link
as-is (or a JSON list like `CALENDARS` for more than one), then Deploy. To also show some of the
family calendars on the TV, add a Text variable `TV_CALENDARS` with their names, e.g. `Ben`.
With neither set, the TV shows every calendar in `CALENDARS`.

**Settings** come from a one-time link, like the iPad's (there's no keyboard worth typing on):
`https://benmcbratney.github.io/hub/tv/#worker=https://home-hub.YOURNAME.workers.dev&key=YOUR_HUB_KEY`.
Optional extras: `&work=8-18` (timeline hours), `&on=7-20` (when the screen is lit),
`&place=…&lat=…&lon=…` (weather location; defaults to Lake Forest). Without a Worker it
runs on demo data.

## The Study (Fire TV, retro)

A second take on the office TV at `https://benmcbratney.github.io/hub/study/`, dressed for a
room with a mahogany bookcase wall: the same data as the Office TV page, drawn as things
you'd find in an old study. It shares the Office TV's settings, so a TV that's already set
up just needs the new address (or use the same `#worker=…&key=…` link with `/study/`).

- **Brass clock**, plus the day and time in type.
- **Countdowns** under the clock: the iPad's "days until", as up to three pages torn from a
  desk calendar, picked the same way (see [Countdowns](#countdowns)): anything tagged ⏳ or
  "countdown" in Google Calendar, then family birthdays, then holidays within 60 days.
- **The Almanac** (weather) on parchment: conditions, a 5-day row, sunrise/sunset, how long
  the day is and how much daylight tomorrow gains or loses, and the moon's
  phase in the corner. A red stamp appears when rain or snow is due within the hour.
- **Departures board:** today's meetings on a split-flap board like the old train-station
  boards (the letters riffle when they change), with who's in each one by first name (cut off
  when there's no more room; you, people who declined, rooms and notetaker bots are left out). A meeting
  everyone else declined says so in amber with a "!", here and in the countdown. Status reads
  DEPARTED, NOW, BOARDING (last 5 minutes), FINAL (last minute) or IN 42 MIN. The big counter
  above counts down to the next one in hours and minutes, with a lamp that blinks amber when
  boarding and red on the final call. Attendees come from the calendar feed: Google's secret
  iCal address includes them; an Outlook published calendar may not.
- **The day as a brass rule:** the workday, 9 to 5 (`&work=9-17` in the setup link changes
  it), stretched to fit anything earlier or later, which is hatched as off-work time. Meetings
  are inlaid in oxblood, each a different shade so back-to-backs read as separate blocks; one
  that everyone else declined is striped amber with a "!".
  Focus time with nobody else invited (a title with "deep work", "focus" or "heads-down") is
  outlined in brass with its name; anything else with nobody else invited (lunch) is green.
  Open time is left as a gap.
- **Chicago Scoreboard** in Wrigley green with numbers on tiles, a big panel when a game is
  on (visitors on top, with ESPN's win chance), and Wrigley's flag after a Cubs game: white
  W for a win, blue L for a loss. Every 45 seconds the card flips over to **a fire in the
  grate** (a little flame simulation over brick, with firelight on the bricks) and back. It
  stays on the scores while a game is on, and on the fire when there are no scores.
- **The paper:** a newspaper clipping that turns to a new section every 40 seconds, each with
  its own masthead: *The Sports Page* (ESPN stories about your teams), *The Daily Dispatch*
  (top news: NPR, BBC), *The Society Pages* (celebrity: Us Weekly, E! News) and *The Good
  News Gazette* (Good News Network, Positive News). The Worker reads those as RSS feeds; a
  section whose feeds don't answer is skipped. To change the sources, set a `NEWS_FEEDS`
  Text variable on the Worker, e.g.
  `{"news":["https://feeds.npr.org/1001/rss.xml"],"celebrity":["https://…/feed/"]}`
  (sections you leave out keep the defaults).
- **Turntable:** Spotify as a spinning record with the album art on the label; the tonearm
  creeps across as the song plays. The remote's ⏯ ⏪ ⏩ work here too.

Fonts are Playfair Display, EB Garamond, Oswald and UnifrakturMaguntia from Google Fonts.

## The Fire TV app

A small app, **The Study**, that shows The Study (or the Office TV page) full screen.
Unlike the Fire TV's browser, it keeps the screen awake during the day and lets the TV
sleep after hours. It also passes the remote's ⏯ ⏪ ⏩ buttons to Spotify, ignores the
TV's zoom and font-size settings, and reloads by itself after a Wi-Fi hiccup.

GitHub builds it (`.github/workflows/office-tv-app.yml`, from `hub/firetv-app/`) every time
the app changes on `master` and publishes it at a fixed address:
`https://github.com/benmcbratney/benmcbratney.github.io/releases/download/office-tv/office-tv.apk`
(**Actions → Office TV app → Run workflow** rebuilds it by hand).

### Install it (no computer needed, ~5 min)

1. **Turn on Developer Options:** Settings → My Fire TV → About → click the TV's name
   (the first line) 7 times until it says you're a developer.
2. Install **Downloader** (by AFTVnews, free) from the Amazon Appstore.
3. Settings → My Fire TV → Developer Options → **Install unknown apps** → turn on **Downloader**.
4. Open Downloader, type `benmcbratney.github.io/hub/app` and press Go. The download starts
   by itself; choose **Install**, then **Done** (and let Downloader delete the file).
5. Open **The Study** from Your Apps Library (hold ☰ on it to move it into your app row).
6. The first time, it asks for the **Worker URL** and **hub key** and which page to show.
   The **Amazon Fire TV** app on your phone has a keyboard, so you can paste them instead of
   typing with the remote. Press **☰** on the remote any time to change them.

**Updating:** repeat step 4. It installs over the old version and keeps your settings.

### Or install it from a computer (adb)

Turn on Developer Options → **ADB debugging**, find the TV's IP address
(Settings → My Fire TV → About → Network), then:

```
adb connect 192.168.1.50
adb install -r office-tv.apk
adb shell "am start -n com.benmcbratney.officetv/.MainActivity -d 'https://benmcbratney.github.io/hub/study/#worker=https://home-hub.YOURNAME.workers.dev&key=YOUR_HUB_KEY'"
```

The last line sets it up with no typing on the TV (use `/hub/tv/` for the modern page).

### How it behaves

- **During the day** (the page's `on` hours, 7am–8pm by default) it keeps the screen on.
- **After hours** the page goes black and the app stops holding the screen awake, so the
  Fire TV's own screensaver and sleep timer take over (Settings → Display & Sounds). It can't
  turn the TV back on in the morning; open the app when you turn the TV on.
- **Remote:** ⏯ plays/pauses Spotify, ⏪/⏩ skip back/ahead, any other button wakes the screen
  after hours, ☰ opens setup, and Back/Home leave it for regular TV.
- The app is signed with a key kept in this repo (`hub/firetv-app/officetv.keystore`), so every
  build installs over the last. That key only says "built from this repo", which is fine for
  an app you sideload yourself; it isn't meant for an app store.

## Smart home (later)

Kasa, WiZ, iRobot and friends can only be reached from inside the house, so they go
through Home Assistant. See **[HOME-ASSISTANT.md](HOME-ASSISTANT.md)** for running it
free on a Mac mini.

## Family names (optional)

Add a `FAMILY` **Secret** to the Worker so the countdowns can tell family birthdays from
everyone else's. The names stay in Cloudflare, not in this public repo:

```json
{"parents": ["Mom", "Dad"], "kids": ["Kid One", "Kid Two"], "dog": "Dog's name"}
```

Any field can be left out.

## Countdowns

"Days until" pills run along the bottom of the header (as many as fit on one line), picked in this order:

1. **Anything you tag in Google Calendar.** Start the title with an emoji, like
   "🏝️ Mexico", or put ⏳ or the word "countdown" in it, like "Countdown: last day of
   school". The Worker looks a full year ahead for these. A leading emoji becomes the
   pill's icon, and the ⏳/"countdown" part is hidden. Recurring events count down to
   their next occurrence only.
2. **Family birthdays** in the next 60 days: all-day "birthday" events naming
   someone in `FAMILY`. Other people's birthdays stay off the board unless you tag them.
3. **Holidays** in the next 60 days: New Year's, Valentine's, St. Patrick's, Easter,
   Mother's Day, Father's Day, the Fourth, Halloween, Thanksgiving and Christmas.

Tagged events refresh hourly. With an older Worker that
doesn't have `/countdowns` yet, the holidays still show.

## How it behaves

- Refreshes chores/groceries every minute, thermostats every 2 min, calendar every 5 min, weather every 15 min,
  Spotify every 10 s while playing (30 s otherwise).
- Header shows current conditions plus a 5-day forecast strip (rain chance shown when it's 20% or more).
- Calendar: tap any day (in any Calendar style) for a big pop-up of that day: each event's full time range,
  location, which calendar it's on, and its notes (from the event description, with HTML and Meet links stripped).
  ‹ › step through the loaded days.
- Layout: calendar, Scores and Spotify on the left; thermostats and a big "What to wear" card on the right;
  Kids and Groceries as pills in the footer.
- Sports: the Scores card has one line per team with a game yesterday, today or tomorrow (Bears, Cubs, Bulls,
  Blackhawks, Northwestern football/basketball), showing just one game, in this order: live score, today's final,
  yesterday's final (marked "Yest"), or the next game's day and time, always with the opponent. Live games come
  first and refresh every minute. Teams show their ESPN logo (falling back to an emoji if it can't load). With no
  games in that window the card hides. Tap it for every team's record, last result, next game and TV channel. Data comes from ESPN's free
  (unofficial) feeds through the Worker; change teams with an optional `SPORTS_TEAMS` variable (see the top of
  worker.js).
- What to wear: big picture icons with one-word labels so the kids can read it from across the room
  (a drawn long-sleeve tee + 👖 pants below 70°, 👕 T-shirt + 🩳 shorts at 70°+, 🧥 coats when it's cold (a big coat below freezing, without the shirt and pants underneath), 🧤 mittens only when it's snowing,
  ☂️ umbrella, 🥾 snow/rain boots, 🧴 sunscreen, 💨 windy), from the daytime (7am–7pm) "feels like" temperatures,
  rain/snow chances, wind and UV. From 5pm it switches to tomorrow, so it's ready for getting dressed in the morning.
- Tap the weather for the next 24 hours: temperature (the numbers ride higher when it's warmer), conditions,
  chance of precipitation and wind, with sunrise/sunset marked. Swipe sideways for later hours.
- Kitchen timers: tap **⏲️ Timer** for presets (1 min–1 hour) or Custom. Running timers show as big
  countdowns across the top of the screen. When one finishes, a flashing red full-screen "TIME'S UP!"
  covers everything (even the night clock) and an urgent beep-beep-beep-beep alarm sounds every second
  (for up to 10 min) until you tap Dismiss. Timers survive reloads, and the hub holds off self-updates
  while one is running. The alarm needs the iPad's volume up and the side switch not on mute.
- Kids and Groceries: footer pills show how many items are on each list. Tap one for a pop-up with the list
  (tap an item to check it off; clearing the last chore gets confetti) and one-tap add buttons. For Groceries
  those are the household staples (`GROCERY_STAPLES` in hub.js) plus anything that's been on the list before,
  most frequent first; for Kids they come from the `KIDS_QUICK_ADD` Worker variable (kept there because they name
  the kids). Items already on the list show a ✓. "Type something else…" opens the system prompt, for when the
  iPad's keyboard cooperates.
- Thermostat taps are batched: change it a few degrees and it sends one update after you stop tapping.
  Setpoints can't be changed while a thermostat is off or in Eco (same as Google's own rules).
- Tap a thermostat's name or temperature for a pop-up: switch between Heat, Cool, Heat · Cool, Off and
  Eco (only the modes that thermostat supports), with big −/+ for the setpoint (both ends in Heat · Cool,
  kept at least 3° apart). Picking a mode while it's in Eco takes it off Eco first.
- Night mode (default 10pm–6am): a big clock, your next event and the coming day's forecast over a dimmed photo. Tap to wake for 2 min.
- Reloads itself at 3:30am to keep memory in check.
- Updates itself: every 10 minutes (and whenever it's reopened) it checks `version.json`; when a
  newer version is published it reloads through a fresh URL, so the iPad never sticks on cached files.
  **When changing the hub, bump the version** in `version.json`, in `index.html` (the
  `HUB_VERSION` line and the `?v=` on `hub.css` / `hub.js`) and in `tv/index.html` and
  `study/index.html` (same idea), since the iPad and the TV pages share `version.json`.
- Weather comes from Open-Meteo (free, no key).
- Rain/snow heads-up: when precipitation is expected in the next 60 minutes, a blue pill appears first in the row of pills under the clock and weather ("☔ Rain starting around 5:15p", "Rain now · letting up around 6p", or a
  "70% chance of rain this hour" fallback). It uses Open-Meteo's 15-minute forecast (NOAA HRRR in the US).

## Looks (skins)

The iPad has four looks and shows a different one each day, cycling through them in order:

- **Glass:** the original. A weather photo behind frosted-glass panels.
- **Corkboard:** the kitchen bulletin board. Cork in a wooden frame, cards as index cards and sticky notes pinned (or taped) at slight angles, headings in marker, and the clock on a big yellow sticky note.
- **Bento:** a dark page with every tile in its own solid color. A mustard clock, a blue weather tile, an indigo calendar, a green scores tile, a rust thermostat tile and a purple "What to wear" tile.
- **Bauhaus:** a mid-century poster. A cream page with big flat shapes (coral circle, mustard half-moon, teal quarter-circle) peeking out behind square, black-outlined cards with color-block labels, Futura type, and a mustard clock tile.

**Bears game days** beat everything else, holidays and the kids' weekend included: any day the
Bears play (as the Scores feed knows it, including a late game running past midnight), the hub
goes navy and orange all day, with the bear-head logo filling the background behind
see-through navy cards. Card headers get an orange stripe, the clock shows white jersey numerals
outlined in orange, and a **"BEAR DOWN!"** pennant with the bear-head logo flying off it, and the header panels get
navy-white-orange sleeve stripes. A footer pill follows the game ("🐻 Bear Down! · Kickoff 12p vs
Packers", then the live score, then "W 24–20"; just "Bear Down!" in portrait), and a football
spirals across now and then. "What to wear" swaps the T-shirt or long sleeves for a Bears jersey. The pennant and pill carry the bear-head logo (`bears-logo.png`).

**Weekends are for the kids:** all day Saturday and Sunday the hub swaps between these two every hour, on the hour (Superhero on even hours, Princess on odd):

- **Superhero:** a comic book. Halftone dots on bright blue, thick black outlines with hard shadows, yellow caption-box titles, outlined comic numerals, a "POW!" bursting off the clock, and a caped hero swooping across now and then.
- **Princess:** a pastel castle in the clouds. Soft white panels with gold trim, script titles, a crown on the clock, sparkles, a castle on the horizon, and a unicorn floating by.

Both are original drawings, not licensed characters. In December, Christmas takes the weekends too. ⚙︎ → **Look** can also pin either one, or
pick "Kids' looks, every hour" to keep the hourly swap going all week.

Every look except Glass skips the weather photo and turns darker once the sun is down. On a holiday,
the holiday's own look takes over. To keep one look instead of rotating, pick it in ⚙︎ → **Look**.
To preview one, add `?skin=cork` (or `glass`, `bento`, `bauhaus`, `hero`, `princess`, `kids`, `bears`) to the address.

## Holidays

The hub dresses up for a few holidays, going by the iPad's own date, and switches back by
itself at midnight. Each one swaps the weather photo for its own sky, tints the panels, recolors
the flip clock (on the night screen too), swaps the card icons and puts a greeting in the footer.

| Holiday | When | Look | Icons | Footer |
|---|---|---|---|---|
| Halloween | Oct 31 | Moonlit purple sky, orange clock, bats, cobwebs, a dangling spider | 🦇 💀 🕸️ 🎃 | Happy Halloween! |
| Thanksgiving | Wed–Fri of Thanksgiving week | Autumn sunset, amber clock, falling maple leaves | 🦃 🏈 🍂 🥧 | Thanksgiving tomorrow! / Happy Thanksgiving! / Happy Thanksgiving weekend! |
| Christmas | All of December | Snowy night sky, red clock with green date tiles, falling snow, twinkling string lights | 🎄 ⭐ 🔥 🧣 | Happy holidays! / Merry Christmas Eve! / Merry Christmas! / Happy New Year's Eve! |
| New Year's | Jan 1 | Midnight sky, gold clock, gold fireworks | 🎆 🏆 ❄️ 🎩 | Happy New Year 2027! (the new year) |
| Valentine's Day | Feb 14 | Rosy sky, pink clock, floating hearts | 💌 💘 💗 🌹 | Happy Valentine's Day! |
| St. Patrick's Day | Mar 17 | Emerald sky with a soft rainbow, green clock with gold date tiles, drifting shamrocks | ☘️ 🍀 🌈 🎩 | Happy St. Patrick's Day! |
| 4th of July | Jul 4 | Starry navy sky, red clock, red/white/blue fireworks, bunting along the top | 🇺🇸 ⚾ 🎆 🌭 | Happy 4th of July! |

To preview one on any day, add `?halloween`, `?thanksgiving`, `?christmas`, `?newyear`,
`?valentines`, `?stpatricks` or `?july4` to the address.
The themes live in the `HOLIDAYS` table in `hub.js` and the holidays section of `hub.css`.

## Background photos

The backdrop matches the current weather, using freely licensed photos from
Wikimedia Commons that the iPad loads directly. After dark the photo is dimmed,
and clear nights get a starry sky. Photographers are credited here (not on the
wall), which their licenses allow. To use your own photo instead, paste its URL into
⚙︎ → Background photo URL.

| Weather | Photo | Photographer |
|---|---|---|
| Clear (day) | *Gfp-illinois-chicago-lake-michigan-horizon.jpg* | Yinan Chen, public domain |
| Partly cloudy (day) | *Blue-skies-cumulus-clouds.jpg* | Cbuske46 |
| Clear (night) | *Starry night sky.jpg* | Eddie Basler |
| Cloudy / overcast | *Grey cloudy sky.jpg* | Gnu-Bricoleur, CC BY 4.0 |
| Fog | *Early morning fog.jpg* | public domain |
| Rain / drizzle / showers | *Raindrops on a window.jpg* | Andromeda2064 |
| Snow | *Winter forest after snow storm (45643768335).jpg* | Tom Ek |
| Thunderstorm | *Lightning cloud to cloud (aka).jpg* | André Karwath, CC BY-SA 2.5 |
