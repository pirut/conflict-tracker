import { v } from "convex/values";
import {
  ALERT_KINDS,
  ALERT_SEVERITIES,
  CONFIDENCE_LABELS,
  EVENT_CATEGORIES,
  INGEST_STATUS,
  SIGNAL_TYPES,
  SOURCE_TYPES,
} from "./constants";

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type IngestStatus = (typeof INGEST_STATUS)[number];
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const eventCategoryValidator = v.union(
  v.literal("strike"),
  v.literal("explosion"),
  v.literal("air_defense"),
  v.literal("missile"),
  v.literal("drone"),
  v.literal("refinery"),
  v.literal("nuclear"),
  v.literal("military_base"),
  v.literal("connectivity"),
  v.literal("flight"),
  v.literal("fire"),
  v.literal("power"),
  v.literal("seismic"),
  v.literal("satellite"),
  v.literal("other"),
);

export const sourceTypeValidator = v.union(
  v.literal("news"),
  v.literal("signals"),
  v.literal("social"),
);

export const confidenceLabelValidator = v.union(
  v.literal("High"),
  v.literal("Medium"),
  v.literal("Low"),
);

export const signalTypeValidator = v.union(
  v.literal("connectivity"),
  v.literal("flight"),
  v.literal("firms"),
  v.literal("satellite"),
  v.literal("power"),
  v.literal("seismic"),
);

export const ingestStatusValidator = v.union(
  v.literal("running"),
  v.literal("success"),
  v.literal("failed"),
);

export const alertKindValidator = v.union(
  v.literal("strike_proximity"),
  v.literal("connectivity_drop"),
);

export const alertSeverityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export const normalizedItemValidator = v.object({
  sourceType: sourceTypeValidator,
  sourceName: v.string(),
  url: v.optional(v.string()),
  publishedTs: v.number(),
  fetchedTs: v.number(),
  title: v.string(),
  summary: v.string(),
  category: eventCategoryValidator,
  lat: v.number(),
  lon: v.number(),
  placeName: v.string(),
  country: v.string(),
  keywords: v.array(v.string()),
  credibilityWeight: v.number(),
  rawJson: v.any(),
  isGeoPrecise: v.boolean(),
  signalType: v.optional(signalTypeValidator),
  isConflicting: v.optional(v.boolean()),
  whatWeKnow: v.array(v.string()),
  whatWeDontKnow: v.array(v.string()),
});
