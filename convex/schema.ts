import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  alertKindValidator,
  alertSeverityValidator,
  confidenceLabelValidator,
  eventCategoryValidator,
  ingestStatusValidator,
  signalTypeValidator,
  sourceTypeValidator,
} from "./types";

export default defineSchema({
  events: defineTable({
    eventTs: v.number(),
    title: v.string(),
    summary: v.string(),
    category: eventCategoryValidator,
    confidence: v.number(),
    confidenceLabel: confidenceLabelValidator,
    lat: v.number(),
    lon: v.number(),
    placeName: v.string(),
    country: v.string(),
    sourceTypes: v.array(sourceTypeValidator),
    clusterId: v.string(),
    hasConflict: v.optional(v.boolean()),
    whatWeKnow: v.array(v.string()),
    whatWeDontKnow: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventTs", ["eventTs"])
    .index("by_clusterId", ["clusterId"])
    .index("by_confidence", ["confidence"])
    .index("by_category", ["category"])
    .index("by_updatedAt", ["updatedAt"])
    .searchIndex("search_summary", {
      searchField: "summary",
      filterFields: ["category", "country"],
    }),

  sources: defineTable({
    eventId: v.id("events"),
    sourceType: sourceTypeValidator,
    sourceName: v.string(),
    url: v.optional(v.string()),
    publishedTs: v.number(),
    fetchedTs: v.number(),
    rawJson: v.any(),
    credibilityWeight: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_sourceType", ["sourceType"])
    .index("by_publishedTs", ["publishedTs"]),

  signals: defineTable({
    type: signalTypeValidator,
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_createdAt", ["createdAt"])
    .index("by_type_and_createdAt", ["type", "createdAt"]),

  ingestRuns: defineTable({
    sourceName: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    status: ingestStatusValidator,
    itemsIn: v.number(),
    itemsOut: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_sourceName", ["sourceName"])
    .index("by_startedAt", ["startedAt"])
    .index("by_sourceName_and_startedAt", ["sourceName", "startedAt"]),

  alerts: defineTable({
    name: v.string(),
    kind: alertKindValidator,
    radiusKm: v.optional(v.number()),
    lat: v.optional(v.number()),
    lon: v.optional(v.number()),
    thresholdPct: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_enabled", ["enabled"])
    .index("by_kind", ["kind"]),

  notifications: defineTable({
    alertId: v.id("alerts"),
    message: v.string(),
    severity: alertSeverityValidator,
    eventId: v.optional(v.id("events")),
    signalId: v.optional(v.id("signals")),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_alertId", ["alertId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_readAt", ["readAt"]),
});
