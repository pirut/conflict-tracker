"use node";

import { extractKeywords } from "../../lib/categorize";
import { nearestIranCity } from "../../lib/geo";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchText, parseTimestamp } from "./shared";

type FirmsRow = {
  latitude: number;
  longitude: number;
  brightness: number;
  acq_date?: string;
  acq_time?: string;
  satellite?: string;
};

function parseCsvRow(line: string, headers: string[]): Record<string, string> {
  const values = line.split(",").map((value) => value.trim());
  const row: Record<string, string> = {};

  headers.forEach((header, index) => {
    row[header] = values[index] ?? "";
  });

  return row;
}

function toRow(row: Record<string, string>): FirmsRow | null {
  const latitude = Number(row.latitude ?? row.lat);
  const longitude = Number(row.longitude ?? row.lon);
  const brightness = Number(row.bright_ti4 ?? row.brightness ?? 0);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    brightness,
    acq_date: row.acq_date,
    acq_time: row.acq_time,
    satellite: row.satellite,
  };
}

function rowTimestamp(row: FirmsRow, fallback: number): number {
  if (!row.acq_date) {
    return fallback;
  }

  const hourMinute = (row.acq_time ?? "0000").padStart(4, "0");
  const iso = `${row.acq_date}T${hourMinute.slice(0, 2)}:${hourMinute.slice(2, 4)}:00Z`;
  return parseTimestamp(iso, fallback);
}

function mapRowToItem(row: FirmsRow, now: number): NormalizedIngestItem {
  const nearest = nearestIranCity(row.latitude, row.longitude);
  const publishedTs = rowTimestamp(row, now);
  const title = `Thermal hotspot detected near ${nearest.name}`;
  const summary = `NASA FIRMS detected a thermal hotspot near ${nearest.name}. Brightness index: ${Math.round(row.brightness)}.`;

  return {
    sourceType: "signals",
    sourceName: "NASA FIRMS",
    url: "https://firms.modaps.eosdis.nasa.gov/",
    publishedTs,
    fetchedTs: now,
    title,
    summary,
    category: "fire",
    lat: row.latitude,
    lon: row.longitude,
    placeName: nearest.name,
    country: "Iran",
    keywords: extractKeywords(summary),
    credibilityWeight: 0.78,
    rawJson: row as unknown as Record<string, unknown>,
    isGeoPrecise: true,
    signalType: "firms",
    whatWeKnow: [
      "Thermal anomaly was recorded by a satellite source.",
      "Location estimate is geospatially precise.",
    ],
    whatWeDontKnow: [
      "Thermal signatures do not alone confirm a strike or military action.",
      "Additional context is required to determine cause.",
    ],
  };
}

export async function fetchFirmsHotspots(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];

  const apiKey = process.env.FIRMS_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      warnings: ["FIRMS_API_KEY missing, skipping FIRMS ingestion."],
    };
  }

  const satellite = process.env.FIRMS_SATELLITE ?? "VIIRS_SNPP_NRT";
  // Area API: west,south,east,north (Iran bbox). Override with FIRMS_AREA_BBOX env if needed.
  const areaBbox = process.env.FIRMS_AREA_BBOX ?? "44,25,63.5,39.8";
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${satellite}/${areaBbox}/1`;

  try {
    const csv = await fetchText(url);
    const lines = csv.split(/\r?\n/).filter(Boolean);

    if (lines.length < 2) {
      return { items: [], warnings: ["FIRMS returned no hotspot rows."] };
    }

    const headers = lines[0].split(",").map((header) => header.trim());
    const items = lines
      .slice(1)
      .map((line) => parseCsvRow(line, headers))
      .map((row) => toRow(row))
      .filter((row): row is FirmsRow => row !== null)
      .slice(0, 120)
      .map((row) => mapRowToItem(row, now));

    return { items, warnings };
  } catch (error) {
    warnings.push(`FIRMS fetch failed: ${(error as Error).message}`);
    return { items: [], warnings };
  }
}
