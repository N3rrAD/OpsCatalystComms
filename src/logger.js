import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const headers = ["timestamp", "kind", "actor_id", "actor_name", "action", "details"];

export function ensureLogFile() {
  fs.mkdirSync(path.dirname(config.logPath), { recursive: true });
  if (!fs.existsSync(config.logPath)) {
    fs.writeFileSync(config.logPath, `${headers.join(",")}\n`, "utf8");
  }
}

export function logEvent({ kind, actorId = "", actorName = "", action, details = "" }) {
  ensureLogFile();
  const row = [
    new Date().toISOString(),
    kind,
    actorId,
    actorName,
    action,
    typeof details === "string" ? details : JSON.stringify(details)
  ].map(csvCell);
  fs.appendFileSync(config.logPath, `${row.join(",")}\n`, "utf8");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
