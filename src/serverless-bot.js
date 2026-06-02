import { config, isAdmin } from "./config.js";
import { buildCat1Window, formatCat1Window } from "./cat1-window.js";
import { checkForecastContext, checkLightningRisk, getHourlyWeatherSummary } from "./weather.js";
import {
  adminKeyboard,
  answerCallback,
  opsKeyboard,
  safetyKeyboard,
  sendMessage
} from "./telegram.js";

export async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return { ok: true, type: "callback" };
  }

  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return { ok: true, type: "channel_post" };
  }

  const message = update.message;
  if (!message?.text) return { ok: true, type: "ignored" };

  const text = message.text.trim();
  const chatId = message.chat.id;
  const user = message.from || {};

  if (text === "/start" || text === "/help") {
    const forwardedChat = getForwardedChat(message);
    await sendMessage(
      chatId,
      [
        "<b>Tidehold CAT1 Bot</b>",
        "",
        "This bot broadcasts CAT1/weather risk alerts and logs station reports.",
        "",
        `Your user id: <code>${user.id || "unknown"}</code>`,
        `This chat id: <code>${chatId}</code>`,
        forwardedChat
          ? `Forwarded-from chat id: <code>${forwardedChat.id}</code> (${escapeHtml(forwardedChat.title || forwardedChat.username || "unnamed")})`
          : "To find a private channel id, add this bot as channel admin, then forward one channel post here.",
        "",
        "Admin commands:",
        "/cat1_on, /cat1_off, /pause_event, /resume_event, /status, /check_weather, /broadcast"
      ].join("\n"),
      isAdmin(user.id) ? { reply_markup: adminKeyboard() } : {}
    );
    return { ok: true, type: "help" };
  }

  if (!isAdmin(user.id)) {
    await sendMessage(chatId, "This command is admin-only. Use the channel buttons for reports.");
    return { ok: true, type: "not_admin" };
  }

  await handleAdminCommand(text, chatId);
  return { ok: true, type: "admin_command" };
}

export async function runCronWeatherCheck() {
  const result = await checkLightningRisk();
  if (!result.risk) {
    return {
      ok: true,
      broadcasted: false,
      summary: result.summary
    };
  }

  await broadcastCat1(result.summary, false);
  return {
    ok: true,
    broadcasted: true,
    summary: result.summary
  };
}

export async function runHourlyWeatherBroadcast(location = {}) {
  const weather = await getHourlyWeatherSummary(location);
  await sendMessage(config.channelId, weather.summary);
  return {
    ok: true,
    broadcasted: true,
    summary: weather.summary
  };
}

async function handleAdminCommand(text, chatId) {
  const [command, ...parts] = text.split(/\s+/);
  const rest = parts.join(" ");

  if (command === "/cat1_on") {
    const window = buildCat1Window(parts);
    await broadcastCat1("Manual CAT1 activation by Chief/Admin.", true, window);
    await sendMessage(chatId, "CAT1 activated and broadcasted.");
    return;
  }

  if (command === "/cat1_off") {
    await sendMessage(
      config.channelId,
      [
        "<b>CAT1 ALL CLEAR</b>",
        "",
        "Chief/Admin has marked CAT1 as cleared.",
        "Resume only when the chief facilitator gives instructions."
      ].join("\n"),
      { reply_markup: safetyKeyboard() }
    );
    await sendMessage(chatId, "CAT1 cleared and broadcasted.");
    return;
  }

  if (command === "/pause_event") {
    await sendMessage(config.channelId, "<b>EVENT PAUSED</b>\n\nStop new claims and await Chief Facilitator instruction.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event pause broadcasted.");
    return;
  }

  if (command === "/resume_event") {
    await sendMessage(config.channelId, "<b>EVENT RESUMED</b>\n\nContinue only under facilitator instructions.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event resume broadcasted.");
    return;
  }

  if (command === "/status") {
    await sendMessage(chatId, formatServerlessStatus());
    return;
  }

  if (command === "/check_weather") {
    const lightning = await checkLightningRisk().catch((error) => ({
      summary: `Lightning check failed: ${error.message}`,
      risk: false
    }));
    const forecast = await safeForecast();
    await sendMessage(
      chatId,
      [
        "<b>Weather Check</b>",
        "",
        `Lightning risk: ${lightning.risk ? "YES" : "NO"}`,
        escapeHtml(lightning.summary),
        "",
        "<b>Forecast context</b>",
        escapeHtml(forecast)
      ].join("\n")
    );
    return;
  }

  if (command === "/weather_now") {
    const weather = await getHourlyWeatherSummary(parseLocationArgs(parts));
    await sendMessage(chatId, weather.summary, { reply_markup: adminKeyboard() });
    return;
  }

  if (command === "/broadcast_weather") {
    const result = await runHourlyWeatherBroadcast(parseLocationArgs(parts));
    await sendMessage(chatId, "Weather update broadcasted.", { reply_markup: adminKeyboard() });
    return result;
  }

  if (command === "/weather_at") {
    if (!rest) {
      await sendMessage(chatId, "Usage: /weather_at Bishan OR /weather_at 1.3521 103.8198 Event Site");
      return;
    }
    const weather = await getHourlyWeatherSummary(parseLocationArgs(parts));
    await sendMessage(chatId, weather.summary, { reply_markup: adminKeyboard() });
    return;
  }

  if (command === "/broadcast_weather_at") {
    if (!rest) {
      await sendMessage(chatId, "Usage: /broadcast_weather_at Bishan OR /broadcast_weather_at 1.3521 103.8198 Event Site");
      return;
    }
    await runHourlyWeatherBroadcast(parseLocationArgs(parts));
    await sendMessage(chatId, "Location weather update broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  if (command === "/export_log") {
    await sendMessage(chatId, "CSV export is available only when running the local long-polling bot. Vercel functions are stateless.");
    return;
  }

  if (command === "/broadcast") {
    if (!rest) {
      await sendMessage(chatId, "Usage: /broadcast Your message here");
      return;
    }
    await sendMessage(config.channelId, `<b>TIDEHOLD UPDATE</b>\n\n${escapeHtml(rest)}`, { reply_markup: opsKeyboard() });
    await sendMessage(chatId, "Broadcast sent.");
    return;
  }

  await sendMessage(chatId, "Unknown admin command. Try /status or /help.");
}

async function handleCallback(callbackQuery) {
  const data = callbackQuery.data || "";
  const user = callbackQuery.from || {};
  const actorName = formatUser(user);

  if (data.startsWith("admin:")) {
    await handleAdminCallback(callbackQuery);
    return;
  }

  if (!data.startsWith("report:")) {
    await answerCallback(callbackQuery.id, "Unknown action.");
    return;
  }

  const action = data.slice("report:".length);
  const label = reportLabel(action);

  await answerCallback(callbackQuery.id, `Logged: ${label}`);
  await notifyAdmins(
    [
      `<b>Field report: ${escapeHtml(label)}</b>`,
      `From: ${escapeHtml(actorName)} (${user.id || "unknown"})`,
      `Time: ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`
    ].join("\n")
  );
}

async function handleAdminCallback(callbackQuery) {
  const user = callbackQuery.from || {};
  const action = (callbackQuery.data || "").slice("admin:".length);
  const chatId = callbackQuery.message?.chat?.id || user.id;

  if (!isAdmin(user.id)) {
    await answerCallback(callbackQuery.id, "Admin-only action.", true);
    return;
  }

  await answerCallback(callbackQuery.id, "Working...");

  if (action === "cat1_on") {
    const window = buildCat1Window();
    await broadcastCat1("Manual CAT1 activation by Chief/Admin.", true, window);
    await sendMessage(chatId, "CAT1 activated and broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  if (action === "cat1_off") {
    await sendMessage(
      config.channelId,
      [
        "<b>CAT1 ALL CLEAR</b>",
        "",
        "Chief/Admin has marked CAT1 as cleared.",
        "Resume only when the chief facilitator gives instructions."
      ].join("\n"),
      { reply_markup: safetyKeyboard() }
    );
    await sendMessage(chatId, "CAT1 cleared and broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  if (action === "pause_event") {
    await sendMessage(config.channelId, "<b>EVENT PAUSED</b>\n\nStop new claims and await Chief Facilitator instruction.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event pause broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  if (action === "resume_event") {
    await sendMessage(config.channelId, "<b>EVENT RESUMED</b>\n\nContinue only under facilitator instructions.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event resume broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  if (action === "status") {
    await sendMessage(chatId, formatServerlessStatus(), { reply_markup: adminKeyboard() });
    return;
  }

  if (action === "check_weather") {
    const lightning = await checkLightningRisk().catch((error) => ({
      summary: `Lightning check failed: ${error.message}`,
      risk: false
    }));
    const forecast = await safeForecast();
    await sendMessage(
      chatId,
      [
        "<b>Weather Check</b>",
        "",
        `Lightning risk: ${lightning.risk ? "YES" : "NO"}`,
        escapeHtml(lightning.summary),
        "",
        "<b>Forecast context</b>",
        escapeHtml(forecast)
      ].join("\n"),
      { reply_markup: adminKeyboard() }
    );
    return;
  }

  if (action === "broadcast_weather") {
    await runHourlyWeatherBroadcast();
    await sendMessage(chatId, "Weather update broadcasted.", { reply_markup: adminKeyboard() });
    return;
  }

  await sendMessage(chatId, "Unknown admin action.", { reply_markup: adminKeyboard() });
}

async function handleChannelPost(message) {
  if (message.text?.trim() !== "/channel_id") return;

  await sendMessage(
    message.chat.id,
    [
      "<b>Telegram Channel ID</b>",
      "",
      "Use this in <code>TELEGRAM_CHANNEL_ID</code>:",
      `<code>${message.chat.id}</code>`
    ].join("\n")
  );
}

async function broadcastCat1(reason, manual, window = buildCat1Window()) {
  const message = [
    manual ? "<b>CAT1 ACTIVATED</b>" : "<b>CAT1 / LIGHTNING RISK DETECTED</b>",
    "",
    `<b>CAT1 Window:</b> ${escapeHtml(formatCat1Window(window))}`,
    "",
    escapeHtml(reason),
    "",
    "Recommended action: pause outdoor movement, shelter stations, and await Chief Facilitator instruction.",
    "",
    "Use the buttons below to report station status."
  ].join("\n");

  await sendMessage(config.channelId, message, { reply_markup: safetyKeyboard() });
  await notifyAdmins(`Broadcast sent to channel.\n\n${message}`);
}

async function notifyAdmins(text) {
  if (!config.adminAlertChatId) return;
  await sendMessage(config.adminAlertChatId, text);
}

async function safeForecast() {
  try {
    const forecast = await checkForecastContext();
    return `Updated: ${forecast.updated}\n${forecast.summary}`;
  } catch (error) {
    return `Forecast check failed: ${error.message}`;
  }
}

function formatServerlessStatus() {
  return [
    "<b>Tidehold Bot Status</b>",
    "",
    "Runtime: Vercel webhook + cron",
    `Channel: <code>${escapeHtml(config.channelId)}</code>`,
    `Admin alert chat: <code>${escapeHtml(config.adminAlertChatId || "not set")}</code>`,
    `Alert radius: ${config.lightningRadiusKm} km`,
    `Event location: ${config.eventLat}, ${config.eventLon}`
  ].join("\n");
}

function parseLocationArgs(parts = []) {
  const [first, second, ...rest] = parts;
  const lat = Number(first);
  const lon = Number(second);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      lat,
      lon,
      label: rest.join(" ") || `${lat}, ${lon}`
    };
  }

  return {
    area: parts.join(" ").trim()
  };
}

function reportLabel(action) {
  const labels = {
    cat1_confirmed: "It's CAT1",
    station_sheltered: "Station sheltered",
    need_assistance: "Need assistance",
    false_alarm: "False alarm",
    all_clear: "All clear",
    medical_safety: "Medical/safety issue",
    qr_issue: "QR issue",
    sync_issue: "Sync issue",
    station_delayed: "Station delayed",
    resolved: "Resolved"
  };
  return labels[action] || action;
}

function formatUser(user) {
  return [user.first_name, user.last_name, user.username ? `@${user.username}` : ""].filter(Boolean).join(" ");
}

function getForwardedChat(message) {
  if (message.forward_origin?.chat) return message.forward_origin.chat;
  if (message.forward_from_chat) return message.forward_from_chat;
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
