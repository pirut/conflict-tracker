"use node";

import { IRAN_CITIES } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson, parseTimestamp } from "./shared";

type FocalPoint = {
  name: string;
  lat: number;
  lon: number;
  country: string;
};

type OpenMeteoWeather = {
  current?: {
    time?: string;
    weather_code?: number;
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    precipitation?: number;
  };
};

type OpenMeteoAir = {
  current?: {
    time?: string;
    pm10?: number;
    pm2_5?: number;
    nitrogen_dioxide?: number;
    sulphur_dioxide?: number;
    ozone?: number;
    aerosol_optical_depth?: number;
  };
};

type OpenMeteoFlood = {
  daily?: {
    time?: string[];
    river_discharge?: number[];
  };
};

const SEVERE_WEATHER_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99]);

const DEFAULT_FOCAL_POINTS: FocalPoint[] = [
  { name: "Tehran", lat: 35.6892, lon: 51.389, country: "Iran" },
  { name: "Natanz", lat: 33.5121, lon: 51.9162, country: "Iran" },
  { name: "Isfahan", lat: 32.6546, lon: 51.668, country: "Iran" },
  { name: "Tabriz", lat: 38.0962, lon: 46.2738, country: "Iran" },
  { name: "Ahvaz", lat: 31.3183, lon: 48.6706, country: "Iran" },
  { name: "Baghdad", lat: 33.3152, lon: 44.3661, country: "Iraq" },
  { name: "Damascus", lat: 33.5138, lon: 36.2765, country: "Syria" },
];

function buildFocalPoints(): FocalPoint[] {
  const includeRegional = (process.env.OPEN_METEO_INCLUDE_REGIONAL ?? "true") === "true";
  const iranOnly = IRAN_CITIES.slice(0, 6).map((city) => ({
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    country: "Iran",
  }));

  if (!includeRegional) {
    return iranOnly;
  }

  return DEFAULT_FOCAL_POINTS;
}

function weatherUrl(point: FocalPoint): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set(
    "current",
    "weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation",
  );
  url.searchParams.set("timezone", "GMT");
  return url.toString();
}

function airUrl(point: FocalPoint): string {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set(
    "current",
    "pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth",
  );
  url.searchParams.set("timezone", "GMT");
  return url.toString();
}

function floodUrl(point: FocalPoint): string {
  const url = new URL("https://flood-api.open-meteo.com/v1/flood");
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lon));
  url.searchParams.set("daily", "river_discharge");
  url.searchParams.set("forecast_days", "5");
  url.searchParams.set("timezone", "GMT");
  return url.toString();
}

function weatherSeverity(payload: OpenMeteoWeather["current"]): number {
  if (!payload) return 0;
  const gust = Number(payload.wind_gusts_10m ?? 0);
  const wind = Number(payload.wind_speed_10m ?? 0);
  const precipitation = Number(payload.precipitation ?? 0);
  const code = Number(payload.weather_code ?? NaN);

  let severity = 0;
  if (Number.isFinite(gust)) {
    if (gust >= 70) severity += 52;
    else if (gust >= 55) severity += 40;
    else if (gust >= 45) severity += 24;
  }
  if (Number.isFinite(wind) && wind >= 35) severity += 18;
  if (Number.isFinite(precipitation)) {
    if (precipitation >= 12) severity += 34;
    else if (precipitation >= 6) severity += 20;
  }
  if (Number.isFinite(code) && SEVERE_WEATHER_CODES.has(code)) {
    severity += 22;
  }

  return Math.min(100, severity);
}

function airSeverity(payload: OpenMeteoAir["current"]): number {
  if (!payload) return 0;
  const pm10 = Number(payload.pm10 ?? 0);
  const pm25 = Number(payload.pm2_5 ?? 0);
  const no2 = Number(payload.nitrogen_dioxide ?? 0);
  const so2 = Number(payload.sulphur_dioxide ?? 0);
  const ozone = Number(payload.ozone ?? 0);
  const aod = Number(payload.aerosol_optical_depth ?? 0);

  let severity = 0;
  if (pm25 >= 55) severity += 58;
  else if (pm25 >= 35) severity += 42;
  if (pm10 >= 150) severity += 45;
  else if (pm10 >= 100) severity += 30;
  if (no2 >= 120) severity += 18;
  if (so2 >= 75) severity += 20;
  if (ozone >= 180) severity += 16;
  if (aod >= 0.7) severity += 22;

  return Math.min(100, severity);
}

function floodSeverity(payload: OpenMeteoFlood["daily"]): { severity: number; peak: number; rise: number } {
  const rows = payload?.river_discharge ?? [];
  if (rows.length === 0) {
    return { severity: 0, peak: 0, rise: 0 };
  }

  const finite = rows.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { severity: 0, peak: 0, rise: 0 };
  }

  const first = finite[0];
  const peak = Math.max(...finite);
  const rise = peak - first;

  let severity = 0;
  if (peak >= 260) severity += 56;
  else if (peak >= 180) severity += 43;
  else if (peak >= 120) severity += 31;
  if (rise >= 120) severity += 28;
  else if (rise >= 70) severity += 18;

  return {
    severity: Math.min(100, severity),
    peak,
    rise,
  };
}

function weatherItem(
  point: FocalPoint,
  now: number,
  payload: OpenMeteoWeather["current"],
  severity: number,
): NormalizedIngestItem {
  const gust = Number(payload?.wind_gusts_10m ?? 0);
  const rain = Number(payload?.precipitation ?? 0);
  const ts = parseTimestamp(payload?.time, now);
  const summary = `Open-Meteo weather anomaly near ${point.name}: gust ${gust.toFixed(1)} km/h, precipitation ${rain.toFixed(1)} mm/h.`;

  return {
    sourceType: "signals",
    sourceName: "Open-Meteo Weather",
    url: "https://open-meteo.com/en/docs",
    publishedTs: ts,
    fetchedTs: now,
    title: `Weather stress near ${point.name}`,
    summary,
    category: "other",
    lat: point.lat,
    lon: point.lon,
    placeName: point.name,
    country: point.country,
    keywords: extractKeywords(summary),
    credibilityWeight: 0.63,
    rawJson: {
      provider: "open_meteo",
      weather: payload,
      anomalyScore: severity,
      severity,
      signalType: "weather",
    },
    isGeoPrecise: true,
    signalType: "weather",
    whatWeKnow: [
      "Data came from Open-Meteo current weather endpoint (no API key).",
      `Computed weather anomaly score: ${Math.round(severity)}.`,
    ],
    whatWeDontKnow: [
      "Weather anomalies alone do not identify cause or attribution.",
      "Station-model differences can create local uncertainty.",
    ],
  };
}

function airItem(
  point: FocalPoint,
  now: number,
  payload: OpenMeteoAir["current"],
  severity: number,
): NormalizedIngestItem {
  const pm25 = Number(payload?.pm2_5 ?? 0);
  const pm10 = Number(payload?.pm10 ?? 0);
  const ts = parseTimestamp(payload?.time, now);
  const summary = `Open-Meteo air-quality anomaly near ${point.name}: PM2.5 ${pm25.toFixed(1)} ug/m3, PM10 ${pm10.toFixed(1)} ug/m3.`;

  return {
    sourceType: "signals",
    sourceName: "Open-Meteo Air",
    url: "https://open-meteo.com/en/docs/air-quality-api",
    publishedTs: ts,
    fetchedTs: now,
    title: `Air-quality stress near ${point.name}`,
    summary,
    category: "other",
    lat: point.lat,
    lon: point.lon,
    placeName: point.name,
    country: point.country,
    keywords: extractKeywords(summary),
    credibilityWeight: 0.61,
    rawJson: {
      provider: "open_meteo",
      air: payload,
      anomalyScore: severity,
      severity,
      signalType: "air_quality",
    },
    isGeoPrecise: true,
    signalType: "air_quality",
    whatWeKnow: [
      "Data came from Open-Meteo air quality endpoint (no API key).",
      `Computed air anomaly score: ${Math.round(severity)}.`,
    ],
    whatWeDontKnow: [
      "Air pollution spikes can have industrial, weather, or conflict drivers.",
      "Ground confirmation is required before attributing cause.",
    ],
  };
}

function floodItem(
  point: FocalPoint,
  now: number,
  payload: OpenMeteoFlood["daily"],
  severity: number,
  peak: number,
  rise: number,
): NormalizedIngestItem {
  const publishedTs = now;
  const summary = `Open-Meteo flood signal near ${point.name}: projected river discharge peak ${peak.toFixed(1)} m3/s with ${rise.toFixed(1)} m3/s rise.`;

  return {
    sourceType: "signals",
    sourceName: "Open-Meteo Flood",
    url: "https://open-meteo.com/en/docs/flood-api",
    publishedTs,
    fetchedTs: now,
    title: `Flood stress near ${point.name}`,
    summary,
    category: "other",
    lat: point.lat,
    lon: point.lon,
    placeName: point.name,
    country: point.country,
    keywords: extractKeywords(summary),
    credibilityWeight: 0.59,
    rawJson: {
      provider: "open_meteo",
      flood: payload,
      peakDischarge: peak,
      riseDischarge: rise,
      anomalyScore: severity,
      severity,
      signalType: "flood",
    },
    isGeoPrecise: true,
    signalType: "flood",
    whatWeKnow: [
      "Data came from Open-Meteo flood endpoint (no API key).",
      `Forecast discharge anomaly score: ${Math.round(severity)}.`,
    ],
    whatWeDontKnow: [
      "Hydrologic forecasts should be corroborated with local reports.",
      "Flood stress does not necessarily indicate conflict activity.",
    ],
  };
}

export async function fetchOpenMeteoSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];
  const points = buildFocalPoints();

  for (const point of points) {
    const [weatherRun, airRun, floodRun] = await Promise.allSettled([
      fetchJson<OpenMeteoWeather>(weatherUrl(point)),
      fetchJson<OpenMeteoAir>(airUrl(point)),
      fetchJson<OpenMeteoFlood>(floodUrl(point)),
    ]);

    if (weatherRun.status === "fulfilled") {
      const severity = weatherSeverity(weatherRun.value.current);
      if (severity >= 35) {
        items.push(weatherItem(point, now, weatherRun.value.current, severity));
      }
    } else {
      warnings.push(`Open-Meteo weather fetch failed for ${point.name}: ${(weatherRun.reason as Error).message}`);
    }

    if (airRun.status === "fulfilled") {
      const severity = airSeverity(airRun.value.current);
      if (severity >= 40) {
        items.push(airItem(point, now, airRun.value.current, severity));
      }
    } else {
      warnings.push(`Open-Meteo air-quality fetch failed for ${point.name}: ${(airRun.reason as Error).message}`);
    }

    if (floodRun.status === "fulfilled") {
      const flood = floodSeverity(floodRun.value.daily);
      if (flood.severity >= 35) {
        items.push(
          floodItem(point, now, floodRun.value.daily, flood.severity, flood.peak, flood.rise),
        );
      }
    } else {
      warnings.push(`Open-Meteo flood fetch failed for ${point.name}: ${(floodRun.reason as Error).message}`);
    }
  }

  if (items.length === 0) {
    warnings.push("Open-Meteo produced no anomaly rows in this cycle.");
  }

  return {
    items: items.slice(0, 140),
    warnings,
  };
}
