import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const defaultState = {
  cat1Active: false,
  eventPaused: false,
  lastWeatherCheckAt: "",
  lastWeatherSummary: "No weather check completed yet.",
  lastAlertAt: "",
  lastBroadcastMessageId: null,
  lastUpdateId: 0
};

export function loadState() {
  try {
    const raw = fs.readFileSync(config.statePath, "utf8");
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(config.statePath), { recursive: true });
  fs.writeFileSync(config.statePath, JSON.stringify({ ...defaultState, ...state }, null, 2), "utf8");
}
