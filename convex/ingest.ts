/* eslint-disable @typescript-eslint/no-explicit-any */

"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  fetchAviationWeatherSignals,
  fetchConnectivitySignals,
  fetchFirmsHotspots,
  fetchFlightSignals,
  fetchGdeltNews,
  fetchOpenMeteoSignals,
  fetchOpenSenseMapSignals,
  fetchOrbitalSignals,
  fetchPowerSignals,
  fetchSatelliteSignals,
  fetchSeismicSignals,
  fetchSocialReports,
} from "./ingestion/adapters";
import { AdapterContext, IngestionAdapterResult } from "./ingestion/types";

type AdapterRunSummary = {
  sourceName: string;
  itemsIn: number;
  itemsOut: number;
  warnings: string[];
};

async function runAdapter(
  ctx: any,
  sourceName: string,
  loader: (context: AdapterContext) => Promise<IngestionAdapterResult>,
): Promise<AdapterRunSummary> {
  const runId = await ctx.runMutation(internal.ingestionPipeline.startIngestRun, {
    sourceName,
  });

  const now = Date.now();

  try {
    const result = await loader({ now });

    const ingestResult: { itemsIn: number; itemsOut: number } =
      await ctx.runMutation(internal.ingestionPipeline.ingestBatch, {
        sourceName,
        items: result.items,
      });

    await ctx.runMutation(internal.ingestionPipeline.finishIngestRun, {
      runId,
      status: "success",
      itemsIn: ingestResult.itemsIn,
      itemsOut: ingestResult.itemsOut,
      error:
        result.warnings.length > 0
          ? result.warnings.join(" | ")
          : undefined,
    });

    return {
      sourceName,
      ...ingestResult,
      warnings: result.warnings,
    };
  } catch (error) {
    await ctx.runMutation(internal.ingestionPipeline.finishIngestRun, {
      runId,
      status: "failed",
      itemsIn: 0,
      itemsOut: 0,
      error: (error as Error).message,
    });

    return {
      sourceName,
      itemsIn: 0,
      itemsOut: 0,
      warnings: [(error as Error).message],
    };
  }
}

export const ingestGdelt = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "GDELT", fetchGdeltNews);
  },
});

export const ingestFirms = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "NASA FIRMS", fetchFirmsHotspots);
  },
});

export const ingestFlights = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "OpenSky", fetchFlightSignals);
  },
});

export const ingestConnectivity = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "Connectivity", fetchConnectivitySignals);
  },
});

export const ingestSocial = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "Social", fetchSocialReports);
  },
});

export const ingestSatellite = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "NASA EONET", fetchSatelliteSignals);
  },
});

export const ingestSeismic = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "USGS Seismic", fetchSeismicSignals);
  },
});

export const ingestPower = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "Power Signals", fetchPowerSignals);
  },
});

export const ingestOpenMeteo = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "Open-Meteo", fetchOpenMeteoSignals);
  },
});

export const ingestAviationWeather = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "AviationWeather", fetchAviationWeatherSignals);
  },
});

export const ingestOpenSenseMap = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "openSenseMap", fetchOpenSenseMapSignals);
  },
});

export const ingestOrbital = internalAction({
  args: {},
  returns: v.object({
    sourceName: v.string(),
    itemsIn: v.number(),
    itemsOut: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AdapterRunSummary> => {
    return await runAdapter(ctx, "Orbital", fetchOrbitalSignals);
  },
});

export const runAllIngestion = internalAction({
  args: {},
  returns: v.object({
    runs: v.array(
      v.object({
        sourceName: v.string(),
        itemsIn: v.number(),
        itemsOut: v.number(),
        warnings: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx): Promise<{ runs: AdapterRunSummary[] }> => {
    const runs = await Promise.all([
      runAdapter(ctx, "GDELT", fetchGdeltNews),
      runAdapter(ctx, "NASA FIRMS", fetchFirmsHotspots),
      runAdapter(ctx, "NASA EONET", fetchSatelliteSignals),
      runAdapter(ctx, "USGS Seismic", fetchSeismicSignals),
      runAdapter(ctx, "OpenSky", fetchFlightSignals),
      runAdapter(ctx, "AviationWeather", fetchAviationWeatherSignals),
      runAdapter(ctx, "Connectivity", fetchConnectivitySignals),
      runAdapter(ctx, "Open-Meteo", fetchOpenMeteoSignals),
      runAdapter(ctx, "openSenseMap", fetchOpenSenseMapSignals),
      runAdapter(ctx, "Orbital", fetchOrbitalSignals),
      runAdapter(ctx, "Power Signals", fetchPowerSignals),
    ]);

    if ((process.env.ENABLE_SOCIAL_INGESTION ?? "false") === "true") {
      runs.push(await runAdapter(ctx, "Social", fetchSocialReports));
    }

    return { runs };
  },
});
