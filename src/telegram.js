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
    allowed_updates: ["message", "edited_message", "channel_post", "callback_query"]
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

export function facilitatorKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Urgent Message", callback_data: "facmsg:urgent" },
        { text: "Normal Message", callback_data: "facmsg:normal" }
      ],
      [
        { text: "Need Support", callback_data: "fac:need_support" },
        { text: "Safety/Medical", callback_data: "fac:safety_medical" }
      ],
      [
        { text: "Station Issue", callback_data: "fac:station_issue" },
        { text: "Logistics", callback_data: "fac:logistics" }
      ],
      [
        { text: "Weather Concern", callback_data: "fac:weather_concern" },
        { text: "Resolved", callback_data: "fac:resolved" }
      ]
    ]
  };
}

export function adminResponseKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        { text: "Acknowledge", callback_data: `reply:ack:${userId}` },
        { text: "Need Details", callback_data: `reply:details:${userId}` }
      ],
      [
        { text: "Mark Resolved", callback_data: `reply:resolved:${userId}` },
        { text: "Ask to Call", callback_data: `reply:call:${userId}` }
      ]
    ]
  };
}

export function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Message", callback_data: "admin:message_menu" },
        { text: "Point System", callback_data: "admin:point_system" }
      ],
      [
        { text: "Summary", callback_data: "admin:summary" },
        { text: "Check Weather", callback_data: "admin:check_weather" }
      ]
    ]
  };
}

export function messagePriorityKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Urgent", callback_data: "facmsg:urgent" },
        { text: "Normal", callback_data: "facmsg:normal" }
      ],
      [
        { text: "Back", callback_data: "nav:admin" }
      ]
    ]
  };
}

export function gameOptionsKeyboard(games) {
  const rows = games.map((game) => [{ text: game.name, callback_data: `points:game:${game.id}` }]);
  rows.push([{ text: "Back", callback_data: "nav:admin" }]);
  return { inline_keyboard: rows };
}

export function summaryKeyboard() {
  return {
    inline_keyboard: [[{ text: "Back", callback_data: "nav:admin" }]]
  };
}

export function gameActionKeyboard(gameId) {
  return {
    inline_keyboard: [
      [
        { text: "PB", callback_data: `points:pb:${gameId}` },
        { text: "Who captured it", callback_data: `points:capture:${gameId}` }
      ],
      [{ text: "Back to Games", callback_data: "admin:point_system" }]
    ]
  };
}

export function pbTypeKeyboard(gameId) {
  return {
    inline_keyboard: [
      [
        { text: "Points", callback_data: `points:pb_points:${gameId}` },
        { text: "Time", callback_data: `points:pb_time:${gameId}` }
      ],
      [
        { text: "Other", callback_data: `points:pb_other:${gameId}` }
      ],
      [{ text: "Back", callback_data: `points:game:${gameId}` }]
    ]
  };
}

export function teamCaptureKeyboard(gameId, teams) {
  const rows = teams.map((team, index) => [
    { text: team, callback_data: `points:team:${gameId}:${index + 1}` }
  ]);
  rows.push([{ text: "Back", callback_data: `points:game:${gameId}` }]);
  return { inline_keyboard: rows };
}

export function forceReplyKeyboard(placeholder = "Type your response") {
  return {
    force_reply: true,
    input_field_placeholder: placeholder,
    selective: true
  };
}

export function locationRequestKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "Share Current Location",
          request_location: true
        }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}
