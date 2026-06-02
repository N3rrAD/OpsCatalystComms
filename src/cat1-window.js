import { config } from "./config.js";

const singaporeTimeZone = "Asia/Singapore";

export function buildCat1Window(args = []) {
  const now = new Date();
  const parts = Array.isArray(args) ? args.filter(Boolean) : [];

  if (parts.length >= 2 && isClockToken(parts[0]) && isClockToken(parts[1])) {
    return {
      from: parseSingaporeClock(parts[0], now),
      to: parseSingaporeClock(parts[1], now),
      source: "custom"
    };
  }

  if (parts.length >= 1 && Number.isFinite(Number(parts[0]))) {
    const minutes = Math.max(1, Number(parts[0]));
    return {
      from: now,
      to: new Date(now.getTime() + minutes * 60 * 1000),
      source: "duration"
    };
  }

  return {
    from: now,
    to: new Date(now.getTime() + config.cat1DefaultDurationMinutes * 60 * 1000),
    source: "default"
  };
}

export function formatCat1Window(window) {
  return `${formatSingaporeTime(window.from)} to ${formatSingaporeTime(window.to)}`;
}

function isClockToken(value) {
  return /^([01]?\d|2[0-3]):?[0-5]\d$/.test(String(value));
}

function parseSingaporeClock(value, referenceDate) {
  const text = String(value).replace(":", "").padStart(4, "0");
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));

  const sgParts = new Intl.DateTimeFormat("en-SG", {
    timeZone: singaporeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);

  const part = (type) => Number(sgParts.find((item) => item.type === type)?.value);
  const date = new Date(Date.UTC(part("year"), part("month") - 1, part("day"), hours - 8, minutes, 0));

  if (date.getTime() < referenceDate.getTime() - 60 * 60 * 1000) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

function formatSingaporeTime(date) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: singaporeTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
