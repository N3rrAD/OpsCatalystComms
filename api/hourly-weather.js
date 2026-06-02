import { runHourlyWeatherBroadcast } from "../src/serverless-bot.js";

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = request.headers.authorization || "";
  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const querySecret = url.searchParams.get("secret") || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    response.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const result = await runHourlyWeatherBroadcast();
    response.status(200).json(result);
  } catch (error) {
    console.error(error);
    response.status(200).json({ ok: false, error: error.message });
  }
}
