# OpsCatalyst Comms Telegram Bot

Standalone Telegram comms bot for Tidehold/OCC event operations.

It can:

- act as a quick communication bridge between facilitators and the chief facilitator
- forward facilitator DMs and issue-button reports to the admin alert chat
- let the chief facilitator acknowledge, ask for details, mark resolved, or reply back
- poll NEA/data.gov.sg weather data for lightning risk near the event area
- broadcast CAT1 risk alerts to a Telegram channel
- receive inline-button reports from channel members
- let chief/admin users manually activate CAT1, all-clear, pause, and resume
- log all actions to CSV for post-event reconstruction

## Important

The official data.gov.sg Lightning Observation dataset provides lightning observation data, not a guaranteed "CAT1 yes/no" decision. Use this bot as an alerting and reporting layer. The chief facilitator should make the final safety call.

## Setup

1. Create a bot with BotFather and copy the token.
2. Add the bot as an admin to your Telegram broadcast channel.
3. Ask admin users to DM the bot `/start`.
4. Copy `.env.example` to `.env` and fill in values.
5. Run:

```powershell
npm start
```

No npm packages are required.

When anyone DMs `/start`, admins see the admin control panel. Facilitators see a quick report menu and can also just type a message. Put your own user id in `ADMIN_USER_IDS`, and put your private chat or admin group id in `ADMIN_ALERT_CHAT_ID`.

Keep `TELEGRAM_BOT_TOKEN` in `.env` only. If the token is ever pasted into chat or shared, rotate it in BotFather.

## Vercel Deployment

Vercel cannot keep `npm start` running 24/7 as a long-polling process. This repo includes a Vercel-safe version:

- `/api/telegram` receives Telegram webhook updates
- `/api/cron` performs the weather check when called by Vercel Cron, cron-job.org, UptimeRobot, or another scheduler
- `/api/hourly-weather` broadcasts an hourly weather check when called by a scheduler
- `/api/scoring` awards 10-minute game points when called by a scheduler
- `/api/health` confirms the deployment is alive

Set these Vercel environment variables:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
ADMIN_ALERT_CHAT_ID
ADMIN_USER_IDS
EVENT_LAT
EVENT_LON
LIGHTNING_RADIUS_KM
LIGHTNING_API_URL
DATA_GOV_API_KEY
FORECAST_API_URL
TELEGRAM_WEBHOOK_SECRET
CRON_SECRET
TWO_HOUR_FORECAST_API_URL
```

If the Lightning Observation endpoint is unavailable, the bot falls back to the official 2-hour forecast and treats nearby "Thundery Showers" / "Heavy Thundery Showers" wording as a weather-risk alert. This is not the same as confirmed CAT1.

After deployment, set the Telegram webhook:

```powershell
$botToken = "YOUR_BOT_TOKEN"
$domain = "https://YOUR-VERCEL-DOMAIN.vercel.app"
$secret = "YOUR_TELEGRAM_WEBHOOK_SECRET"
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -Body @{
  url = "$domain/api/telegram"
  secret_token = $secret
}
```

Check webhook status:

```powershell
Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/getWebhookInfo"
```

Note: the Vercel cron route is stateless. If lightning risk is detected on every cron run, it may broadcast every scheduled run. Keep the cron schedule conservative, or add persistent storage later if you want cooldown tracking in production.

### Weather Scheduler

Vercel Hobby accounts only allow daily cron jobs. For frequent CAT1 checks, either:

- use Vercel Pro and add this to `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- or keep the current `vercel.json` and create an external scheduler that calls:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/cron?secret=YOUR_CRON_SECRET
```

Every 5 minutes is a reasonable starting point.

For hourly weather updates, call:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/hourly-weather?secret=YOUR_CRON_SECRET
```

Set the external scheduler to once every 60 minutes.

You can target a forecast area or coordinate:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/hourly-weather?secret=YOUR_CRON_SECRET&area=Bishan
https://YOUR-VERCEL-DOMAIN.vercel.app/api/hourly-weather?secret=YOUR_CRON_SECRET&lat=1.3521&lon=103.8198&label=Event%20Site
```

### Game Scoring Scheduler

The admin panel has a `Game Start` button. It resets team points, starts 10-minute scoring, and tells admins when the first scoring tick is due.

Every 10 minutes, the scoring tick awards 1 point per main game to whichever team is currently recorded as the latest captor for that station. For example, if Team 3 is the latest captor for 4 main games at the tick, Team 3 receives 4 points for that interval.

Inject 1 and Inject 2 do not auto-score. Open the inject in Point System and tap `Award Inject Point` to manually add 1 point to the selected team.

For reliable 10-minute scoring on Vercel, create an external scheduler that calls:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/scoring?secret=YOUR_CRON_SECRET
```

Set the external scheduler to once every 10 minutes. You can manually force one scoring tick from the admin chat with:

```text
/score_tick
```

Current capture and score storage is in-memory on the running function instance. For a fully foolproof event scoreboard that survives cold starts or redeploys, add persistent storage such as Redis, Supabase, or a database.

## Useful Commands

Admin-only:

```text
/reply USER_ID Your message here
/cat1_on
/cat1_off
/pause_event
/resume_event
/status
/check_weather
/weather_now
/broadcast_weather
/weather_at Bishan
/weather_at 1.3521 103.8198 Event Site
/broadcast_weather_at Bishan
/track_location
/game_start
/score_summary
/score_tick
/broadcast Your message here
/export_log
```

Admins also get an inline control panel after `/start` or `/help`.

The primary admin panel now shows:

```text
Message
Point System
Game Start
Score Summary
Summary
Check Weather
Broadcast Weather
```

Message opens:

```text
Urgent
Normal
```

Urgent messages are sent directly to the admin alert chat as priority alerts. Normal messages are sent directly to the admin alert chat as regular messages.

Point System opens:

```text
Game 1: Triple P
Game 2: Sea State 5
Game 3: Bridgewatch Under Pressure
Game 4: Full Salvo
Game 5: Cargo Capture
Game 6: Silent Convoy
Game 7: Minefield
Game 8: Marker Maze
Game 9: Cannonball
Game 10: Dead Reckoning
Game 11: Shuttle Siege
Inject 1: Underway
Inject 2: Knot Showdown
```

Each game lets the user choose PB or who captured it. PB accepts Points, Time, or Other. Time PBs are normalized to `MM:SS` or `HH:MM:SS` where possible. Capture updates show the team and Singapore timestamp. Inject stations also show `Award Inject Point`, which manually adds 1 point to the chosen team.

The main Summary button shows every game and the latest team capture/time. If a game has not been captured, it shows "No one has captured yet." Current summary storage is in-memory on the running Vercel function instance; add persistent storage if this must survive cold starts or redeploys.

Weather broadcasts combine scheduled updates and risk mode. A normal update is sent as `OCC WEATHER CHECK`; if thundery/heavy weather appears in the forecast, the same scheduled/broadcast route sends `WEATHER RISK ALERT` and also notifies the admin alert chat.

Weather location is controlled by `EVENT_LAT`, `EVENT_LON`, and `EVENT_LOCATION_LABEL`. The bot shows the nearest NEA 2-hour forecast area to those coordinates, so seeing "Bishan" means Bishan is the closest NEA forecast area to the current configured event location.

## Facilitator Comms

Facilitators DM the bot:

```text
/start
```

They can tap:

```text
Need Support
Safety/Medical
Station Issue
Logistics
Weather Concern
Resolved
```

Or they can type any message. The bot forwards it to `ADMIN_ALERT_CHAT_ID` with their name, user id, timestamp, and quick admin response buttons:

```text
Acknowledge
Need Details
Mark Resolved
Ask to Call
```

The chief facilitator can also reply manually:

```text
/reply USER_ID Message to send back
```

## Location-Based Weather

Users can DM the bot:

```text
/track_location
```

The bot will show a Telegram location-share button. If the user shares current location, the bot replies with weather for those coordinates. If the user shares live location, Telegram sends location updates as the location changes, and the bot replies with updated weather.

On Vercel this is reactive to incoming live-location updates. True "remember this live location and check it every hour later" needs persistent storage such as Redis, Supabase, or another database.

`/cat1_on` supports a CAT1 timing window:

```text
/cat1_on
/cat1_on 45
/cat1_on 1430 1530
```

No arguments uses `CAT1_DEFAULT_DURATION_MINUTES`. One number means "from now for this many minutes". Two clock values mean "from this time to this time" in Singapore time.

Any user can DM:

```text
/start
/help
```

## Channel Buttons

Broadcasts include buttons such as:

```text
Confirm CAT1
Station Sheltered
Need Assistance
False Alarm
All Clear
QR Issue
Sync Issue
Station Delayed
Medical/Safety
Resolved
```

Each click is logged and forwarded to `ADMIN_ALERT_CHAT_ID`.
