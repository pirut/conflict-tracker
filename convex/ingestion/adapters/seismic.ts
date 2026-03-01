"use node";

import { extractKeywords } from "../../lib/categorize";
import { nearestIranCity } from "../../lib/geo";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson } from "./shared";

type UsgsFeature = {
  id?: string;
  properties?: {
    mag?: number;
    place?: string;
    time?: number;
    updated?: number;
    url?: string;
    detail?: string;
    title?: string;
    tsunami?: number;
  };
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
};

type UsgsGeoJson = {
  features?: UsgsFeature[];
};

const DEFAULT_BBOX = {
  minLat: 20,
  maxLat: 41,
  minLon: 42,
  maxLon: 66,
};

function parseBbox() {
  const parts = (process.env.SEISMIC_BBOX ?? "").split(",").map((part) => Number(part.trim()));
  if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
    return {
      minLat: Math.min(parts[0], parts[2]),
      maxLat: Math.max(parts[0], parts[2]),
      minLon: Math.min(parts[1], parts[3]),
      maxLon: Math.max(parts[1], parts[3]),
    };
  }
  return DEFAULT_BBOX;
}

function parsePlaceLabel(raw: string | undefined, fallback: string): string {
  const place = raw?.trim();
  if (!place) {
    return fallback;
  }

  const marker = " of ";
  const idx = place.indexOf(marker);
  if (idx !== -1 && idx + marker.length < place.length) {
    return place.slice(idx + marker.length).trim();
  }

  return place;
}

function magnitudeBand(mag: number): string {
  if (mag >= 6.5) return "major";
  if (mag >= 5.2) return "strong";
  if (mag >= 4.0) return "moderate";
  return "light";
}

function buildQueryUrl(now: number): string {
  const windowHoursRaw = Number(process.env.SEISMIC_WINDOW_HOURS ?? 36);
  const windowHours = Number.isFinite(windowHoursRaw)
    ? Math.max(6, Math.min(72, Math.round(windowHoursRaw)))
    : 36;
  const minMagnitudeRaw = Number(process.env.SEISMIC_MIN_MAGNITUDE ?? 2.8);
  const minMagnitude = Number.isFinite(minMagnitudeRaw)
    ? Math.max(1, Math.min(7, minMagnitudeRaw))
    : 2.8;
  const startTime = new Date(now - windowHours * 60 * 60 * 1000).toISOString();
  const endTime = new Date(now + 2 * 60 * 1000).toISOString();
  const bbox = parseBbox();
  const limitRaw = Number(process.env.SEISMIC_MAX_RESULTS ?? 120);
  const limit = Number.isFinite(limitRaw) ? Math.max(20, Math.min(200, Math.round(limitRaw))) : 120;

  const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", startTime);
  url.searchParams.set("endtime", endTime);
  url.searchParams.set("orderby", "time");
  url.searchParams.set("minmagnitude", String(minMagnitude));
  url.searchParams.set("minlatitude", String(bbox.minLat));
  url.searchParams.set("maxlatitude", String(bbox.maxLat));
  url.searchParams.set("minlongitude", String(bbox.minLon));
  url.searchParams.set("maxlongitude", String(bbox.maxLon));
  url.searchParams.set("limit", String(limit));

  return url.toString();
}

export async function fetchSeismicSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];

  try {
    const response = await fetchJson<UsgsGeoJson>(buildQueryUrl(now), {
      headers: {
        "User-Agent": "conflict-tracker/3.0",
      },
    });

    const items: NormalizedIngestItem[] = [];

    for (const feature of response.features ?? []) {
      const coordinates = feature.geometry?.coordinates ?? [];
      const lon = Number(coordinates[0] ?? NaN);
      const lat = Number(coordinates[1] ?? NaN);
      const depthKm = Number(coordinates[2] ?? NaN);
      const mag = Number(feature.properties?.mag ?? NaN);
      const eventTs = Number(feature.properties?.time ?? NaN);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(mag) ||
        !Number.isFinite(eventTs)
      ) {
        continue;
      }

      const nearest = nearestIranCity(lat, lon);
      const placeLabel = parsePlaceLabel(feature.properties?.place, nearest.name);
      const strength = magnitudeBand(mag);
      const summary = `USGS detected a ${strength} seismic event (M${mag.toFixed(1)}) near ${placeLabel}. Depth ${Number.isFinite(depthKm) ? `${Math.round(depthKm)} km` : "unknown"}.`;
      const link = feature.properties?.url ?? feature.properties?.detail;

      items.push({
        sourceType: "signals",
        sourceName: "USGS Quake Feed",
        url: link,
        publishedTs: eventTs,
        fetchedTs: now,
        title: `Seismic event M${mag.toFixed(1)} near ${placeLabel}`,
        summary,
        category: "seismic",
        lat,
        lon,
        placeName: placeLabel,
        country: placeLabel.toLowerCase().includes("iran") ? "Iran" : "Regional",
        keywords: extractKeywords(summary),
        credibilityWeight: 0.86,
        rawJson: {
          usgsEventId: feature.id,
          magnitude: mag,
          depthKm: Number.isFinite(depthKm) ? depthKm : null,
          place: feature.properties?.place,
          tsunami: feature.properties?.tsunami,
          signalType: "seismic",
        },
        isGeoPrecise: true,
        signalType: "seismic",
        whatWeKnow: [
          `USGS reported an event magnitude of M${mag.toFixed(1)}.`,
          Number.isFinite(depthKm)
            ? `Estimated depth: ${Math.round(depthKm)} km.`
            : "Estimated depth was not available in the feed row.",
          "Coordinates come from instrument-derived seismic location estimates.",
        ],
        whatWeDontKnow: [
          "Seismic events can be tectonic, industrial, or induced; cause is not confirmed in this feed.",
          "Damage or operational impact requires separate local reporting.",
        ],
      });
    }

    if (items.length === 0) {
      warnings.push("USGS returned no accepted seismic rows for the configured window.");
    }

    return {
      items: items.slice(0, 160),
      warnings,
    };
  } catch (error) {
    return {
      items: [],
      warnings: [`USGS seismic fetch failed: ${(error as Error).message}`],
    };
  }
}
