/* eslint-disable @typescript-eslint/no-explicit-any */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { computeConfidence } from "./lib/confidence";
import {
  buildClusterId,
  findBestCluster,
  mergeInsights,
  mergeSourceTypes,
} from "./lib/clustering";
import { haversineKm } from "./lib/geo";
import {
  alertSeverityValidator,
  normalizedItemValidator,
  signalTypeValidator,
  sourceTypeValidator,
} from "./types";

const STRIKE_CATEGORIES = new Set([
  "strike",
  "missile",
  "drone",
  "explosion",
  "air_defense",
  "military_base",
]);

function isGeoPrecisePlace(placeName: string): boolean {
  return !placeName.toLowerCase().includes("unspecified");
}

async function recomputeEventConfidence(ctx: any, eventId: any) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    return;
  }

  const sources = await ctx.db
    .query("sources")
    .withIndex("by_eventId", (q: any) => q.eq("eventId", eventId))
    .collect();

  const sourceTypes = Array.from(
    new Set(sources.map((source: any) => source.sourceType)),
  ) as ("news" | "signals" | "social")[];

  const score = computeConfidence({
    sourceTypes,
    sources: sources.map((source: any) => ({
      sourceType: source.sourceType,
      sourceName: source.sourceName,
    })),
    hasSignals: sourceTypes.includes("signals"),
    isGeoPrecise: isGeoPrecisePlace(event.placeName),
    hasConflict: Boolean(event.hasConflict),
    eventTs: event.eventTs,
  });

  await ctx.db.patch(eventId, {
    sourceTypes,
    confidence: score.score,
    confidenceLabel: score.label,
    updatedAt: Date.now(),
  });
}

async function getLatestFlightBaseline(ctx: any, city: string, beforeTs: number) {
  const recent = await ctx.db
    .query("signals")
    .withIndex("by_type_and_createdAt", (q: any) =>
      q.eq("type", "flight").lt("createdAt", beforeTs),
    )
    .order("desc")
    .take(25);

  return recent.find((signal: any) => signal.payload?.city === city) ?? null;
}

function severityForConfidence(confidence: number): "low" | "medium" | "high" {
  if (confidence >= 85) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

async function insertNotificationIfNeeded(
  ctx: any,
  args: {
    alertId: any;
    message: string;
    severity: "low" | "medium" | "high";
    eventId?: any;
    signalId?: any;
  },
) {
  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_alertId", (q: any) => q.eq("alertId", args.alertId))
    .order("desc")
    .take(5);

  const duplicate = recent.some(
    (item: any) => item.message === args.message && Date.now() - item.createdAt < 30 * 60 * 1000,
  );

  if (duplicate) {
    return;
  }

  await ctx.db.insert("notifications", {
    alertId: args.alertId,
    message: args.message,
    severity: args.severity,
    eventId: args.eventId,
    signalId: args.signalId,
    createdAt: Date.now(),
  });
}

async function evaluateEventAlerts(ctx: any, eventId: any) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    return;
  }

  const alerts = await ctx.db
    .query("alerts")
    .withIndex("by_enabled", (q: any) => q.eq("enabled", true))
    .collect();

  for (const alert of alerts) {
    if (alert.kind !== "strike_proximity") {
      continue;
    }

    if (!STRIKE_CATEGORIES.has(event.category)) {
      continue;
    }

    if (event.confidence < 75) {
      continue;
    }

    if (typeof alert.lat !== "number" || typeof alert.lon !== "number") {
      continue;
    }

    const radiusKm = alert.radiusKm ?? 150;
    const distance = haversineKm(event.lat, event.lon, alert.lat, alert.lon);
    if (distance > radiusKm) {
      continue;
    }

    await insertNotificationIfNeeded(ctx, {
      alertId: alert._id,
      message: `High-confidence ${event.category.replace("_", " ")} event near ${event.placeName} (${Math.round(distance)} km from alert center).`,
      severity: severityForConfidence(event.confidence),
      eventId,
    });
  }
}

async function evaluateSignalAlerts(ctx: any, signalId: any) {
  const signal = await ctx.db.get(signalId);
  if (!signal || signal.type !== "connectivity") {
    return;
  }

  const availability = Number(signal.payload?.availabilityPct);
  if (!Number.isFinite(availability)) {
    return;
  }

  const dropPct = 100 - availability;
  const alerts = await ctx.db
    .query("alerts")
    .withIndex("by_enabled", (q: any) => q.eq("enabled", true))
    .collect();

  for (const alert of alerts) {
    if (alert.kind !== "connectivity_drop") {
      continue;
    }

    const threshold = alert.thresholdPct ?? 20;
    if (dropPct < threshold) {
      continue;
    }

    await insertNotificationIfNeeded(ctx, {
      alertId: alert._id,
      message: `Connectivity drop alert in ${signal.payload?.region ?? "Iran"}: ${dropPct.toFixed(1)}% below full availability.`,
      severity: dropPct >= 40 ? "high" : "medium",
      signalId,
    });
  }
}

async function processSingleItem(ctx: any, item: any) {
  const eventTs = item.publishedTs;

  const existingPublished = await ctx.db
    .query("sources")
    .withIndex("by_publishedTs", (q: any) => q.eq("publishedTs", item.publishedTs))
    .collect();

  const duplicateAlreadyStored = existingPublished.some(
    (source: any) =>
      source.sourceType === item.sourceType &&
      source.sourceName === item.sourceName &&
      (source.url ?? "") === (item.url ?? ""),
  );

  if (duplicateAlreadyStored) {
    return {
      eventId: undefined,
      signalId: undefined,
    };
  }

  const candidates = await ctx.db
    .query("events")
    .withIndex("by_eventTs", (q: any) =>
      q.gte("eventTs", eventTs - 45 * 60 * 1000).lte("eventTs", eventTs + 45 * 60 * 1000),
    )
    .collect();

  const cluster = findBestCluster(
    {
      eventTs,
      lat: item.lat,
      lon: item.lon,
      summary: item.summary,
      category: item.category,
    },
    candidates.map((event: any) => ({
      _id: event._id,
      eventTs: event.eventTs,
      lat: event.lat,
      lon: event.lon,
      summary: event.summary,
      category: event.category,
    })),
  );

  let workingItem = item;
  let signalId: any;

  if (item.signalType === "flight") {
    const city = String(item.rawJson?.city ?? item.placeName);
    const count = Number(item.rawJson?.count ?? 0);
    const baseline = await getLatestFlightBaseline(ctx, city, eventTs);
    const baselineCount = Number(baseline?.payload?.count ?? 0);

    if (baselineCount > 0) {
      const dropPct = ((baselineCount - count) / baselineCount) * 100;
      if (dropPct >= 35) {
        workingItem = {
          ...item,
          title: `Flight anomaly near ${city}`,
          summary: `Flight count around ${city} dropped ${dropPct.toFixed(1)}% compared with recent baseline (${baselineCount} -> ${count}).`,
          rawJson: {
            ...item.rawJson,
            baselineCount,
            dropPct,
            anomaly: true,
          },
          whatWeKnow: [
            `Observed count dropped from ${baselineCount} to ${count}.`,
            "Anomaly threshold for sudden drop was exceeded.",
          ],
          whatWeDontKnow: [
            "Short-term drops can also come from coverage or transponder effects.",
            "Further snapshots are needed to confirm sustained disruption.",
          ],
        };
      }
    }
  }

  if (workingItem.signalType) {
    signalId = await ctx.db.insert("signals", {
      type: workingItem.signalType,
      payload: {
        ...workingItem.rawJson,
        signalType: workingItem.signalType,
        region: workingItem.placeName,
        lat: workingItem.lat,
        lon: workingItem.lon,
        sourceName: workingItem.sourceName,
        title: workingItem.title,
        summary: workingItem.summary,
        availabilityPct: workingItem.rawJson?.availabilityPct,
        count: workingItem.rawJson?.count,
      },
      createdAt: workingItem.publishedTs,
    });

    await evaluateSignalAlerts(ctx, signalId);
  }

  let eventId = cluster?.eventId;

  if (eventId) {
    const existing = await ctx.db.get(eventId);
    if (!existing) {
      eventId = undefined;
    } else {
      await ctx.db.patch(eventId, {
        title: existing.confidence >= 70 ? existing.title : workingItem.title,
        summary:
          workingItem.credibilityWeight > 0.8 && workingItem.summary.length > existing.summary.length
            ? workingItem.summary
            : existing.summary,
        category: existing.category === "other" ? workingItem.category : existing.category,
        lat: !isGeoPrecisePlace(existing.placeName) ? workingItem.lat : existing.lat,
        lon: !isGeoPrecisePlace(existing.placeName) ? workingItem.lon : existing.lon,
        placeName:
          !isGeoPrecisePlace(existing.placeName) ? workingItem.placeName : existing.placeName,
        sourceTypes: mergeSourceTypes(existing.sourceTypes, workingItem.sourceType),
        hasConflict: Boolean(existing.hasConflict || cluster?.hasConflict || workingItem.isConflicting),
        whatWeKnow: mergeInsights(existing.whatWeKnow, workingItem.whatWeKnow),
        whatWeDontKnow: mergeInsights(existing.whatWeDontKnow, workingItem.whatWeDontKnow),
        updatedAt: Date.now(),
      });
    }
  }

  if (!eventId) {
    eventId = await ctx.db.insert("events", {
      eventTs,
      title: workingItem.title,
      summary: workingItem.summary,
      category: workingItem.category,
      confidence: 0,
      confidenceLabel: "Low",
      lat: workingItem.lat,
      lon: workingItem.lon,
      placeName: workingItem.placeName,
      country: workingItem.country || "Unknown",
      sourceTypes: [workingItem.sourceType],
      clusterId: buildClusterId(workingItem.lat, workingItem.lon, eventTs),
      hasConflict: Boolean(workingItem.isConflicting),
      whatWeKnow: workingItem.whatWeKnow,
      whatWeDontKnow: workingItem.whatWeDontKnow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  await ctx.db.insert("sources", {
    eventId,
    sourceType: workingItem.sourceType,
    sourceName: workingItem.sourceName,
    url: workingItem.url,
    publishedTs: workingItem.publishedTs,
    fetchedTs: workingItem.fetchedTs,
    rawJson: workingItem.rawJson,
    credibilityWeight: workingItem.credibilityWeight,
  });

  await recomputeEventConfidence(ctx, eventId);
  await evaluateEventAlerts(ctx, eventId);

  return {
    eventId,
    signalId,
  };
}

export const startIngestRun = internalMutation({
  args: {
    sourceName: v.string(),
  },
  returns: v.id("ingestRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ingestRuns", {
      sourceName: args.sourceName,
      startedAt: Date.now(),
      status: "running",
      itemsIn: 0,
      itemsOut: 0,
    });
  },
});

export const finishIngestRun = internalMutation({
  args: {
    runId: v.id("ingestRuns"),
    status: v.union(v.literal("success"), v.literal("failed")),
    itemsIn: v.number(),
    itemsOut: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      endedAt: Date.now(),
      status: args.status,
      itemsIn: args.itemsIn,
      itemsOut: args.itemsOut,
      error: args.error,
    });

    return null;
  },
});

export const ingestBatch = internalMutation({
  args: {
    sourceName: v.string(),
    items: v.array(normalizedItemValidator),
  },
  returns: v.object({
    itemsIn: v.number(),
    itemsOut: v.number(),
  }),
  handler: async (ctx, args) => {
    let itemsOut = 0;

    const seenSourceKeys = new Set<string>();

    for (const item of args.items) {
      // De-dupe identical payloads without collapsing distinct same-source city/point updates.
      const sourceKey = [
        item.sourceName,
        item.sourceType,
        item.url ?? "no-url",
        item.title,
        item.placeName,
        item.lat.toFixed(4),
        item.lon.toFixed(4),
        item.publishedTs,
      ].join(":");
      if (seenSourceKeys.has(sourceKey)) {
        continue;
      }
      seenSourceKeys.add(sourceKey);

      await processSingleItem(ctx, item);
      itemsOut += 1;
    }

    return {
      itemsIn: args.items.length,
      itemsOut,
    };
  },
});

export const createSignal = internalMutation({
  args: {
    type: signalTypeValidator,
    payload: v.any(),
    createdAt: v.number(),
  },
  returns: v.id("signals"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("signals", {
      type: args.type,
      payload: args.payload,
      createdAt: args.createdAt,
    });
  },
});

export const createNotification = internalMutation({
  args: {
    alertId: v.id("alerts"),
    message: v.string(),
    severity: alertSeverityValidator,
    eventId: v.optional(v.id("events")),
    signalId: v.optional(v.id("signals")),
  },
  returns: v.id("notifications"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const upsertSourceTypeOnEvent = internalMutation({
  args: {
    eventId: v.id("events"),
    sourceType: sourceTypeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      return null;
    }

    await ctx.db.patch(args.eventId, {
      sourceTypes: mergeSourceTypes(event.sourceTypes, args.sourceType),
      updatedAt: Date.now(),
    });

    await recomputeEventConfidence(ctx, args.eventId);

    return null;
  },
});
