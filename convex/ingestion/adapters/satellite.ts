"use node";

import { extractKeywords } from "../../lib/categorize";
import { nearestIranCity } from "../../lib/geo";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson, parseTimestamp } from "./shared";

type EonetCategory = {
  id?: string;
  title?: string;
};

type EonetGeometry = {
  date?: string;
  type?: string;
  coordinates?: unknown;
  magnitudeValue?: number;
  magnitudeUnit?: string;
};

type EonetEvent = {
  id?: string;
  title?: string;
  description?: string;
  link?: string;
  closed?: string | null;
  categories?: EonetCategory[];
  geometry?: EonetGeometry[];
};

type EonetResponse = {
  events?: EonetEvent[];
};

type Bbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const DEFAULT_BBOX: Bbox = {
  west: 24,
  south: 10,
  east: 67,
  north: 42,
};

function parseBbox(): Bbox {
  const raw = (process.env.SATELLITE_BBOX ?? "").split(",").map((part) => Number(part.trim()));
  if (raw.length === 4 && raw.every((value) => Number.isFinite(value))) {
    return {
      west: Math.min(raw[0], raw[2]),
      south: Math.min(raw[1], raw[3]),
      east: Math.max(raw[0], raw[2]),
      north: Math.max(raw[1], raw[3]),
    };
  }

  return DEFAULT_BBOX;
}

function withinBbox(lat: number, lon: number, bbox: Bbox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

function flattenCoordinates(input: unknown): Array<[number, number]> {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }

  const first = input[0];
  if (
    Array.isArray(first) &&
    first.length >= 2 &&
    typeof first[0] === "number" &&
    typeof first[1] === "number"
  ) {
    return (input as unknown[]).map((coords) => {
      const pair = coords as number[];
      return [pair[0], pair[1]];
    });
  }

  const out: Array<[number, number]> = [];
  for (const nested of input) {
    out.push(...flattenCoordinates(nested));
  }
  return out;
}

function geometryPoint(geometry: EonetGeometry): { lat: number; lon: number } | null {
  const coords = geometry.coordinates;
  if (!coords) {
    return null;
  }

  if (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    return {
      lon: coords[0],
      lat: coords[1],
    };
  }

  const flat = flattenCoordinates(coords);
  if (flat.length === 0) {
    return null;
  }
  const totals = flat.reduce(
    (acc, point) => {
      acc.lon += point[0];
      acc.lat += point[1];
      return acc;
    },
    { lat: 0, lon: 0 },
  );

  return {
    lon: totals.lon / flat.length,
    lat: totals.lat / flat.length,
  };
}

function geometryTs(geometry: EonetGeometry | undefined, now: number): number {
  if (!geometry) {
    return now;
  }
  return parseTimestamp(geometry.date, now);
}

function hasFireLabel(categories: string[]): boolean {
  return categories.some(
    (category) =>
      category.includes("fire") ||
      category.includes("wildfire") ||
      category.includes("thermal"),
  );
}

function recencyWindowDays(): number {
  const raw = Number(process.env.SATELLITE_DAYS ?? 7);
  if (!Number.isFinite(raw)) {
    return 7;
  }
  return Math.max(1, Math.min(14, Math.round(raw)));
}

function mapEventToItems(event: EonetEvent, now: number, bbox: Bbox): NormalizedIngestItem[] {
  const categories = (event.categories ?? [])
    .map((category) => category.title?.trim().toLowerCase())
    .filter((item): item is string => Boolean(item));
  const categoryText = categories.length > 0 ? categories.join(", ") : "satellite event";

  const rows: NormalizedIngestItem[] = [];
  for (const geometry of event.geometry ?? []) {
    const point = geometryPoint(geometry);
    if (!point) {
      continue;
    }
    if (!withinBbox(point.lat, point.lon, bbox)) {
      continue;
    }

    const near = nearestIranCity(point.lat, point.lon);
    const publishedTs = geometryTs(geometry, now);
    const magnitudeValue = Number(geometry.magnitudeValue ?? NaN);
    const magnitudeText =
      Number.isFinite(magnitudeValue) && geometry.magnitudeUnit
        ? ` Magnitude ${magnitudeValue.toFixed(1)} ${geometry.magnitudeUnit}.`
        : "";
    const title = event.title?.trim() || `Satellite event near ${near.name}`;
    const summary = `NASA EONET reported a ${categoryText} observation near ${near.name}.${magnitudeText}`.trim();

    rows.push({
      sourceType: "signals",
      sourceName: "NASA EONET",
      url: event.link,
      publishedTs,
      fetchedTs: now,
      title,
      summary,
      category: hasFireLabel(categories) ? "fire" : "satellite",
      lat: point.lat,
      lon: point.lon,
      placeName: near.name,
      country: "Iran",
      keywords: extractKeywords(`${title} ${summary}`),
      credibilityWeight: 0.74,
      rawJson: {
        eonetId: event.id,
        categories,
        geometryType: geometry.type,
        magnitudeValue: Number.isFinite(magnitudeValue) ? magnitudeValue : null,
        magnitudeUnit: geometry.magnitudeUnit,
        signalType: "satellite",
      },
      isGeoPrecise: true,
      signalType: "satellite",
      whatWeKnow: [
        "Observation comes from NASA EONET public satellite event feed.",
        categories.length > 0
          ? `Tagged categories: ${categories.slice(0, 3).join(", ")}.`
          : "No EONET category metadata was attached to this point.",
      ],
      whatWeDontKnow: [
        "Satellite observations indicate conditions, not actor attribution.",
        "Cause and intent need corroboration from independent reporting.",
      ],
    });
  }

  return rows;
}

export async function fetchSatelliteSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const bbox = parseBbox();
  const days = recencyWindowDays();

  try {
    const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
    url.searchParams.set("status", "open");
    url.searchParams.set("days", String(days));

    const response = await fetchJson<EonetResponse>(url.toString(), {
      headers: {
        "User-Agent": "conflict-tracker/3.0",
      },
    });

    const rows = (response.events ?? [])
      .flatMap((event) => mapEventToItems(event, now, bbox))
      .sort((a, b) => b.publishedTs - a.publishedTs);

    if (rows.length === 0) {
      return {
        items: [],
        warnings: ["NASA EONET returned no accepted satellite rows in the configured area window."],
      };
    }

    return {
      items: rows.slice(0, 160),
      warnings: [],
    };
  } catch (error) {
    return {
      items: [],
      warnings: [`NASA EONET fetch failed: ${(error as Error).message}`],
    };
  }
}
