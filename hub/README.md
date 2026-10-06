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

## How it behaves

- Refreshes chores/groceries every minute, calendar every 5 min, weather every 15 min.
- Night mode (default 10pm–6am): black screen, dim clock, next event. Tap to wake for 2 min.
- Reloads itself at 3:30am to keep memory in check and pick up code changes.
- Weather comes from Open-Meteo (free, no key).
