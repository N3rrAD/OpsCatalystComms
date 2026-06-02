import { config, isAdmin } from "./config.js";
import { buildCat1Window, formatCat1Window } from "./cat1-window.js";
import { ensureLogFile, logEvent } from "./logger.js";
import { loadState, saveState } from "./state.js";
import {
  answerCallback,
  getUpdates,
  opsKeyboard,
  safetyKeyboard,
  sendDocument,
  sendMessage
} from "./telegram.js";
import { checkForecastContext, checkLightningRisk } from "./weather.js";

let state = loadState();
ensureLogFile();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  console.log("Tidehold CAT1 Telegram bot started.");
  console.log(`Broadcast channel: ${config.channelId}`);
  console.log(`Weather polling every ${config.weatherPollSeconds}s.`);

  setInterval(() => {
    runWeatherCheck("scheduled").catch((error) => {
      console.error(error);
      const previousSummary = state.lastWeatherSummary || "";
      state.lastWeatherCheckAt = new Date().toISOString();
      state.lastWeatherSummary = `Weather check failed: ${error.message}`;
      saveState(state);
      if (previousSummary !== state.lastWeatherSummary) {
        notifyAdmins(`Weather check failed:\n${escapeHtml(error.message)}`).catch(console.error);
      }
    });
  }, config.weatherPollSeconds * 1000);

  runWeatherCheck("startup").catch((error) => {
    console.error(`Startup weather check failed: ${error.message}`);
  });

  while (true) {
    try {
      const updates = await getUpdates(state.lastUpdateId + 1);
      for (const update of updates) {
        state.lastUpdateId = update.update_id;
        saveState(state);
        await handleUpdate(update);
      }
    } catch (error) {
      console.error(error);
      await sleep(3000);
    }
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return;
  }

  const message = update.message;
  if (!message?.text) return;

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
        "/cat1_on, /cat1_off, /pause_event, /resume_event, /status, /check_weather, /export_log",
        "",
        "For channel reports, use the buttons on broadcast messages."
      ].join("\n")
    );
    return;
  }

  if (!isAdmin(user.id)) {
    await sendMessage(chatId, "This command is admin-only. Use the channel buttons for reports.");
    return;
  }

  await handleAdminCommand(text, chatId, user);
}

async function handleChannelPost(message) {
  if (message.text?.trim() !== "/channel_id") return;

  await sendMessage(
    message.chat.id,
    [
      "<b>Telegram Channel ID</b>",
      "",
      `Use this in <code>TELEGRAM_CHANNEL_ID</code>:`,
      `<code>${message.chat.id}</code>`
    ].join("\n")
  );
}

async function handleAdminCommand(text, chatId, user) {
  const [command, ...parts] = text.split(/\s+/);
  const rest = parts.join(" ");

  if (command === "/cat1_on") {
    const window = buildCat1Window(parts);
    state.cat1Active = true;
    state.eventPaused = true;
    saveState(state);
    logCommand(user, command, { details: "Manual CAT1 activated", window: formatCat1Window(window) });
    await broadcastCat1("Manual CAT1 activation by Chief/Admin.", true, window);
    await sendMessage(chatId, "CAT1 activated and broadcasted.");
    return;
  }

  if (command === "/cat1_off") {
    state.cat1Active = false;
    saveState(state);
    logCommand(user, command, "Manual all-clear");
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
    state.eventPaused = true;
    saveState(state);
    logCommand(user, command, "Event paused");
    await sendMessage(config.channelId, "<b>EVENT PAUSED</b>\n\nStop new claims and await Chief Facilitator instruction.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event pause broadcasted.");
    return;
  }

  if (command === "/resume_event") {
    state.eventPaused = false;
    saveState(state);
    logCommand(user, command, "Event resumed");
    await sendMessage(config.channelId, "<b>EVENT RESUMED</b>\n\nContinue only under facilitator instructions.", {
      reply_markup: opsKeyboard()
    });
    await sendMessage(chatId, "Event resume broadcasted.");
    return;
  }

  if (command === "/status") {
    await sendMessage(chatId, formatStatus());
    return;
  }

  if (command === "/check_weather") {
    await runWeatherCheck("manual");
    const forecast = await safeForecast();
    await sendMessage(chatId, `${formatStatus()}\n\n<b>Forecast context</b>\n${escapeHtml(forecast)}`);
    return;
  }

  if (command === "/export_log") {
    await sendDocument(chatId, config.logPath, "Tidehold CAT1 event log");
    return;
  }

  if (command === "/broadcast") {
    if (!rest) {
      await sendMessage(chatId, "Usage: /broadcast Your message here");
      return;
    }
    logCommand(user, command, rest);
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

  if (!data.startsWith("report:")) {
    await answerCallback(callbackQuery.id, "Unknown action.");
    return;
  }

  const action = data.slice("report:".length);
  const label = reportLabel(action);
  const details = {
    chatId: callbackQuery.message?.chat?.id || "",
    messageId: callbackQuery.message?.message_id || ""
  };

  logEvent({
    kind: "button_report",
    actorId: user.id || "",
    actorName,
    action,
    details
  });

  await answerCallback(callbackQuery.id, `Logged: ${label}`);
  await notifyAdmins(
    [
      `<b>Field report: ${escapeHtml(label)}</b>`,
      `From: ${escapeHtml(actorName)} (${user.id || "unknown"})`,
      `Time: ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`
    ].join("\n")
  );
}

async function runWeatherCheck(reason) {
  const result = await checkLightningRisk();
  state.lastWeatherCheckAt = new Date().toISOString();
  state.lastWeatherSummary = result.summary;
  saveState(state);

  logEvent({
    kind: "weather_check",
    action: reason,
    details: result
  });

  if (!result.risk) return;

  const lastAlertMs = state.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
  const cooldownMs = config.alertCooldownMinutes * 60 * 1000;
  if (Date.now() - lastAlertMs < cooldownMs && state.cat1Active) {
    return;
  }

  state.cat1Active = true;
  state.eventPaused = true;
  state.lastAlertAt = new Date().toISOString();
  saveState(state);
  await broadcastCat1(result.summary, false);
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

  const sent = await sendMessage(config.channelId, message, { reply_markup: safetyKeyboard() });
  state.lastBroadcastMessageId = sent.message_id;
  saveState(state);

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

function formatStatus() {
  return [
    "<b>Tidehold Bot Status</b>",
    "",
    `CAT1 active: ${state.cat1Active ? "YES" : "NO"}`,
    `Event paused: ${state.eventPaused ? "YES" : "NO"}`,
    `Last weather check: ${escapeHtml(state.lastWeatherCheckAt || "never")}`,
    `Weather summary: ${escapeHtml(state.lastWeatherSummary || "-")}`,
    `Alert radius: ${config.lightningRadiusKm} km`,
    `Event location: ${config.eventLat}, ${config.eventLon}`
  ].join("\n");
}

function logCommand(user, command, details) {
  logEvent({
    kind: "admin_command",
    actorId: user.id || "",
    actorName: formatUser(user),
    action: command,
    details
  });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
