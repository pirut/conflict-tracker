import { EventCategory, SourceType } from "../types";
import { haversineKm } from "./geo";
import { jaccardSimilarity, looksContradictory } from "./text";

const CLUSTER_WINDOW_MS = 45 * 60 * 1000;
const CLUSTER_RADIUS_KM = 30;

export type ExistingEvent = {
  _id: string;
  eventTs: number;
  lat: number;
  lon: number;
  summary: string;
  category: EventCategory;
};

export type CandidateItem = {
  eventTs: number;
  lat: number;
  lon: number;
  summary: string;
  category: EventCategory;
};

export function findBestCluster(
  item: CandidateItem,
  events: ExistingEvent[],
): { eventId: string; hasConflict: boolean } | null {
  let bestMatch: { eventId: string; score: number; hasConflict: boolean } | null =
    null;

  for (const event of events) {
    const dt = Math.abs(item.eventTs - event.eventTs);
    if (dt > CLUSTER_WINDOW_MS) {
      continue;
    }

    const km = haversineKm(item.lat, item.lon, event.lat, event.lon);
    if (km > CLUSTER_RADIUS_KM) {
      continue;
    }

    const similarity = jaccardSimilarity(item.summary, event.summary);
    const categoryBoost = item.category === event.category ? 0.15 : 0;
    const score = similarity + categoryBoost - km / 300;

    if (score < 0.2) {
      continue;
    }

    const contradiction = looksContradictory(item.summary) || looksContradictory(event.summary);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        eventId: event._id,
        score,
        hasConflict: contradiction,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return { eventId: bestMatch.eventId, hasConflict: bestMatch.hasConflict };
}

export function buildClusterId(lat: number, lon: number, eventTs: number): string {
  const bucketTs = Math.floor(eventTs / (30 * 60 * 1000));
  const latBucket = Math.round(lat * 10);
  const lonBucket = Math.round(lon * 10);
  return `cluster_${bucketTs}_${latBucket}_${lonBucket}`;
}

export function mergeSourceTypes(
  existingTypes: SourceType[],
  incomingType: SourceType,
): SourceType[] {
  if (existingTypes.includes(incomingType)) {
    return existingTypes;
  }

  return [...existingTypes, incomingType];
}

export function mergeInsights(
  existing: string[],
  incoming: string[],
  limit = 5,
): string[] {
  const merged = [...existing];
  for (const item of incoming) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}
