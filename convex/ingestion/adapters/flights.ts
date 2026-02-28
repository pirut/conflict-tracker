"use node";

import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson } from "./shared";

type OpenSkyStateResponse = {
  states?: unknown[];
};

type AdsbLolResponse = {
  total?: number;
  ac?: unknown[];
};

type FlightArea = {
  city: string;
  lat: number;
  lon: number;
  radiusDeg: number;
};

const FLIGHT_AREAS: FlightArea[] = [
  { city: "Tehran", lat: 35.6892, lon: 51.389, radiusDeg: 1.3 },
  { city: "Isfahan", lat: 32.6546, lon: 51.668, radiusDeg: 1.25 },
  { city: "Shiraz", lat: 29.5918, lon: 52.5837, radiusDeg: 1.2 },
  { city: "Mashhad", lat: 36.2605, lon: 59.6168, radiusDeg: 1.4 },
  { city: "Tabriz", lat: 38.0962, lon: 46.2738, radiusDeg: 1.25 },
];

function authHeader(): HeadersInit | undefined {
  const user = process.env.OPENSKY_USERNAME;
  const password = process.env.OPENSKY_PASSWORD;
  if (!user || !password) {
    return undefined;
  }
  const token = Buffer.from(`${user}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function fetchAreaFlightCount(area: FlightArea): Promise<number> {
  const lamin = area.lat - area.radiusDeg;
  const lamax = area.lat + area.radiusDeg;
  const lomin = area.lon - area.radiusDeg;
  const lomax = area.lon + area.radiusDeg;

  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const response = await fetchJson<OpenSkyStateResponse>(url, {
    headers: authHeader(),
  });
  return response.states?.length ?? 0;
}

async function fetchAreaFlightCountAdsb(area: FlightArea): Promise<number> {
  const radiusNm = Math.max(40, Math.round(area.radiusDeg * 52));
  const url = `https://api.adsb.lol/v2/point/${area.lat}/${area.lon}/${radiusNm}`;
  const response = await fetchJson<AdsbLolResponse>(url, {
    headers: {
      "User-Agent": "conflict-tracker/1.0",
    },
  });
  const total = Number(response.total ?? response.ac?.length ?? 0);
  return Number.isFinite(total) ? total : 0;
}

async function fetchFlightCountWithFallback(area: FlightArea): Promise<{
  count: number;
  provider: "opensky" | "adsb_lol";
}> {
  try {
    const count = await fetchAreaFlightCount(area);
    return {
      count,
      provider: "opensky",
    };
  } catch (openskyError) {
    try {
      const count = await fetchAreaFlightCountAdsb(area);
      return {
        count,
        provider: "adsb_lol",
      };
    } catch (adsbError) {
      throw new Error(
        `OpenSky failed (${(openskyError as Error).message}); ADSB.lol failed (${(adsbError as Error).message})`,
      );
    }
  }
}

export async function fetchFlightSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];

  for (const area of FLIGHT_AREAS) {
    try {
      const result = await fetchFlightCountWithFallback(area);
      const providerName = result.provider === "opensky" ? "OpenSky" : "adsb.lol";
      const count = result.count;
      const summary = `${providerName} tracked ${count} flights around ${area.city} in the current observation window.`;

      items.push({
        sourceType: "signals",
        sourceName: providerName,
        url:
          result.provider === "opensky"
            ? "https://opensky-network.org/network/explorer"
            : "https://api.adsb.lol/",
        publishedTs: now,
        fetchedTs: now,
        title: `Flight activity near ${area.city}`,
        summary,
        category: "flight",
        lat: area.lat,
        lon: area.lon,
        placeName: area.city,
        country: "Iran",
        keywords: extractKeywords(summary),
        credibilityWeight: result.provider === "opensky" ? 0.72 : 0.68,
        rawJson: {
          city: area.city,
          count,
          area,
          provider: result.provider,
        },
        isGeoPrecise: true,
        signalType: "flight",
        whatWeKnow: [
          `Current observed flights near ${area.city}: ${count}.`,
          `${providerName} data reflects ADS-B coverage and known aircraft transponders.`,
        ],
        whatWeDontKnow: [
          "Not all flights may be visible due to transponder behavior or coverage gaps.",
          "A single snapshot does not establish a sustained disruption trend.",
        ],
      });
    } catch (error) {
      warnings.push(`OpenSky ${area.city} failed: ${(error as Error).message}`);
    }
  }

  return { items, warnings };
}
