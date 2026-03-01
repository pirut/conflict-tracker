"use node";

import { IRAN_DEFAULT_CENTER } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { fetchJson } from "./shared";

type PowerFeedResponse = {
  samples?: Array<{
    region?: string;
    lat?: number;
    lon?: number;
    outagePct?: number;
    availabilityPct?: number;
    customersOut?: number;
    observedAt?: string | number;
    provider?: string;
    notes?: string;
  }>;
};

type OoniMeasurement = {
  measurement_start_time?: string;
  anomaly?: boolean;
};

type OoniResponse = {
  results?: OoniMeasurement[];
};

function withinOutageWindow(ts: number, now: number): boolean {
  const age = now - ts;
  return age >= 0 && age <= 30 * 60 * 60 * 1000;
}

function parseObservedTs(input: string | number | undefined, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  const parsed = Date.parse(typeof input === "string" ? input : "");
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function customRowsToItems(rows: PowerFeedResponse["samples"], now: number): NormalizedIngestItem[] {
  const items: NormalizedIngestItem[] = [];
  for (const row of rows ?? []) {
    const lat = Number(row.lat ?? NaN);
    const lon = Number(row.lon ?? NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const availability = Number(row.availabilityPct ?? NaN);
    const outagePct = Number.isFinite(Number(row.outagePct))
      ? Number(row.outagePct)
      : Number.isFinite(availability)
        ? 100 - availability
        : NaN;
    if (!Number.isFinite(outagePct)) {
      continue;
    }

    const observedTs = parseObservedTs(row.observedAt, now);
    if (!withinOutageWindow(observedTs, now)) {
      continue;
    }

    const region = row.region?.trim() || "Iran";
    const provider = row.provider?.trim() || "PowerFeed";
    const customersOut = Number(row.customersOut ?? NaN);
    const customerLine = Number.isFinite(customersOut)
      ? ` Estimated customers affected: ${Math.round(customersOut).toLocaleString()}.`
      : "";
    const summary = `Power outage estimate in ${region}: ${outagePct.toFixed(1)}% grid unavailability.${customerLine}`;

    items.push({
      sourceType: "signals",
      sourceName: provider,
      url: process.env.POWER_OUTAGE_FEED_ENDPOINT,
      publishedTs: observedTs,
      fetchedTs: now,
      title: `Power outage signal in ${region}`,
      summary,
      category: "power",
      lat,
      lon,
      placeName: region,
      country: "Iran",
      keywords: extractKeywords(summary),
      credibilityWeight: 0.78,
      rawJson: {
        provider,
        outagePct,
        availabilityPct: Number.isFinite(availability) ? availability : null,
        customersOut: Number.isFinite(customersOut) ? customersOut : null,
        notes: row.notes,
        signalType: "power",
      },
      isGeoPrecise: true,
      signalType: "power",
      whatWeKnow: [
        `Feed-reported outage estimate: ${outagePct.toFixed(1)}%.`,
        "Signal came from a configured power outage feed endpoint.",
      ],
      whatWeDontKnow: [
        "Coverage depends on provider instrumentation and reporting scope.",
        "Local restoration timing requires follow-up snapshots.",
      ],
    });
  }

  return items;
}

async function fetchCustomPowerOutage(now: number): Promise<{
  items: NormalizedIngestItem[];
  warning?: string;
}> {
  const endpoint = process.env.POWER_OUTAGE_FEED_ENDPOINT?.trim();
  if (!endpoint) {
    return { items: [] };
  }

  try {
    const payload = await fetchJson<PowerFeedResponse>(endpoint, {
      headers:
        process.env.POWER_OUTAGE_FEED_TOKEN
          ? { Authorization: `Bearer ${process.env.POWER_OUTAGE_FEED_TOKEN}` }
          : undefined,
    });
    return {
      items: customRowsToItems(payload.samples, now).slice(0, 120),
    };
  } catch (error) {
    return {
      items: [],
      warning: `Power outage endpoint fetch failed: ${(error as Error).message}`,
    };
  }
}

async function fetchOoniDerivedPowerRisk(now: number): Promise<NormalizedIngestItem | null> {
  const url = new URL("https://api.ooni.io/api/v1/measurements");
  url.searchParams.set("probe_cc", "IR");
  url.searchParams.set("anomaly", "true");
  url.searchParams.set("limit", "100");

  const payload = await fetchJson<OoniResponse>(url.toString(), {
    headers: {
      "User-Agent": "conflict-tracker/3.0",
    },
  });

  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const anomalies = (payload.results ?? []).filter((row) => {
    const ts = Date.parse(row.measurement_start_time ?? "");
    return Number.isFinite(ts) && ts >= sixHoursAgo;
  });

  if (anomalies.length < 10) {
    return null;
  }

  const availabilityPct = Math.max(10, 100 - Math.min(90, anomalies.length * 2.4));
  const outagePct = 100 - availabilityPct;
  const summary = `Connectivity telemetry implies elevated power outage risk in Iran: estimated ${outagePct.toFixed(1)}% outage-equivalent stress over the last 6h.`;

  return {
    sourceType: "signals",
    sourceName: "Inferred Grid Stress",
    url: "https://api.ooni.io/",
    publishedTs: now,
    fetchedTs: now,
    title: "Inferred power-stress anomaly in Iran",
    summary,
    category: "power",
    lat: IRAN_DEFAULT_CENTER.lat,
    lon: IRAN_DEFAULT_CENTER.lon,
    placeName: "Iran (national)",
    country: "Iran",
    keywords: extractKeywords(summary),
    credibilityWeight: 0.42,
    rawJson: {
      provider: "ooni_inference",
      anomalyCount: anomalies.length,
      availabilityPct,
      outagePct,
      inferred: true,
      signalType: "power",
    },
    isGeoPrecise: false,
    signalType: "power",
    whatWeKnow: [
      `Recent OONI anomaly count: ${anomalies.length} in the last 6 hours.`,
      "This is an inferred power-stress signal, not a direct utility outage feed.",
    ],
    whatWeDontKnow: [
      "Connectivity anomalies can be caused by censorship, routing issues, or physical outages.",
      "Treat this as a risk indicator until corroborated by direct outage telemetry.",
    ],
  };
}

export async function fetchPowerSignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];

  const custom = await fetchCustomPowerOutage(now);
  if (custom.warning) {
    warnings.push(custom.warning);
  }

  const items = [...custom.items];
  if ((process.env.POWER_INCLUDE_INFERRED ?? "true") === "true") {
    try {
      const inferred = await fetchOoniDerivedPowerRisk(now);
      if (inferred) {
        items.push(inferred);
      }
    } catch (error) {
      warnings.push(`Inferred power-risk fetch failed: ${(error as Error).message}`);
    }
  }

  if (items.length === 0) {
    warnings.push(
      "No direct power-outage feed rows available; configure POWER_OUTAGE_FEED_ENDPOINT for concrete outage telemetry.",
    );
  }

  return {
    items,
    warnings,
  };
}
