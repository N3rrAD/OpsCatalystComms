import { handleTelegramUpdate } from "../src/serverless-bot.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const actualSecret = request.headers["x-telegram-bot-api-secret-token"] || "";
  if (expectedSecret && actualSecret !== expectedSecret) {
    response.status(401).json({ ok: false, error: "Invalid webhook secret" });
    return;
  }

  try {
    const result = await handleTelegramUpdate(request.body || {});
    response.status(200).json(result);
  } catch (error) {
    console.error(error);
    response.status(200).json({ ok: false, error: error.message });
  }
}
