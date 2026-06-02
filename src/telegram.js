import fs from "node:fs";
import { config } from "./config.js";

const apiBase = `https://api.telegram.org/bot${config.botToken}`;

export async function telegram(method, payload = {}) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.result;
}

export function sendMessage(chatId, text, options = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...options
  });
}

export function editMessage(chatId, messageId, text, options = {}) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...options
  });
}

export function answerCallback(callbackQueryId, text, showAlert = false) {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  });
}

export async function sendDocument(chatId, filePath, caption = "") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());

  const response = await fetch(`${apiBase}/sendDocument`, {
    method: "POST",
    body: form
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(`Telegram sendDocument failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.result;
}

export function getUpdates(offset) {
  return telegram("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message", "channel_post", "callback_query"]
  });
}

export function safetyKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Confirm CAT1", callback_data: "report:cat1_confirmed" },
        { text: "Station Sheltered", callback_data: "report:station_sheltered" }
      ],
      [
        { text: "Need Assistance", callback_data: "report:need_assistance" },
        { text: "False Alarm", callback_data: "report:false_alarm" }
      ],
      [
        { text: "All Clear", callback_data: "report:all_clear" },
        { text: "Medical/Safety", callback_data: "report:medical_safety" }
      ]
    ]
  };
}

export function opsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "QR Issue", callback_data: "report:qr_issue" },
        { text: "Sync Issue", callback_data: "report:sync_issue" }
      ],
      [
        { text: "Station Delayed", callback_data: "report:station_delayed" },
        { text: "Need Assistance", callback_data: "report:need_assistance" }
      ],
      [{ text: "Resolved", callback_data: "report:resolved" }]
    ]
  };
}

export function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Activate CAT1", callback_data: "admin:cat1_on" },
        { text: "All Clear", callback_data: "admin:cat1_off" }
      ],
      [
        { text: "Pause Event", callback_data: "admin:pause_event" },
        { text: "Resume Event", callback_data: "admin:resume_event" }
      ],
      [
        { text: "Check Weather", callback_data: "admin:check_weather" },
        { text: "Status", callback_data: "admin:status" }
      ]
    ]
  };
}
