# Home Hub

A Skylight-style wall display — calendar, chores, groceries, weather — built for an
old iPad Air 2 (iPadOS 15) hanging on the wall. No subscription, no app store.

- **Front end** (`index.html`, `hub.css`, `hub.js`): served by GitHub Pages at
  `https://benmcbratney.com/hub/`. Plain JS, no build step.
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
   | `FAMILY` | Secret | optional, for personal greetings (see below) |
   | `KIDS_QUICK_ADD` | Text | optional JSON list of one-tap buttons for the Kids card's **+**, e.g. `["Kid One school clothes","More pull-ups"]` |

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
   `https://benmcbratney.com/hub/#worker=https://home-hub.YOURNAME.workers.dev&key=YOUR_HUB_KEY`
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
When nothing's playing it says so. **Tap the card** for a music picker: choose a
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

## Smart home (later)

Kasa, WiZ, iRobot and friends can only be reached from inside the house, so they go
through Home Assistant. See **[HOME-ASSISTANT.md](HOME-ASSISTANT.md)** for running it
free on a Mac mini.

## Personal greetings (optional)

The greeting under the date changes every 15 minutes. Add a `FAMILY` **Secret** to
the Worker and it'll mix in lines with your family's names and your dog's. The names
stay in Cloudflare, not in this public repo:

```json
{"parents": ["Mom", "Dad"], "kids": ["Kid One", "Kid Two"], "nicknames": ["Nickname"], "dog": "Dog's name"}
```

Any field can be left out. A nickname with "stress" in it gets its own calm-down lines.
An all-day calendar event with "birthday" and a family name in it ("Kid One's birthday")
becomes "🎂 Happy birthday, Kid One!".

**Bears game days:** add the Bears schedule to Google Calendar (Other calendars → +
→ Browse calendars of interest → Sports → American Football → NFL → Chicago Bears).
Then add it to `CALENDARS` like your other calendars. It's a public calendar, so use
its *Public address in iCal format*. On game days the greeting counts down to kickoff
and says when the Bears are on.

## Countdowns

Up to four "days until" tiles sit under the agenda, picked in this order:

1. **Anything you tag in Google Calendar.** Put ⏳ or the word "countdown" in the
   title, like "🏖️ Florida trip ⏳" or "Countdown: last day of school". The Worker
   looks a full year ahead for these. A leading emoji becomes the tile's icon, and
   the ⏳/"countdown" part is hidden.
2. **Family birthdays** in the next 60 days: all-day "birthday" events naming
   someone in `FAMILY`. Other people's birthdays stay off the board unless you tag them.
3. **Holidays** in the next 60 days: New Year's, Valentine's, St. Patrick's, Easter,
   Mother's Day, Father's Day, the Fourth, Halloween, Thanksgiving and Christmas.

The closest one within a month also turns up in the rotating greeting ("Only 3 more
sleeps till Christmas 🎄"). Tagged events refresh hourly. With an older Worker that
doesn't have `/countdowns` yet, the holidays still show.

## How it behaves

- Refreshes chores/groceries every minute, thermostats every 2 min, calendar every 5 min, weather every 15 min,
  Spotify every 10 s while playing (30 s otherwise).
- Header shows current conditions plus a 5-day forecast strip (rain chance shown when it's 20% or more).
- Sports: on game days a chip under the greeting shows the live score (red, updating every minute), tonight's
  matchup, or last night's final for the Bears, Cubs, Bulls, Blackhawks and Northwestern football/basketball.
  Tap it, or **🏆 Scores** in the footer, for every team's last result, next game and TV channel. Data comes
  from ESPN's free (unofficial) feeds through the Worker; change teams with an optional `SPORTS_TEAMS` variable
  (see the top of worker.js).
- What to wear: under the weather, picture icons with one-word labels (👔 long sleeves + 👖 pants below 70°, 👕 T-shirt +
  🩳 shorts at 70°+, 🧥 coats when it's cold, 🧤 mittens, ☂️ umbrella,
  🥾 snow/rain boots, 🧴 sunscreen, 💨 windy) from the daytime (7am–7pm) "feels like" temperatures, rain/snow
  chances, wind and UV. From 5pm it switches to tomorrow, so it's ready for getting dressed in the morning.
- Tap the weather for the next 24 hours: temperature (the numbers ride higher when it's warmer), conditions,
  chance of precipitation and wind, with sunrise/sunset marked. Swipe sideways for later hours.
- Kitchen timers: tap **⏲️ Timer** for presets (1 min–1 hour) or Custom. Running timers show as big
  countdowns across the top of the screen. When one finishes, a flashing red full-screen "TIME'S UP!"
  covers everything (even the night clock) and an urgent beep-beep-beep-beep alarm sounds every second
  (for up to 10 min) until you tap Dismiss. Timers survive reloads, and the hub holds off self-updates
  while one is running. The alarm needs the iPad's volume up and the side switch not on mute.
- Groceries: tap **+** for one-tap buttons (the household staples, then anything else that's been on
  the list, most frequent first). Items already on the list show a ✓. "Type something else…" opens the
  system prompt, for when the iPad's keyboard cooperates. Edit the staples in `GROCERY_STAPLES` in hub.js.
- Empty lists fold away: when Kids or Groceries has nothing on it, its card disappears (after the confetti, for
  chores) and a **🧒 Kids +** / **🛒 Groceries +** pill appears in the footer; tap it to add something and the
  card comes back. The other cards grow into the space. With both lists empty, the thermostats get bigger and a
  Scores card (live game, last result, next game per team; tap for details) fills the rest of the right column.
- Kids: the **+** works the same way, with buttons from the `KIDS_QUICK_ADD` Worker variable (kept there
  because they name the kids). Edit that variable in Cloudflare to change them; no re-paste needed.
- Thermostat taps are batched: change it a few degrees and it sends one update after you stop tapping.
  Setpoints can't be changed while a thermostat is off or in Eco (same as Google's own rules).
- Tap a thermostat's name or temperature for a pop-up: switch between Heat, Cool, Heat · Cool, Off and
  Eco (only the modes that thermostat supports), with big −/+ for the setpoint (both ends in Heat · Cool,
  kept at least 3° apart). Picking a mode while it's in Eco takes it off Eco first.
- Night mode (default 10pm–6am): a big clock, your next event and the coming day's forecast over a dimmed photo. Tap to wake for 2 min.
- Reloads itself at 3:30am to keep memory in check.
- Updates itself: every 10 minutes (and whenever it's reopened) it checks `version.json`; when a
  newer version is published it reloads through a fresh URL, so the iPad never sticks on cached files.
  **When changing the hub, bump the version** in `version.json` and in `index.html` (the
  `HUB_VERSION` line and the `?v=` on `hub.css` / `hub.js`).
- Weather comes from Open-Meteo (free, no key).
- Rain/snow heads-up: when precipitation is expected in the next 60 minutes, a blue pill replaces the
  greeting under the date ("☔ Rain starting around 5:15p", "Rain now · letting up around 6p", or a
  "70% chance of rain this hour" fallback). It uses Open-Meteo's 15-minute forecast (NOAA HRRR in the US).

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
