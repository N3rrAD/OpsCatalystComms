# Tidehold CAT1 Telegram Bot

Standalone backup bot for Tidehold event operations.

It can:

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

When anyone DMs `/start`, the bot replies with their Telegram user id and the current chat id. Put your own user id in `ADMIN_USER_IDS`, and put your private chat or admin group id in `ADMIN_ALERT_CHAT_ID`.

Keep `TELEGRAM_BOT_TOKEN` in `.env` only. If the token is ever pasted into chat or shared, rotate it in BotFather.

## Vercel Deployment

Vercel cannot keep `npm start` running 24/7 as a long-polling process. This repo includes a Vercel-safe version:

- `/api/telegram` receives Telegram webhook updates
- `/api/cron` performs the weather check when called by Vercel Cron, cron-job.org, UptimeRobot, or another scheduler
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

## Useful Commands

Admin-only:

```text
/cat1_on
/cat1_off
/pause_event
/resume_event
/status
/check_weather
/broadcast Your message here
/export_log
```

Admins also get an inline control panel after `/start` or `/help`, with buttons for activating CAT1, all-clear, pause/resume, weather check, and status.

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
