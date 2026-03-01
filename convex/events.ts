/* eslint-disable @typescript-eslint/no-explicit-any */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { computeConfidence } from "./lib/confidence";
import { buildClusterId, mergeSourceTypes } from "./lib/clustering";
import {
  alertKindValidator,
  eventCategoryValidator,
  normalizedItemValidator,
  signalTypeValidator,
  sourceTypeValidator,
} from "./types";

function isGeoPrecisePlace(placeName: string): boolean {
  return !placeName.toLowerCase().includes("unspecified");
}

async function recomputeEvent(ctx: any, eventId: any) {
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

  const confidence = computeConfidence({
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
    confidence: confidence.score,
    confidenceLabel: confidence.label,
    updatedAt: Date.now(),
  });
}

export const upsertEvent = mutation({
  args: {
    eventTs: v.number(),
    title: v.string(),
    summary: v.string(),
    category: eventCategoryValidator,
    lat: v.number(),
    lon: v.number(),
    placeName: v.string(),
    country: v.optional(v.string()),
    sourceType: sourceTypeValidator,
    clusterId: v.optional(v.string()),
    whatWeKnow: v.array(v.string()),
    whatWeDontKnow: v.array(v.string()),
  },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    const resolvedClusterId =
      args.clusterId ?? buildClusterId(args.lat, args.lon, args.eventTs);

    const existing = await ctx.db
      .query("events")
      .withIndex("by_clusterId", (q: any) => q.eq("clusterId", resolvedClusterId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        summary: args.summary,
        category: args.category,
        lat: args.lat,
        lon: args.lon,
        placeName: args.placeName,
        country: args.country ?? "Unknown",
        sourceTypes: mergeSourceTypes(existing.sourceTypes, args.sourceType),
        whatWeKnow: args.whatWeKnow,
        whatWeDontKnow: args.whatWeDontKnow,
        updatedAt: Date.now(),
      });

      await recomputeEvent(ctx, existing._id);
      return existing._id;
    }

    const eventId = await ctx.db.insert("events", {
      eventTs: args.eventTs,
      title: args.title,
      summary: args.summary,
      category: args.category,
      confidence: 0,
      confidenceLabel: "Low",
      lat: args.lat,
      lon: args.lon,
      placeName: args.placeName,
      country: args.country ?? "Unknown",
      sourceTypes: [args.sourceType],
      clusterId: resolvedClusterId,
      whatWeKnow: args.whatWeKnow,
      whatWeDontKnow: args.whatWeDontKnow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await recomputeEvent(ctx, eventId);
    return eventId;
  },
});

export const attachSource = mutation({
  args: {
    eventId: v.id("events"),
    sourceType: sourceTypeValidator,
    sourceName: v.string(),
    url: v.optional(v.string()),
    publishedTs: v.number(),
    fetchedTs: v.optional(v.number()),
    rawJson: v.any(),
    credibilityWeight: v.number(),
  },
  returns: v.id("sources"),
  handler: async (ctx, args) => {
    const sourceId = await ctx.db.insert("sources", {
      eventId: args.eventId,
      sourceType: args.sourceType,
      sourceName: args.sourceName,
      url: args.url,
      publishedTs: args.publishedTs,
      fetchedTs: args.fetchedTs ?? Date.now(),
      rawJson: args.rawJson,
      credibilityWeight: args.credibilityWeight,
    });

    const event = await ctx.db.get(args.eventId);
    if (event) {
      await ctx.db.patch(args.eventId, {
        sourceTypes: mergeSourceTypes(event.sourceTypes, args.sourceType),
        updatedAt: Date.now(),
      });
    }

    await recomputeEvent(ctx, args.eventId);

    return sourceId;
  },
});

export const createAlert = mutation({
  args: {
    name: v.string(),
    kind: alertKindValidator,
    radiusKm: v.optional(v.number()),
    lat: v.optional(v.number()),
    lon: v.optional(v.number()),
    thresholdPct: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.id("alerts"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("alerts", {
      name: args.name,
      kind: args.kind,
      radiusKm: args.radiusKm,
      lat: args.lat,
      lon: args.lon,
      thresholdPct: args.thresholdPct,
      enabled: args.enabled ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteAlert = mutation({
  args: {
    alertId: v.id("alerts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.alertId);
    return null;
  },
});

export const markNotificationRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      readAt: Date.now(),
    });
    return null;
  },
});

export const ingestManualBatch = mutation({
  args: {
    sourceName: v.string(),
    items: v.array(normalizedItemValidator),
  },
  returns: v.object({
    accepted: v.number(),
  }),
  handler: async (ctx, args) => {
    let accepted = 0;

    for (const item of args.items) {
      const eventId = await ctx.db.insert("events", {
        eventTs: item.publishedTs,
        title: item.title,
        summary: item.summary,
        category: item.category,
        confidence: item.sourceType === "news" ? 60 : item.sourceType === "signals" ? 40 : 20,
        confidenceLabel: item.sourceType === "news" ? "Medium" : "Low",
        lat: item.lat,
        lon: item.lon,
        placeName: item.placeName,
        country: item.country,
        sourceTypes: [item.sourceType],
        clusterId: buildClusterId(item.lat, item.lon, item.publishedTs),
        whatWeKnow: item.whatWeKnow,
        whatWeDontKnow: item.whatWeDontKnow,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("sources", {
        eventId,
        sourceType: item.sourceType,
        sourceName: item.sourceName,
        url: item.url,
        publishedTs: item.publishedTs,
        fetchedTs: item.fetchedTs,
        rawJson: item.rawJson,
        credibilityWeight: item.credibilityWeight,
      });

      if (item.signalType) {
        await ctx.db.insert("signals", {
          type: item.signalType,
          payload: item.rawJson,
          createdAt: item.publishedTs,
        });
      }

      accepted += 1;
    }

    return { accepted };
  },
});

export const getEvents = query({
  args: {
    timeRangeHours: v.optional(v.number()),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    minConfidence: v.optional(v.number()),
    category: v.optional(eventCategoryValidator),
    types: v.optional(v.array(sourceTypeValidator)),
    q: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const timeRangeHoursRaw = args.timeRangeHours ?? 24;
    const timeRangeHours = Number.isFinite(timeRangeHoursRaw)
      ? Math.max(1, Math.min(24 * 14, Math.round(timeRangeHoursRaw)))
      : 24;
    const since = args.since ?? Date.now() - timeRangeHours * 60 * 60 * 1000;
    const until = args.until ?? Date.now();
    const minConfidence = args.minConfidence ?? 0;
    const queryText = args.q?.trim().toLowerCase();

    let events = await ctx.db
      .query("events")
      .withIndex("by_eventTs", (q: any) => q.gte("eventTs", since).lte("eventTs", until))
      .order("desc")
      .collect();

    if (args.category) {
      events = events.filter((event: any) => event.category === args.category);
    }

    if (args.types && args.types.length > 0) {
      events = events.filter((event: any) =>
        args.types?.some((type: any) => event.sourceTypes.includes(type)),
      );
    }

    events = events.filter((event: any) => event.confidence >= minConfidence);

    if (queryText) {
      events = events.filter((event: any) => {
        const haystack = `${event.title} ${event.summary} ${event.placeName}`.toLowerCase();
        return haystack.includes(queryText);
      });
    }

    const enriched = await Promise.all(
      events.slice(0, 250).map(async (event: any) => {
        const sources = await ctx.db
          .query("sources")
          .withIndex("by_eventId", (q: any) => q.eq("eventId", event._id))
          .order("desc")
          .take(12);

        return {
          ...event,
          sources,
        };
      }),
    );

    return enriched;
  },
});

export const getEventById = query({
  args: {
    id: v.id("events"),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) {
      return null;
    }

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_eventId", (q: any) => q.eq("eventId", args.id))
      .order("desc")
      .collect();

    return {
      ...event,
      sources,
    };
  },
});

export const getSignals = query({
  args: {
    type: v.optional(signalTypeValidator),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const since = Date.now() - 24 * 60 * 60 * 1000;

    if (args.type) {
      return await ctx.db
        .query("signals")
        .withIndex("by_type_and_createdAt", (q: any) =>
          q.eq("type", args.type!).gte("createdAt", since),
        )
        .order("desc")
        .take(400);
    }

    return await ctx.db
      .query("signals")
      .withIndex("by_createdAt", (q: any) => q.gte("createdAt", since))
      .order("desc")
      .take(600);
  },
});

export const getStats = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("events")
      .withIndex("by_eventTs", (q: any) => q.gte("eventTs", last24h))
      .collect();

    const ingestRuns = await ctx.db
      .query("ingestRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(12);

    const byLabel = {
      High: events.filter((event: any) => event.confidenceLabel === "High").length,
      Medium: events.filter((event: any) => event.confidenceLabel === "Medium").length,
      Low: events.filter((event: any) => event.confidenceLabel === "Low").length,
    };

    const bySourceType = {
      news: events.filter((event: any) => event.sourceTypes.includes("news")).length,
      signals: events.filter((event: any) => event.sourceTypes.includes("signals")).length,
      social: events.filter((event: any) => event.sourceTypes.includes("social")).length,
    };

    return {
      totalEvents24h: events.length,
      byLabel,
      bySourceType,
      latestIngestRuns: ingestRuns,
      updatedAt: Date.now(),
    };
  },
});

export const getAlerts = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db.query("alerts").order("desc").take(100);
  },
});

export const getNotifications = query({
  args: {
    unreadOnly: v.optional(v.boolean()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_createdAt")
      .order("desc")
      .take(100);

    if (args.unreadOnly) {
      return notifications.filter((notification: any) => !notification.readAt);
    }

    return notifications;
  },
});
