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

## How it behaves

- Refreshes chores/groceries every minute, thermostats every 2 min, calendar every 5 min, weather every 15 min.
- Thermostat taps are batched: change it a few degrees and it sends one update after you stop tapping.
  Setpoints can't be changed while a thermostat is off or in Eco (same as Google's own rules).
- Night mode (default 11pm–6am): just a big clock and your next event over the dimmed night skyline. Tap to wake for 2 min.
- Reloads itself at 3:30am to keep memory in check and pick up code changes.
- Weather comes from Open-Meteo (free, no key).
- Rain/snow heads-up: when precipitation is expected in the next 60 minutes, a blue pill replaces the
  greeting under the date ("☔ Rain starting around 5:15p", "Rain now · letting up around 6p", or a
  "70% chance of rain this hour" fallback). It uses Open-Meteo's 15-minute forecast (NOAA HRRR in the US).

## Background photos

The backdrop matches the current weather, using freely licensed photos from
Wikimedia Commons that the iPad loads directly. After dark the photo is dimmed,
and clear nights get a starry sky. The photographer is credited in the
bottom-right corner. To use your own photo instead, paste its URL into
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
