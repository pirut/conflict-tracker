"use node";

import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchText, parseTimestamp } from "./shared";

type AviationMetarRow = {
  icaoId?: string;
  reportTime?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  rawOb?: string;
};

type Airport = {
  icao: string;
  placeName: string;
  lat: number;
  lon: number;
  country: string;
};

const AIRPORTS: Airport[] = [
  { icao: "OIII", placeName: "Tehran", lat: 35.6892, lon: 51.389, country: "Iran" },
  { icao: "OIFM", placeName: "Isfahan", lat: 32.6546, lon: 51.668, country: "Iran" },
  { icao: "OITT", placeName: "Tabriz", lat: 38.0962, lon: 46.2738, country: "Iran" },
  { icao: "OIAW", placeName: "Ahvaz", lat: 31.3183, lon: 48.6706, country: "Iran" },
  { icao: "ORBI", placeName: "Baghdad", lat: 33.3152, lon: 44.3661, country: "Iraq" },
  { icao: "OSDI", placeName: "Damascus", lat: 33.5138, lon: 36.2765, country: "Syria" },
];

function buildMetarUrl(): string {
  const ids = AIRPORTS.map((airport) => airport.icao).join(",");
  const url = new URL("https://aviationweather.gov/api/data/metar");
  url.searchParams.set("ids", ids);
  url.searchParams.set("format", "json");
  return url.toString();
}

function parseVisibility(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace("SM", "").replace("+", "");
  if (!normalized) {
    return null;
  }

  if (normalized.includes(" ")) {
    const [wholeRaw, fracRaw] = normalized.split(" ");
    const whole = Number(wholeRaw);
    if (fracRaw?.includes("/")) {
      const [numRaw, denRaw] = fracRaw.split("/");
      const num = Number(numRaw);
      const den = Number(denRaw);
      if (Number.isFinite(whole) && Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        return whole + num / den;
      }
    }
  }

  if (normalized.includes("/")) {
    const [numRaw, denRaw] = normalized.split("/");
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function aviationSeverity(row: AviationMetarRow): number {
  const wind = Number(row.wspd ?? 0);
  const gust = Number(row.wgst ?? 0);
  const visibility = parseVisibility(row.visib);
  const raw = (row.rawOb ?? "").toUpperCase();

  let severity = 0;
  if (visibility !== null) {
    if (visibility <= 1) severity += 55;
    else if (visibility <= 2) severity += 42;
    else if (visibility <= 4) severity += 24;
  }
  if (gust >= 45) severity += 38;
  else if (gust >= 30) severity += 25;
  if (wind >= 28) severity += 18;
  if (raw.includes(" TS") || raw.includes("+TS") || raw.includes("SQ")) severity += 22;
  if (raw.includes("FG") || raw.includes("FZRA")) severity += 20;
  if (raw.includes("VOLCANIC ASH")) severity += 40;

  return Math.min(100, severity);
}

function mapRowToItem(
  row: AviationMetarRow,
  airport: Airport,
  now: number,
): NormalizedIngestItem {
  const severity = aviationSeverity(row);
  const visibility = parseVisibility(row.visib);
  const wind = Number(row.wspd ?? 0);
  const gust = Number(row.wgst ?? 0);
  const ts = parseTimestamp(
    row.reportTime ?? (typeof row.obsTime === "number" ? row.obsTime * 1000 : undefined),
    now,
  );
  const summary = `AviationWeather anomaly near ${airport.placeName}: visibility ${visibility ?? "n/a"} SM, wind ${wind.toFixed(0)} kt, gust ${gust.toFixed(0)} kt.`;

  return {
    sourceType: "signals",
    sourceName: "NOAA AviationWeather",
    url: "https://aviationweather.gov/data/api/",
    publishedTs: ts,
    fetchedTs: now,
    title: `Aviation weather stress at ${airport.icao}`,
    summary,
    category: "flight",
    lat: airport.lat,
    lon: airport.lon,
    placeName: airport.placeName,
    country: airport.country,
    keywords: extractKeywords(`${airport.icao} ${summary}`),
    credibilityWeight: 0.67,
    rawJson: {
      provider: "aviationweather",
      airportIcao: airport.icao,
      visibilitySm: visibility,
      windKt: wind,
      gustKt: gust,
      anomalyScore: severity,
      severity,
      rawOb: row.rawOb,
      signalType: "aviation_weather",
    },
    isGeoPrecise: true,
    signalType: "aviation_weather",
    whatWeKnow: [
      `METAR-derived aviation anomaly score: ${Math.round(severity)}.`,
      "Observation sourced from AviationWeather.gov machine API.",
    ],
    whatWeDontKnow: [
      "Aviation weather stress can disrupt flight operations without conflict activity.",
      "Additional corroboration is needed before inferring intentional disruption.",
    ],
  };
}

export async function fetchAviationWeatherSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;

  try {
    const text = await fetchText(buildMetarUrl());
    if (!text.trim()) {
      return {
        items: [],
        warnings: ["AviationWeather returned no METAR rows."],
      };
    }

    const rows = JSON.parse(text) as AviationMetarRow[];
    const byIcao = new Map<string, AviationMetarRow>();
    for (const row of rows) {
      const icao = row.icaoId?.toUpperCase();
      if (!icao) continue;
      if (!byIcao.has(icao)) {
        byIcao.set(icao, row);
      }
    }

    const items: NormalizedIngestItem[] = [];
    for (const airport of AIRPORTS) {
      const row = byIcao.get(airport.icao);
      if (!row) {
        continue;
      }

      const severity = aviationSeverity(row);
      if (severity < 30) {
        continue;
      }

      items.push(mapRowToItem(row, airport, now));
    }

    if (items.length === 0) {
      return {
        items: [],
        warnings: ["AviationWeather produced no rows above anomaly threshold."],
      };
    }

    return {
      items,
      warnings: [],
    };
  } catch (error) {
    return {
      items: [],
      warnings: [`AviationWeather fetch failed: ${(error as Error).message}`],
    };
  }
}
