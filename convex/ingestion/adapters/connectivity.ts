"use node";

import { IRAN_DEFAULT_CENTER } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { fetchJson } from "./shared";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";

interface ConnectivityProvider {
  getSamples(now: number): Promise<Array<{ region: string; availabilityPct: number; lat: number; lon: number }>>;
}

type OoniMeasurement = {
  measurement_start_time?: string;
  test_name?: string;
  scores?: {
    blocking_general?: number;
  };
};

type OoniResponse = {
  results?: OoniMeasurement[];
};

class MockConnectivityProvider implements ConnectivityProvider {
  async getSamples(now: number) {
    const minuteBucket = Math.floor(now / (5 * 60 * 1000));
    const wave = Math.sin(minuteBucket / 5);

    return [
      { region: "Tehran", availabilityPct: Math.max(52, 91 + wave * 6), lat: 35.6892, lon: 51.389 },
      { region: "Isfahan", availabilityPct: Math.max(50, 88 + wave * 7), lat: 32.6546, lon: 51.668 },
      { region: "Shiraz", availabilityPct: Math.max(50, 90 + wave * 5), lat: 29.5918, lon: 52.5837 },
      { region: "Mashhad", availabilityPct: Math.max(48, 86 + wave * 8), lat: 36.2605, lon: 59.6168 },
      { region: "Tabriz", availabilityPct: Math.max(46, 85 + wave * 9), lat: 38.0962, lon: 46.2738 },
    ];
  }
}

function resolveProvider(): ConnectivityProvider {
  const provider = process.env.CONNECTIVITY_PROVIDER ?? "mock";

  switch (provider) {
    case "mock":
    default:
      return new MockConnectivityProvider();
  }
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
  url.searchParams.set("limit", "30");

  const payload = await fetchJson<OoniResponse>(url.toString(), {
    headers: {
      "User-Agent": "conflict-tracker/1.0",
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
  const availabilityPct = Math.max(30, 100 - Math.min(70, anomalyCount * 1.8));

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
  const provider = resolveProvider();
  const warnings: string[] = [];

  try {
    const samples = await provider.getSamples(now);

    const items: NormalizedIngestItem[] = samples.map((sample) => {
      const summary = `Estimated connectivity availability in ${sample.region}: ${sample.availabilityPct.toFixed(1)}%.`;
      const dropDetected = sample.availabilityPct < 80;

      return {
        sourceType: "signals",
        sourceName: "ConnectivityMock",
        url: undefined,
        publishedTs: now,
        fetchedTs: now,
        title: `Connectivity in ${sample.region}`,
        summary,
        category: "connectivity",
        lat: sample.lat,
        lon: sample.lon,
        placeName: sample.region,
        country: "Iran",
        keywords: extractKeywords(summary),
        credibilityWeight: 0.52,
        rawJson: {
          ...sample,
          provider: process.env.CONNECTIVITY_PROVIDER ?? "mock",
          dropDetected,
        },
        isGeoPrecise: true,
        signalType: "connectivity",
        whatWeKnow: [
          `Sampled availability estimate: ${sample.availabilityPct.toFixed(1)}%.`,
          "Signal is from a pluggable connectivity adapter.",
        ],
        whatWeDontKnow: [
          "Mock provider values are synthetic unless replaced by a real API adapter.",
          "Regional estimates can mask neighborhood-level disruptions.",
        ],
      };
    });

    if ((process.env.CONNECTIVITY_INCLUDE_OONI ?? "true") === "true") {
      try {
        const ooni = await fetchOoniConnectivitySummary(now);
        const summary =
          ooni.topTests.length > 0
            ? `OONI observed ${ooni.anomalyCount} anomalous connectivity measurements in Iran over the last 6h. Top impacted tests: ${ooni.topTests.join(", ")}.`
            : `OONI observed ${ooni.anomalyCount} anomalous connectivity measurements in Iran over the last 6h.`;

        items.push({
          sourceType: "signals",
          sourceName: "OONI",
          url: "https://api.ooni.io/",
          publishedTs: ooni.latestMeasurementTs,
          fetchedTs: now,
          title: "National connectivity anomaly monitor",
          summary,
          category: "connectivity",
          lat: IRAN_DEFAULT_CENTER.lat,
          lon: IRAN_DEFAULT_CENTER.lon,
          placeName: "Iran (national)",
          country: "Iran",
          keywords: extractKeywords(summary),
          credibilityWeight: 0.74,
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
            "Anomalies indicate potential network interference but not always complete outages.",
            "Probe distribution and test coverage can affect measured intensity.",
          ],
        });
      } catch (error) {
        warnings.push(`OONI connectivity fetch failed: ${(error as Error).message}`);
      }
    }

    return { items, warnings };
  } catch (error) {
    warnings.push(`Connectivity provider failed: ${(error as Error).message}`);
    return { items: [], warnings };
  }
}
