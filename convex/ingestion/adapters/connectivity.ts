"use node";

import { extractKeywords } from "../../lib/categorize";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";

interface ConnectivityProvider {
  getSamples(now: number): Promise<Array<{ region: string; availabilityPct: number; lat: number; lon: number }>>;
}

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

    return { items, warnings };
  } catch (error) {
    warnings.push(`Connectivity provider failed: ${(error as Error).message}`);
    return { items: [], warnings };
  }
}
