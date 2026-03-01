"use node";

import { IRAN_DEFAULT_CENTER } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson, parseTimestamp } from "./shared";

type TleMember = {
  satelliteId?: number;
  name?: string;
  date?: string;
  line1?: string;
  line2?: string;
};

type TleResponse = {
  member?: TleMember[];
};

const SEARCH_TERMS = ["YAOGAN", "NROL", "KOSMOS", "OFEQ", "RESURS", "KANOPUS"];

function buildQueryUrl(search: string, limit: number): string {
  const url = new URL("https://tle.ivanstanojevic.me/api/tle/");
  url.searchParams.set("search", search);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function mapRows(
  rows: TleMember[],
  searchTerm: string,
  now: number,
): NormalizedIngestItem[] {
  const items: NormalizedIngestItem[] = [];

  for (const row of rows) {
    if (!row.name || !row.line1 || !row.line2) {
      continue;
    }

    const ts = parseTimestamp(row.date, now);
    const summary = `Satellite TLE update (${searchTerm}) for ${row.name}. Latest epoch ${row.date ?? "unknown"}.`;

    items.push({
      sourceType: "signals",
      sourceName: "Satellite TLE API",
      url: "https://tle.ivanstanojevic.me/api/tle/",
      publishedTs: ts,
      fetchedTs: now,
      title: `Orbital tracking update: ${row.name}`,
      summary,
      category: "satellite",
      lat: IRAN_DEFAULT_CENTER.lat,
      lon: IRAN_DEFAULT_CENTER.lon,
      placeName: "Iran (orbital context)",
      country: "Iran",
      keywords: extractKeywords(`${row.name} ${summary}`),
      credibilityWeight: 0.42,
      rawJson: {
        provider: "tle_ivanstanojevic",
        searchTerm,
        satelliteId: row.satelliteId,
        name: row.name,
        epoch: row.date,
        line1: row.line1,
        line2: row.line2,
        anomalyScore: 28,
        severity: 28,
        signalType: "orbital",
      },
      isGeoPrecise: false,
      signalType: "orbital",
      whatWeKnow: [
        "TLE row was retrieved from an open satellite orbital feed.",
        "This indicates orbital object tracking metadata, not direct ground impact.",
      ],
      whatWeDontKnow: [
        "TLE data alone does not confirm sensing targets or collection intent.",
        "No direct geolocated activity can be inferred from this row alone.",
      ],
    });
  }

  return items;
}

export async function fetchOrbitalSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  if ((process.env.ORBITAL_SIGNALS_ENABLED ?? "true") !== "true") {
    return {
      items: [],
      warnings: ["Orbital signal adapter disabled via ORBITAL_SIGNALS_ENABLED."],
    };
  }

  const now = context.now;
  const perTermRaw = Number(process.env.ORBITAL_SIGNALS_PER_TERM ?? 4);
  const perTerm = Number.isFinite(perTermRaw) ? Math.max(1, Math.min(8, Math.round(perTermRaw))) : 4;
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];

  for (const searchTerm of SEARCH_TERMS) {
    try {
      const payload = await fetchJson<TleResponse>(buildQueryUrl(searchTerm, perTerm), {
        headers: {
          "User-Agent": "conflict-tracker/3.0 (+https://localhost)",
        },
      });
      items.push(...mapRows(payload.member ?? [], searchTerm, now));
    } catch (error) {
      warnings.push(`TLE fetch failed for ${searchTerm}: ${(error as Error).message}`);
    }
  }

  const deduped = new Map<string, NormalizedIngestItem>();
  for (const item of items) {
    const key = String(item.rawJson?.satelliteId ?? item.title);
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  const list = [...deduped.values()]
    .sort((a, b) => b.publishedTs - a.publishedTs)
    .slice(0, 36);

  if (list.length === 0) {
    warnings.push("No orbital tracking rows were accepted.");
  }

  return {
    items: list,
    warnings,
  };
}
