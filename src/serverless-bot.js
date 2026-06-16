import { config, isAdmin } from "./config.js";
import { buildCat1Window, formatCat1Window } from "./cat1-window.js";
import {
  GAME_OPTIONS,
  TEAM_OPTIONS,
  formatSingaporeTimestamp,
  getGame,
  getTeam,
  normalizePbTime,
  normalizePoints
} from "./point-system.js";
import { checkForecastContext, checkLightningRisk, getHourlyWeatherSummary } from "./weather.js";
import {
  adminKeyboard,
  adminResponseKeyboard,
  answerCallback,
  facilitatorKeyboard,
  forceReplyKeyboard,
  gameActionKeyboard,
  gameOptionsKeyboard,
  locationRequestKeyboard,
  messagePriorityKeyboard,
  opsKeyboard,
  pbTypeKeyboard,
  safetyKeyboard,
  sendMessage,
  summaryKeyboard,
  teamCaptureKeyboard
} from "./telegram.js";

const captureSummary = new Map();

export async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return { ok: true, type: "callback" };
  }

  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return { ok: true, type: "channel_post" };
  }

  if (update.edited_message?.location) {
    await handleLocationMessage(update.edited_message, true);
    return { ok: true, type: "edited_location" };
  }

  const message = update.message;
  if (message?.location) {
    await handleLocationMessage(message, false);
    return { ok: true, type: "location" };
  }

  if (!message?.text) return { ok: true, type: "ignored" };

  const text = message.text.trim();
  const chatId = message.chat.id;
  const user = message.from || {};

  if (message.reply_to_message?.text) {
    const handledReply = await handlePromptReply(message);
    if (handledReply) {
      return handledReply;
    }
  }

  if (text === "/start" || text === "/help") {
    const forwardedChat = getForwardedChat(message);
    const admin = isAdmin(user.id);
    await sendMessage(
      chatId,
      admin
        ? [
            "<b>OpsCatalyst Comms</b>",
            "",
            "Admin control panel is ready.",
            "Use Message for facilitator comms, Point System for game updates, and Check Weather for weather context.",
            "",
            `Your user id: <code>${user.id || "unknown"}</code>`,
            `This chat id: <code>${chatId}</code>`,
            forwardedChat
              ? `Forwarded-from chat id: <code>${forwardedChat.id}</code> (${escapeHtml(forwardedChat.title || forwardedChat.username || "unnamed")})`
              : "",
            "",
            "Quick reply:",
            "<code>/reply USER_ID message</code>"
          ]
            .filter((line) => line !== "")
            .join("\n")
        : [
            "<b>OpsCatalyst Comms</b>",
            "",
            "Use this bot to contact the chief facilitator quickly.",
            "Tap Urgent/Normal, or type your message here.",
            "",
            "For urgent safety matters, choose Urgent Message or Safety/Medical."
          ].join("\n"),
      admin ? { reply_markup: adminKeyboard() } : { reply_markup: facilitatorKeyboard() }
    );
    return { ok: true, type: "help" };
  }

  if (!isAdmin(user.id)) {
    if (text === "/report" || text === "/comms") {
      await sendMessage(chatId, "Choose a report type, or type your message here.", { reply_markup: facilitatorKeyboard() });
      return { ok: true, type: "facilitator_menu" };
    }

    await forwardFacilitatorMessage(message);
    return { ok: true, type: "facilitator_message" };
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

  if (command === "/track_location" || command === "/share_location") {
    await sendMessage(
      chatId,
      [
        "<b>Share Location</b>",
        "",
        "Tap the button below and send your current or live location.",
        "The bot will generate weather for the shared coordinates.",
        "",
        "For live hourly tracking on Vercel, we still need persistent storage."
      ].join("\n"),
      { reply_markup: locationRequestKeyboard() }
    );
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

  if (command === "/reply") {
    const [targetId, ...replyParts] = parts;
    const replyText = replyParts.join(" ").trim();
    if (!targetId || !replyText) {
      await sendMessage(chatId, "Usage: /reply USER_ID Your message");
      return;
    }
    await sendMessage(targetId, `<b>Chief Facilitator Reply</b>\n\n${escapeHtml(replyText)}`, {
      reply_markup: facilitatorKeyboard()
    });
    await sendMessage(chatId, `Reply sent to <code>${escapeHtml(targetId)}</code>.`, { reply_markup: adminKeyboard() });
    return;
  }

  await sendMessage(chatId, "Unknown admin command. Try /status or /help.");
}

async function handleLocationMessage(message, isLiveUpdate) {
  const chatId = message.chat.id;
  const user = message.from || {};
  const location = message.location;
  const label = isLiveUpdate
    ? `Live location from ${formatUser(user) || "user"}`
    : `Shared location from ${formatUser(user) || "user"}`;
  const weather = await getHourlyWeatherSummary({
    lat: location.latitude,
    lon: location.longitude,
    label
  });

  await sendMessage(
    chatId,
    [
      isLiveUpdate ? "<b>Live Location Weather Update</b>" : "<b>Location Weather</b>",
      "",
      weather.summary
    ].join("\n"),
    isAdmin(user.id) ? { reply_markup: adminKeyboard() } : {}
  );
}

async function handleCallback(callbackQuery) {
  const data = callbackQuery.data || "";
  const user = callbackQuery.from || {};
  const actorName = formatUser(user);

  if (data.startsWith("admin:")) {
    await handleAdminCallback(callbackQuery);
    return;
  }

  if (data.startsWith("nav:")) {
    await handleNavigationCallback(callbackQuery);
    return;
  }

  if (data.startsWith("reply:")) {
    await handleAdminReplyCallback(callbackQuery);
    return;
  }

  if (data.startsWith("facmsg:")) {
    await handleMessagePriorityCallback(callbackQuery);
    return;
  }

  if (data.startsWith("points:")) {
    await handlePointCallback(callbackQuery);
    return;
  }

  if (data.startsWith("fac:")) {
    await handleFacilitatorCallback(callbackQuery);
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

async function handlePromptReply(message) {
  const prompt = message.reply_to_message?.text || "";
  const text = message.text || "";
  const user = message.from || {};
  const chatId = message.chat.id;

  const priorityMatch = prompt.match(/\[MSG_PRIORITY:(urgent|normal)\]/);
  if (priorityMatch) {
    await forwardPriorityMessage(message, priorityMatch[1]);
    return { ok: true, type: "priority_message" };
  }

  const pbMatch = prompt.match(/\[PB_INPUT:([^:]+):(points|time|other)\]/);
  if (pbMatch) {
    const [, gameId, pbType] = pbMatch;
    const game = getGame(gameId);
    if (!game) {
      await sendMessage(chatId, "I could not match that game. Please use Point System again.", {
        reply_markup: adminKeyboard()
      });
      return { ok: true, type: "pb_input_unknown_game" };
    }

    let formattedValue = text.trim();
    if (pbType === "points") {
      formattedValue = normalizePoints(text);
      if (!formattedValue) {
        await sendMessage(chatId, "Please reply with points as a number, for example: 120", {
          reply_markup: forceReplyKeyboard("Example: 120")
        });
        return { ok: true, type: "pb_points_invalid" };
      }
      formattedValue = `${formattedValue} points`;
    }

    if (pbType === "time") {
      formattedValue = normalizePbTime(text);
      if (!formattedValue) {
        await sendMessage(chatId, "Please reply with time as MM:SS, HH:MM:SS, or seconds. Example: 02:35", {
          reply_markup: forceReplyKeyboard("Example: 02:35")
        });
        return { ok: true, type: "pb_time_invalid" };
      }
    }

    await notifyAdmins(
      [
        "<b>PB Update</b>",
        "",
        `<b>Game:</b> ${escapeHtml(game.name)}`,
        `<b>Type:</b> ${escapeHtml(pbTypeLabel(pbType))}`,
        `<b>PB:</b> ${escapeHtml(formattedValue)}`,
        `<b>Submitted by:</b> ${escapeHtml(formatUser(user) || "Unknown user")}`,
        `<b>Time:</b> ${formatSingaporeTimestamp()}`
      ].join("\n"),
      user.id
    );
    await sendMessage(chatId, "PB update sent.", { reply_markup: adminKeyboard() });
    return { ok: true, type: "pb_input" };
  }

  return null;
}

async function handleMessagePriorityCallback(callbackQuery) {
  const user = callbackQuery.from || {};
  const priority = (callbackQuery.data || "").slice("facmsg:".length);
  const chatId = callbackQuery.message?.chat?.id || user.id;
  const urgent = priority === "urgent";

  await answerCallback(callbackQuery.id, urgent ? "Urgent message selected." : "Normal message selected.");
  await sendMessage(
    chatId,
    [
      urgent ? "<b>Urgent Message</b>" : "<b>Normal Message</b>",
      "",
      "Reply to this message with what you need to tell the chief facilitator.",
      "It will be sent directly to the admin alert chat.",
      "",
      `[MSG_PRIORITY:${urgent ? "urgent" : "normal"}]`
    ].join("\n"),
    { reply_markup: forceReplyKeyboard("Type your message") }
  );
}

async function forwardPriorityMessage(message, priority) {
  const user = message.from || {};
  const actorName = formatUser(user) || "Unknown user";
  const urgent = priority === "urgent";

  await notifyAdmins(
    [
      urgent ? "<b>PRIORITY ALERT</b>" : "<b>Normal Message</b>",
      "",
      `<b>From:</b> ${escapeHtml(actorName)}`,
      `<b>User ID:</b> <code>${user.id || "unknown"}</code>`,
      `<b>Time:</b> ${formatSingaporeTimestamp()}`,
      "",
      `<b>Message</b>`,
      escapeHtml(message.text || "[No text]"),
      "",
      `Reply with: <code>/reply ${user.id || ""} message</code>`
    ].join("\n"),
    user.id
  );

  await sendMessage(
    message.chat.id,
    urgent ? "Urgent message sent as a priority alert." : "Normal message sent.",
    { reply_markup: facilitatorKeyboard() }
  );
}

async function handlePointCallback(callbackQuery) {
  const data = callbackQuery.data || "";
  const user = callbackQuery.from || {};
  const chatId = callbackQuery.message?.chat?.id || user.id;
  const parts = data.split(":");
  const action = parts[1];
  const gameId = parts[2];
  const game = gameId ? getGame(gameId) : null;

  await answerCallback(callbackQuery.id, "Selected.");

  if (action === "game" && game) {
    await sendMessage(chatId, `<b>${escapeHtml(game.name)}</b>\n\nChoose an action.`, {
      reply_markup: gameActionKeyboard(game.id)
    });
    return;
  }

  if (action === "pb" && game) {
    await sendMessage(chatId, `<b>${escapeHtml(game.name)}</b>\n\nSelect PB type.`, {
      reply_markup: pbTypeKeyboard(game.id)
    });
    return;
  }

  if (["pb_points", "pb_time", "pb_other"].includes(action) && game) {
    const pbType = action.replace("pb_", "");
    const placeholder = pbType === "points" ? "Example: 120" : pbType === "time" ? "Example: 02:35" : "Type PB details";
    await sendMessage(
      chatId,
      [
        `<b>${escapeHtml(game.name)}</b>`,
        "",
        `Reply to this message with the ${escapeHtml(pbTypeLabel(pbType))} PB.`,
        pbType === "time" ? "Accepted time formats: MM:SS, HH:MM:SS, or seconds." : "",
        "",
        `[PB_INPUT:${game.id}:${pbType}]`
      ]
        .filter((line) => line !== "")
        .join("\n"),
      { reply_markup: forceReplyKeyboard(placeholder) }
    );
    return;
  }

  if (action === "capture" && game) {
    await sendMessage(chatId, `<b>${escapeHtml(game.name)}</b>\n\nWho captured it?`, {
      reply_markup: teamCaptureKeyboard(game.id, TEAM_OPTIONS)
    });
    return;
  }

  if (action === "team" && game) {
    const team = getTeam(parts[3]);
    if (!team) {
      await sendMessage(chatId, "Unknown team selected. Please try again.", { reply_markup: gameActionKeyboard(game.id) });
      return;
    }

    const capturedAt = formatSingaporeTimestamp();
    captureSummary.set(game.id, {
      team,
      capturedAt,
      submittedBy: formatUser(user) || "Unknown user"
    });

    await notifyAdmins(
      [
        "<b>Game Capture Update</b>",
        "",
        `<b>Game:</b> ${escapeHtml(game.name)}`,
        `<b>Captured by:</b> ${escapeHtml(team)}`,
        `<b>Captured at:</b> ${capturedAt}`,
        `<b>Submitted by:</b> ${escapeHtml(formatUser(user) || "Unknown user")}`
      ].join("\n"),
      user.id
    );
    await sendMessage(chatId, `${team} captured ${game.name} at ${capturedAt}.`, {
      reply_markup: gameActionKeyboard(game.id)
    });
    return;
  }

  await sendMessage(chatId, "I could not process that point-system action. Please try again.", {
    reply_markup: gameOptionsKeyboard(GAME_OPTIONS)
  });
}

async function handleNavigationCallback(callbackQuery) {
  const user = callbackQuery.from || {};
  const destination = (callbackQuery.data || "").slice("nav:".length);
  const chatId = callbackQuery.message?.chat?.id || user.id;

  await answerCallback(callbackQuery.id, "Back.");

  if (destination === "admin") {
    await sendMessage(chatId, "<b>OpsCatalyst Comms</b>\n\nAdmin control panel is ready.", {
      reply_markup: adminKeyboard()
    });
    return;
  }

  await sendMessage(chatId, "Unknown navigation action.", { reply_markup: adminKeyboard() });
}

async function handleFacilitatorCallback(callbackQuery) {
  const user = callbackQuery.from || {};
  const action = (callbackQuery.data || "").slice("fac:".length);
  const label = facilitatorReportLabel(action);
  const actorName = formatUser(user) || "Unknown user";

  await answerCallback(callbackQuery.id, `Sent: ${label}`);
  await sendMessage(callbackQuery.message?.chat?.id || user.id, `Sent to chief facilitator: ${label}`, {
    reply_markup: facilitatorKeyboard()
  });

  await notifyAdmins(
    [
      `<b>Facilitator Report</b>`,
      "",
      `<b>Type:</b> ${escapeHtml(label)}`,
      `<b>From:</b> ${escapeHtml(actorName)}`,
      `<b>User ID:</b> <code>${user.id || "unknown"}</code>`,
      `<b>Time:</b> ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
      "",
      `Reply with: <code>/reply ${user.id || ""} message</code>`
    ].join("\n"),
    user.id
  );
}

async function forwardFacilitatorMessage(message) {
  const user = message.from || {};
  const actorName = formatUser(user) || "Unknown user";
  const text = message.text || message.caption || "[Non-text message received]";

  await notifyAdmins(
    [
      `<b>Facilitator Message</b>`,
      "",
      `<b>From:</b> ${escapeHtml(actorName)}`,
      `<b>User ID:</b> <code>${user.id || "unknown"}</code>`,
      `<b>Chat ID:</b> <code>${message.chat?.id || "unknown"}</code>`,
      `<b>Time:</b> ${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
      "",
      `<b>Message</b>`,
      escapeHtml(text),
      "",
      `Reply with: <code>/reply ${user.id || ""} message</code>`
    ].join("\n"),
    user.id
  );

  await sendMessage(message.chat.id, "Message sent to the chief facilitator.", { reply_markup: facilitatorKeyboard() });
}

async function handleAdminReplyCallback(callbackQuery) {
  const user = callbackQuery.from || {};
  if (!isAdmin(user.id)) {
    await answerCallback(callbackQuery.id, "Admin-only action.", true);
    return;
  }

  const [, action, targetId] = (callbackQuery.data || "").split(":");
  const text = cannedReply(action);
  if (!targetId || !text) {
    await answerCallback(callbackQuery.id, "Unknown reply action.", true);
    return;
  }

  await sendMessage(targetId, text, { reply_markup: facilitatorKeyboard() });
  await answerCallback(callbackQuery.id, "Sent.");
  await sendMessage(callbackQuery.message?.chat?.id || user.id, `Sent to <code>${escapeHtml(targetId)}</code>:\n${text}`, {
    reply_markup: adminKeyboard()
  });
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

  if (action === "message_menu") {
    await sendMessage(chatId, "<b>Message</b>\n\nChoose message priority.", {
      reply_markup: messagePriorityKeyboard()
    });
    return;
  }

  if (action === "point_system") {
    await sendMessage(chatId, "<b>Point System</b>\n\nSelect a game or inject.", {
      reply_markup: gameOptionsKeyboard(GAME_OPTIONS)
    });
    return;
  }

  if (action === "summary") {
    await sendMessage(chatId, buildCaptureSummaryMessage(), {
      reply_markup: summaryKeyboard()
    });
    return;
  }

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

async function notifyAdmins(text, sourceUserId = "") {
  if (!config.adminAlertChatId) return;
  await sendMessage(
    config.adminAlertChatId,
    text,
    sourceUserId ? { reply_markup: adminResponseKeyboard(sourceUserId) } : {}
  );
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

function facilitatorReportLabel(action) {
  const labels = {
    need_support: "Need support",
    safety_medical: "Safety/medical",
    station_issue: "Station issue",
    logistics: "Logistics",
    weather_concern: "Weather concern",
    resolved: "Resolved"
  };
  return labels[action] || action;
}

function pbTypeLabel(type) {
  const labels = {
    points: "Points",
    time: "Time",
    other: "Other"
  };
  return labels[type] || type;
}

function buildCaptureSummaryMessage() {
  const lines = [
    "<b>Capture Summary</b>",
    "",
    ...GAME_OPTIONS.map((game) => {
      const capture = captureSummary.get(game.id);
      if (!capture) {
        return `<b>${escapeHtml(game.name)}</b>\nNo one has captured yet.`;
      }

      return [
        `<b>${escapeHtml(game.name)}</b>`,
        `Latest capture: ${escapeHtml(capture.team)}`,
        `Captured at: ${escapeHtml(capture.capturedAt)}`
      ].join("\n");
    })
  ];

  return lines.join("\n\n");
}

function cannedReply(action) {
  const replies = {
    ack: "<b>Chief Facilitator</b>\n\nAcknowledged. Stand by for instructions.",
    details: "<b>Chief Facilitator</b>\n\nPlease send more details: location, issue, and what support you need.",
    resolved: "<b>Chief Facilitator</b>\n\nMarked resolved. Thank you for the update.",
    call: "<b>Chief Facilitator</b>\n\nPlease call or voice-message me when safe to do so."
  };
  return replies[action] || "";
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
