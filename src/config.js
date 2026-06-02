import fs from "node:fs";
import path from "node:path";

loadDotEnv();

export const config = {
  botToken: required("TELEGRAM_BOT_TOKEN"),
  channelId: required("TELEGRAM_CHANNEL_ID"),
  adminAlertChatId: process.env.ADMIN_ALERT_CHAT_ID || "",
  adminUserIds: parseList(process.env.ADMIN_USER_IDS).map((id) => Number(id)).filter(Boolean),
  eventLat: numberEnv("EVENT_LAT", 1.3521),
  eventLon: numberEnv("EVENT_LON", 103.8198),
  lightningRadiusKm: numberEnv("LIGHTNING_RADIUS_KM", 12),
  weatherPollSeconds: Math.max(30, numberEnv("WEATHER_POLL_SECONDS", 120)),
  lightningApiUrl: process.env.LIGHTNING_API_URL || "https://api-open.data.gov.sg/v2/real-time/api/lightning",
  forecastApiUrl:
    process.env.FORECAST_API_URL || "https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast",
  dataGovApiKey: process.env.DATA_GOV_API_KEY || "",
  alertCooldownMinutes: numberEnv("ALERT_COOLDOWN_MINUTES", 20),
  cat1DefaultDurationMinutes: numberEnv("CAT1_DEFAULT_DURATION_MINUTES", 30),
  dryRunWeather: boolEnv("DRY_RUN_WEATHER", false),
  statePath: path.resolve("data", "state.json"),
  logPath: path.resolve("logs", "cat1-events.csv")
};

export function isAdmin(userId) {
  return config.adminUserIds.includes(Number(userId));
}

function required(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
