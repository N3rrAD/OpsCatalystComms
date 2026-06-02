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

  const response = await fetchJson(config.lightningApiUrl);
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
