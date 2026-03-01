"use node";

import { extractKeywords } from "../../lib/categorize";
import { nearestIranCity } from "../../lib/geo";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchText, parseTimestamp, reverseGeocodeNominatim } from "./shared";

type AggregatedRow = {
  phenomenon: string;
  lat: number;
  lon: number;
  latestTs: number;
  latestValue: number;
  maxValue: number;
  count: number;
};

const DEFAULT_BBOX = "44,25,63.5,39.8";
const DEFAULT_PHENOMENA = ["PM10", "PM2.5"];

function anomalyThreshold(phenomenon: string): number {
  const normalized = phenomenon.toUpperCase();
  if (normalized === "PM10") return 100;
  if (normalized === "PM2.5") return 55;
  if (normalized === "NO2") return 120;
  return 75;
}

function phenomenonUnit(phenomenon: string): string {
  const normalized = phenomenon.toUpperCase();
  if (normalized === "PM10" || normalized === "PM2.5" || normalized === "NO2") {
    return "ug/m3";
  }
  return "units";
}

function parseCsvRows(csv: string): Array<{ createdAt: string; value: number; lat: number; lon: number }> {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }
  const rows: Array<{ createdAt: string; value: number; lat: number; lon: number }> = [];

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((part) => part.trim());
    if (cols.length < 5) {
      continue;
    }

    const createdAt = cols[1];
    const value = Number(cols[2]);
    const lat = Number(cols[3]);
    const lon = Number(cols[4]);

    if (!Number.isFinite(value) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    rows.push({ createdAt, value, lat, lon });
  }

  return rows;
}

function aggregateRows(
  rows: Array<{ createdAt: string; value: number; lat: number; lon: number }>,
  phenomenon: string,
  now: number,
): AggregatedRow[] {
  const byCell = new Map<string, AggregatedRow>();

  for (const row of rows) {
    const latCell = Math.round(row.lat * 5) / 5;
    const lonCell = Math.round(row.lon * 5) / 5;
    const key = `${phenomenon}:${latCell}:${lonCell}`;
    const ts = parseTimestamp(row.createdAt, now);

    if (!byCell.has(key)) {
      byCell.set(key, {
        phenomenon,
        lat: latCell,
        lon: lonCell,
        latestTs: ts,
        latestValue: row.value,
        maxValue: row.value,
        count: 1,
      });
      continue;
    }

    const existing = byCell.get(key)!;
    existing.count += 1;
    existing.maxValue = Math.max(existing.maxValue, row.value);
    if (ts >= existing.latestTs) {
      existing.latestTs = ts;
      existing.latestValue = row.value;
    }
  }

  return [...byCell.values()];
}

async function mapAggregatedToItems(
  rows: AggregatedRow[],
  now: number,
): Promise<NormalizedIngestItem[]> {
  const maxReverseLookupsRaw = Number(process.env.OPENSENSEMAP_NOMINATIM_MAX_PER_RUN ?? 8);
  const maxReverseLookups = Number.isFinite(maxReverseLookupsRaw)
    ? Math.max(0, Math.min(20, Math.round(maxReverseLookupsRaw)))
    : 8;

  let reverseLookups = 0;
  const items: NormalizedIngestItem[] = [];

  for (const row of rows) {
    const threshold = anomalyThreshold(row.phenomenon);
    if (row.latestValue < threshold && row.maxValue < threshold * 1.1) {
      continue;
    }

    const place = nearestIranCity(row.lat, row.lon);
    let placeName = place.name;
    let country = "Iran";

    if (reverseLookups < maxReverseLookups) {
      reverseLookups += 1;
      const nominatim = await reverseGeocodeNominatim(row.lat, row.lon);
      if (nominatim) {
        placeName = nominatim.placeName;
        country = nominatim.country;
      }
    }

    const unit = phenomenonUnit(row.phenomenon);
    const severity = Math.min(
      100,
      Math.round((row.maxValue / Math.max(1, threshold)) * 45 + row.count * 1.8),
    );
    const summary = `openSenseMap crowd sensor anomaly (${row.phenomenon}) near ${placeName}: latest ${row.latestValue.toFixed(1)} ${unit}, max ${row.maxValue.toFixed(1)} ${unit} from ${row.count} recent samples.`;

    items.push({
      sourceType: "signals",
      sourceName: "openSenseMap",
      url: "https://docs.opensensemap.org/",
      publishedTs: row.latestTs || now,
      fetchedTs: now,
      title: `Crowd sensor anomaly near ${placeName}`,
      summary,
      category: "fire",
      lat: row.lat,
      lon: row.lon,
      placeName,
      country,
      keywords: extractKeywords(summary),
      credibilityWeight: 0.47,
      rawJson: {
        provider: "opensensemap",
        phenomenon: row.phenomenon,
        latestValue: row.latestValue,
        maxValue: row.maxValue,
        count: row.count,
        threshold,
        anomalyScore: severity,
        severity,
        signalType: "environmental_crowd",
      },
      isGeoPrecise: true,
      signalType: "environmental_crowd",
      whatWeKnow: [
        `Anomaly threshold exceeded for ${row.phenomenon}.`,
        `Crowd-sourced sample count: ${row.count}.`,
      ],
      whatWeDontKnow: [
        "Community sensor quality and calibration can vary significantly.",
        "Anomaly may be environmental and not conflict-related.",
      ],
    });
  }

  return items.slice(0, 100);
}

export async function fetchOpenSenseMapSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const hoursRaw = Number(process.env.OPENSENSEMAP_WINDOW_HOURS ?? 8);
  const windowHours = Number.isFinite(hoursRaw) ? Math.max(2, Math.min(24, Math.round(hoursRaw))) : 8;
  const fromDate = new Date(now - windowHours * 60 * 60 * 1000).toISOString();
  const bbox = process.env.OPENSENSEMAP_BBOX ?? DEFAULT_BBOX;
  const phenomena = (process.env.OPENSENSEMAP_PHENOMENA ?? DEFAULT_PHENOMENA.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  const aggregated: AggregatedRow[] = [];

  for (const phenomenon of phenomena) {
    const url = new URL("https://api.opensensemap.org/boxes/data");
    url.searchParams.set("bbox", bbox);
    url.searchParams.set("phenomenon", phenomenon);
    url.searchParams.set("from-date", fromDate);

    try {
      const csv = await fetchText(url.toString(), {
        headers: {
          "User-Agent": "conflict-tracker/3.0 (+https://localhost)",
        },
      });
      const rows = parseCsvRows(csv);
      aggregated.push(...aggregateRows(rows, phenomenon, now));
    } catch (error) {
      warnings.push(`openSenseMap fetch failed for ${phenomenon}: ${(error as Error).message}`);
    }
  }

  const items = await mapAggregatedToItems(aggregated, now);
  if (items.length === 0) {
    warnings.push("openSenseMap produced no rows above configured anomaly thresholds.");
  }

  return {
    items,
    warnings,
  };
}
