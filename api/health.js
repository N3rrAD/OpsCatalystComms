export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    service: "tidehold-cat1-telegram-bot",
    runtime: "vercel"
  });
}
