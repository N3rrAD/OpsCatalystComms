import { config } from "./config.js";

export async function checkLightningRisk() {
  if (config.dryRunWeather) {
    return {
      source: "dry-run",
      risk: false,
      nearestKm: null,
      lightningCount: 0,
      nearbyCount: 0,
      summary: "DRY_RUN_WEATHER=true, no external weather check performed."
    };
  }

  let response;
  try {
    response = await fetchJson(config.lightningApiUrl);
  } catch (error) {
    return checkTwoHourForecastRisk(error);
  }

  const events = extractLightningEvents(response);
  const withDistance = events
    .map((event) => ({
      ...event,
      distanceKm: haversineKm(config.eventLat, config.eventLon, event.lat, event.lon)
    }))
    .filter((event) => Number.isFinite(event.distanceKm));

  const nearby = withDistance.filter((event) => event.distanceKm <= config.lightningRadiusKm);
  const nearest = withDistance.sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const risk = nearby.length > 0;

  return {
    source: config.lightningApiUrl,
    risk,
    nearestKm: nearest ? nearest.distanceKm : null,
    lightningCount: events.length,
    nearbyCount: nearby.length,
    summary: risk
      ? `${nearby.length} lightning observation(s) within ${config.lightningRadiusKm} km. Nearest ${nearest.distanceKm.toFixed(1)} km.`
      : events.length
        ? `No lightning observations within ${config.lightningRadiusKm} km. Nearest ${nearest.distanceKm.toFixed(1)} km.`
        : "No parseable lightning observations found in API response."
  };
}

async function checkTwoHourForecastRisk(lightningError) {
  const response = await fetchJson(config.twoHourForecastApiUrl);
  const data = response?.data || response;
  const metadata = Array.isArray(data?.area_metadata) ? data.area_metadata : [];
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  const forecasts = Array.isArray(item?.forecasts) ? item.forecasts : [];

  const areas = forecasts
    .map((forecast) => {
      const areaMeta = metadata.find((area) => area.name === forecast.area);
      const lat = Number(areaMeta?.label_location?.latitude);
      const lon = Number(areaMeta?.label_location?.longitude);
      const distanceKm = Number.isFinite(lat) && Number.isFinite(lon)
        ? haversineKm(config.eventLat, config.eventLon, lat, lon)
        : Number.POSITIVE_INFINITY;

      return {
        area: forecast.area,
        forecast: forecast.forecast || "",
        distanceKm
      };
    })
    .filter((area) => Number.isFinite(area.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearby = areas.filter((area) => area.distanceKm <= config.lightningRadiusKm);
  const relevant = nearby.length ? nearby : areas.slice(0, 3);
  const risky = relevant.filter((area) => isThunderRiskForecast(area.forecast));
  const nearest = areas[0];
  const validText = item?.valid_period?.text || "";

  return {
    source: config.twoHourForecastApiUrl,
    risk: risky.length > 0,
    nearestKm: nearest ? nearest.distanceKm : null,
    lightningCount: 0,
    nearbyCount: risky.length,
    summary: risky.length
      ? [
          `Lightning API unavailable (${lightningError.message}).`,
          `2-hour forecast risk near event area: ${risky
            .map((area) => `${area.area} - ${area.forecast} (${area.distanceKm.toFixed(1)} km)`)
            .join("; ")}.`,
          validText ? `Valid period: ${validText}.` : ""
        ]
          .filter(Boolean)
          .join(" ")
      : [
          `Lightning API unavailable (${lightningError.message}).`,
          nearest
            ? `2-hour forecast fallback found no thundery-shower forecast near event area. Nearest area: ${nearest.area} - ${nearest.forecast} (${nearest.distanceKm.toFixed(1)} km).`
            : "2-hour forecast fallback found no parseable area forecasts."
        ].join(" ")
  };
}

export async function checkForecastContext() {
  const response = await fetchJson(config.forecastApiUrl);
  const data = response?.data || response;
  const record = Array.isArray(data?.records) ? data.records[0] : null;
  const updated = record?.updatedTimestamp || record?.timestamp || "unknown";
  const periods = Array.isArray(record?.periods) ? record.periods : [];
  const current = periods[0];
  const regions = current?.regions || {};
  const regionText = Object.entries(regions)
    .map(([region, value]) => `${region}: ${value?.text || value?.code || JSON.stringify(value)}`)
    .join("; ");

  return {
    updated,
    summary: regionText || "Forecast endpoint returned no region summary."
  };
}

export async function getHourlyWeatherSummary() {
  const [twoHourResult, twentyFourHourResult] = await Promise.allSettled([
    fetchJson(config.twoHourForecastApiUrl),
    fetchJson(config.forecastApiUrl)
  ]);

  const twoHour = twoHourResult.status === "fulfilled"
    ? summarizeTwoHourForecast(twoHourResult.value)
    : { summary: `2-hour forecast unavailable: ${twoHourResult.reason.message}` };
  const twentyFourHour = twentyFourHourResult.status === "fulfilled"
    ? summarizeTwentyFourHourForecast(twentyFourHourResult.value)
    : { summary: `24-hour forecast unavailable: ${twentyFourHourResult.reason.message}` };

  return {
    updated: twoHour.updated || twentyFourHour.updated || "unknown",
    nearestArea: twoHour.nearestArea || "unknown",
    condition: twoHour.condition || "unknown",
    validPeriod: twoHour.validPeriod || "",
    temperature: twentyFourHour.temperature || "unknown",
    humidity: twentyFourHour.humidity || "unknown",
    wind: twentyFourHour.wind || "unknown",
    regionalForecast: twentyFourHour.regionalForecast || "",
    summary: [
      `<b>OCC WEATHER CHECK</b>`,
      `<code>${formatSingaporeDateTime(new Date())} SGT</code>`,
      "",
      `<b>Nearest Forecast Area</b>`,
      `${escapeHtml(twoHour.nearestArea || "Unknown")}`,
      "",
      `<b>Current Outlook</b>`,
      `${escapeHtml(twoHour.condition || "Unknown")}`,
      twoHour.validPeriod ? `Valid: ${escapeHtml(twoHour.validPeriod)}` : "",
      "",
      `<b>Environment</b>`,
      `Temp: ${escapeHtml(twentyFourHour.temperature || "Unknown")}`,
      `Humidity: ${escapeHtml(twentyFourHour.humidity || "Unknown")}`,
      `Wind: ${escapeHtml(twentyFourHour.wind || "Unknown")}`,
      twentyFourHour.regionalForecast ? "" : "",
      twentyFourHour.regionalForecast ? `<b>Regional Outlook</b>` : "",
      twentyFourHour.regionalForecast ? escapeHtml(twentyFourHour.regionalForecast) : "",
      "",
      `<i>Awareness only. Not confirmed CAT1.</i>`
    ]
      .filter((line) => line !== false && line !== null && line !== undefined)
      .join("\n")
  };
}

async function fetchJson(url) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "TideholdCAT1Bot/0.1"
  };
  if (config.dataGovApiKey) {
    headers["x-api-key"] = config.dataGovApiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Weather API failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function extractLightningEvents(payload) {
  const found = [];
  walk(payload, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;

    const lat = firstNumber(node, ["lat", "latitude", "Latitude", "LAT", "y"]);
    const lon = firstNumber(node, ["lon", "lng", "longitude", "Longitude", "LON", "x"]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      found.push({
        lat,
        lon,
        type: node.type || node.lightningType || node.stroke_type || "",
        timestamp: node.timestamp || node.datetime || node.time || node.created_at || ""
      });
    }
  });
  return dedupeEvents(found);
}

function walk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visitor);
  }
}

function firstNumber(obj, keys) {
  for (const key of keys) {
    const value = Number(obj[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.lat.toFixed(5)}:${event.lon.toFixed(5)}:${event.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isThunderRiskForecast(value) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("thundery") ||
    text.includes("thunder") ||
    text.includes("heavy showers with gusty winds")
  );
}

function summarizeTwoHourForecast(payload) {
  const data = payload?.data || payload;
  const metadata = Array.isArray(data?.area_metadata) ? data.area_metadata : [];
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  const forecasts = Array.isArray(item?.forecasts) ? item.forecasts : [];
  const nearest = forecasts
    .map((forecast) => {
      const areaMeta = metadata.find((area) => area.name === forecast.area);
      const lat = Number(areaMeta?.label_location?.latitude);
      const lon = Number(areaMeta?.label_location?.longitude);
      return {
        area: forecast.area,
        forecast: forecast.forecast || "",
        distanceKm: Number.isFinite(lat) && Number.isFinite(lon)
          ? haversineKm(config.eventLat, config.eventLon, lat, lon)
          : Number.POSITIVE_INFINITY
      };
    })
    .filter((area) => Number.isFinite(area.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  return {
    updated: item?.update_timestamp || item?.timestamp || "",
    nearestArea: nearest ? `${nearest.area} (${nearest.distanceKm.toFixed(1)} km)` : "",
    condition: nearest?.forecast || "",
    validPeriod: item?.valid_period?.text || ""
  };
}

function summarizeTwentyFourHourForecast(payload) {
  const data = payload?.data || payload;
  const record = Array.isArray(data?.records) ? data.records[0] : null;
  const general = record?.general || {};
  const temperature = general.temperature
    ? `${general.temperature.low}-${general.temperature.high} C`
    : "";
  const humidity = general.relativeHumidity
    ? `${general.relativeHumidity.low}-${general.relativeHumidity.high}%`
    : "";
  const wind = general.wind
    ? `${general.wind.direction || ""} ${general.wind.speed?.low || "?"}-${general.wind.speed?.high || "?"} km/h`.trim()
    : "";
  const currentPeriod = Array.isArray(record?.periods) ? record.periods[0] : null;
  const regionalForecast = currentPeriod?.regions
    ? Object.entries(currentPeriod.regions)
        .map(([region, value]) => `${titleCase(region)}: ${compactForecast(value?.text || value?.code || JSON.stringify(value))}`)
        .join("\n")
    : general.forecast?.text || "";

  return {
    updated: record?.updatedTimestamp || record?.timestamp || "",
    temperature,
    humidity,
    wind,
    regionalForecast
  };
}

function compactForecast(value) {
  return String(value || "")
    .replaceAll("Partly Cloudy", "Partly cloudy")
    .replaceAll("Thundery Showers", "Thundery showers")
    .replaceAll("Heavy Thundery Showers", "Heavy thundery showers");
}

function titleCase(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function formatSingaporeDateTime(date) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}
