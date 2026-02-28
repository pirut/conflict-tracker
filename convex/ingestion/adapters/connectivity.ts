"use node";

import { IRAN_DEFAULT_CENTER } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { fetchJson } from "./shared";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";

type OoniMeasurement = {
  measurement_start_time?: string;
  test_name?: string;
  probe_cc?: string;
  anomaly?: boolean;
  scores?: {
    blocking_general?: number;
  };
};

type OoniResponse = {
  results?: OoniMeasurement[];
};

type CustomConnectivityResponse = {
  samples?: Array<{
    region?: string;
    availabilityPct?: number;
    lat?: number;
    lon?: number;
    observedAt?: string | number;
    notes?: string;
  }>;
};

async function fetchCustomConnectivity(
  endpoint: string,
  now: number,
): Promise<NormalizedIngestItem[]> {
  const payload = await fetchJson<CustomConnectivityResponse>(endpoint, {
    headers:
      process.env.CONNECTIVITY_FEED_TOKEN
        ? { Authorization: `Bearer ${process.env.CONNECTIVITY_FEED_TOKEN}` }
        : undefined,
  });

  const rows = payload.samples ?? [];

  const items: NormalizedIngestItem[] = [];

  for (const row of rows) {
    const availabilityPct = Number(row.availabilityPct ?? NaN);
    const lat = Number(row.lat ?? NaN);
    const lon = Number(row.lon ?? NaN);
    if (!Number.isFinite(availabilityPct) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const region = row.region?.trim() || "Iran";
    const publishedTs =
      typeof row.observedAt === "number" ? row.observedAt : Date.parse(row.observedAt ?? "");
    const ts = Number.isFinite(publishedTs) ? Number(publishedTs) : now;
    const summary = `Observed connectivity availability in ${region}: ${availabilityPct.toFixed(1)}%.`;

    items.push({
      sourceType: "signals",
      sourceName: "ConnectivityFeed",
      url: endpoint,
      publishedTs: ts,
      fetchedTs: now,
      title: `Connectivity in ${region}`,
      summary,
      category: "connectivity",
      lat,
      lon,
      placeName: region,
      country: "Iran",
      keywords: extractKeywords(summary),
      credibilityWeight: 0.72,
      rawJson: {
        ...row,
        provider: "custom_feed",
        availabilityPct,
      },
      isGeoPrecise: true,
      signalType: "connectivity",
      whatWeKnow: [
        `Observed availability: ${availabilityPct.toFixed(1)}%.`,
        "Data came from a configured external connectivity feed.",
      ],
      whatWeDontKnow: [
        "Regional values can hide neighborhood-level disruption.",
        "Methodology varies by provider and collection footprint.",
      ],
    });
  }

  return items.slice(0, 80);
}

async function fetchOoniConnectivitySummary(now: number): Promise<{
  anomalyCount: number;
  availabilityPct: number;
  topTests: string[];
  latestMeasurementTs: number;
}> {
  const url = new URL("https://api.ooni.io/api/v1/measurements");
  url.searchParams.set("probe_cc", "IR");
  url.searchParams.set("anomaly", "true");
  url.searchParams.set("limit", "80");

  const payload = await fetchJson<OoniResponse>(url.toString(), {
    headers: {
      "User-Agent": "conflict-tracker/2.0",
    },
  });

  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const recent = (payload.results ?? []).filter((item) => {
    const ts = Date.parse(item.measurement_start_time ?? "");
    return Number.isFinite(ts) && ts >= sixHoursAgo;
  });

  const testCounts = new Map<string, number>();
  let latestMeasurementTs = 0;

  for (const measurement of recent) {
    const testName = measurement.test_name ?? "unknown_test";
    testCounts.set(testName, (testCounts.get(testName) ?? 0) + 1);

    const parsedTs = Date.parse(measurement.measurement_start_time ?? "");
    if (Number.isFinite(parsedTs) && parsedTs > latestMeasurementTs) {
      latestMeasurementTs = parsedTs;
    }
  }

  const topTests = [...testCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([testName, count]) => `${testName} (${count})`);

  const anomalyCount = recent.length;
  const availabilityPct = Math.max(20, 100 - Math.min(80, anomalyCount * 2.1));

  return {
    anomalyCount,
    availabilityPct,
    topTests,
    latestMeasurementTs: latestMeasurementTs || now,
  };
}

export async function fetchConnectivitySignals(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];

  const customEndpoint = process.env.CONNECTIVITY_FEED_ENDPOINT?.trim();
  if (customEndpoint) {
    try {
      items.push(...(await fetchCustomConnectivity(customEndpoint, now)));
    } catch (error) {
      warnings.push(`Connectivity feed fetch failed: ${(error as Error).message}`);
    }
  }

  if ((process.env.CONNECTIVITY_INCLUDE_OONI ?? "true") === "true") {
    try {
      const ooni = await fetchOoniConnectivitySummary(now);
      const summary =
        ooni.topTests.length > 0
          ? `OONI observed ${ooni.anomalyCount} anomalous Iran connectivity measurements in the last 6h. Top impacted tests: ${ooni.topTests.join(", ")}.`
          : `OONI observed ${ooni.anomalyCount} anomalous Iran connectivity measurements in the last 6h.`;

      items.push({
        sourceType: "signals",
        sourceName: "OONI",
        url: "https://api.ooni.io/",
        publishedTs: ooni.latestMeasurementTs,
        fetchedTs: now,
        title: "Iran national connectivity anomaly monitor",
        summary,
        category: "connectivity",
        lat: IRAN_DEFAULT_CENTER.lat,
        lon: IRAN_DEFAULT_CENTER.lon,
        placeName: "Iran (national)",
        country: "Iran",
        keywords: extractKeywords(summary),
        credibilityWeight: 0.8,
        rawJson: {
          provider: "ooni",
          anomalyCount: ooni.anomalyCount,
          topTests: ooni.topTests,
          availabilityPct: ooni.availabilityPct,
        },
        isGeoPrecise: false,
        signalType: "connectivity",
        whatWeKnow: [
          `Recent anomaly count in last 6h: ${ooni.anomalyCount}.`,
          "Data is sourced from OONI public measurement APIs.",
        ],
        whatWeDontKnow: [
          "Anomalies can indicate interference, routing issues, or partial outages.",
          "Probe coverage and test distribution affect observed intensity.",
        ],
      });
    } catch (error) {
      warnings.push(`OONI connectivity fetch failed: ${(error as Error).message}`);
    }
  }

  if (items.length === 0) {
    warnings.push("No connectivity rows were accepted (all providers unavailable or disabled).");
  }

  return { items, warnings };
}
