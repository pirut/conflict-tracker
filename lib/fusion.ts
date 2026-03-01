import { DashboardEvent, EventSource, SignalRecord } from "./types";

export type EvidenceKind =
  | "news"
  | "social"
  | "connectivity"
  | "flight"
  | "firms"
  | "satellite"
  | "power"
  | "seismic"
  | "other_signal";

export type ActivityTier = "confirmed" | "likely" | "watch";

export type AssessedEvent = {
  event: DashboardEvent;
  likelihood: number;
  confirmed: boolean;
  tier: ActivityTier;
  evidence: Record<EvidenceKind, number>;
  corroboration: number;
  reasons: string[];
};

export type MapSignalPoint = {
  id: string;
  type: SignalRecord["type"];
  evidenceKind: EvidenceKind;
  lat: number;
  lon: number;
  label: string;
  placeName: string;
  score: number;
  createdAt: number;
  payload: Record<string, unknown>;
};

export type FusionHotspot = {
  id: string;
  lat: number;
  lon: number;
  eventCount: number;
  signalCount: number;
  likelihood: number;
  confirmed: boolean;
  tier: ActivityTier;
  evidenceKinds: EvidenceKind[];
  topLabel: string;
  summary: string;
};

export type FusionSnapshot = {
  assessedEvents: AssessedEvent[];
  mapSignals: MapSignalPoint[];
  hotspots: FusionHotspot[];
};

const STRONG_SIGNAL_KINDS = new Set<EvidenceKind>([
  "satellite",
  "seismic",
  "power",
  "firms",
  "connectivity",
]);

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function signalKindFromSource(source: EventSource, fallbackCategory: string): EvidenceKind {
  const explicitType = String(source.rawJson?.signalType ?? "").toLowerCase();
  if (explicitType === "connectivity") return "connectivity";
  if (explicitType === "flight") return "flight";
  if (explicitType === "firms") return "firms";
  if (explicitType === "satellite") return "satellite";
  if (explicitType === "power") return "power";
  if (explicitType === "seismic") return "seismic";

  const sourceName = source.sourceName.toLowerCase();
  if (sourceName.includes("ooni") || sourceName.includes("connectivity")) return "connectivity";
  if (sourceName.includes("opensky") || sourceName.includes("adsb") || sourceName.includes("flight")) return "flight";
  if (sourceName.includes("firms")) return "firms";
  if (sourceName.includes("eonet") || sourceName.includes("satellite")) return "satellite";
  if (sourceName.includes("seismic") || sourceName.includes("usgs")) return "seismic";
  if (sourceName.includes("power") || sourceName.includes("grid")) return "power";

  if (fallbackCategory === "connectivity") return "connectivity";
  if (fallbackCategory === "flight") return "flight";
  if (fallbackCategory === "fire") return "firms";
  if (fallbackCategory === "seismic") return "seismic";
  if (fallbackCategory === "power") return "power";
  if (fallbackCategory === "satellite") return "satellite";

  return "other_signal";
}

function emptyEvidenceRecord(): Record<EvidenceKind, number> {
  return {
    news: 0,
    social: 0,
    connectivity: 0,
    flight: 0,
    firms: 0,
    satellite: 0,
    power: 0,
    seismic: 0,
    other_signal: 0,
  };
}

function assessEvent(event: DashboardEvent): AssessedEvent {
  const evidence = emptyEvidenceRecord();
  const newsHosts = new Set<string>();
  const signalKinds = new Set<EvidenceKind>();

  for (const source of event.sources) {
    if (source.sourceType === "news") {
      evidence.news += 1;
      if (source.url) {
        try {
          newsHosts.add(new URL(source.url).hostname.replace(/^www\./, "").toLowerCase());
        } catch {
          // ignore malformed URL
        }
      }
      continue;
    }

    if (source.sourceType === "social") {
      evidence.social += 1;
      continue;
    }

    const kind = signalKindFromSource(source, event.category);
    evidence[kind] += 1;
    signalKinds.add(kind);
  }

  const signalsTotal = signalKinds.size > 0
    ? evidence.connectivity +
      evidence.flight +
      evidence.firms +
      evidence.satellite +
      evidence.power +
      evidence.seismic +
      evidence.other_signal
    : 0;
  const strongSignalTypes = [...signalKinds].filter((kind) => STRONG_SIGNAL_KINDS.has(kind)).length;
  const ageHours = Math.max(0, (Date.now() - event.eventTs) / (60 * 60 * 1000));
  const recency = clamp(16 - ageHours * 1.6, 0, 16);
  const socialOnly = evidence.social > 0 && evidence.news === 0 && signalsTotal === 0;

  let likelihood =
    event.confidence * 0.34 +
    Math.min(26, newsHosts.size * 8) +
    Math.min(24, signalsTotal * 5.5) +
    strongSignalTypes * 5 +
    recency;

  if (evidence.news > 0 && signalsTotal > 0) {
    likelihood += 14;
  }
  if (newsHosts.size >= 3) {
    likelihood += 8;
  }
  if (event.hasConflict) {
    likelihood -= 8;
  }
  if (socialOnly) {
    likelihood -= 32;
  }

  likelihood = clamp(likelihood, 0, 100);

  const corroboration = newsHosts.size + strongSignalTypes + (signalsTotal > 0 ? 1 : 0);
  const highQualityCrossSource = newsHosts.size >= 2 && strongSignalTypes >= 1;
  const sensorStack = strongSignalTypes >= 2 && signalsTotal >= 3;
  const highConfidenceComposite =
    event.confidence >= 88 && event.sources.length >= 4 && (newsHosts.size >= 2 || strongSignalTypes >= 2);
  const confirmed =
    likelihood >= 82 && (highQualityCrossSource || sensorStack || highConfidenceComposite);
  const tier: ActivityTier = confirmed ? "confirmed" : likelihood >= 56 ? "likely" : "watch";

  const reasons: string[] = [];
  if (newsHosts.size > 0) reasons.push(`${newsHosts.size} independent news domains`);
  if (strongSignalTypes > 0) reasons.push(`${strongSignalTypes} strong sensor types`);
  if (signalsTotal > 0) reasons.push(`${signalsTotal} signal rows`);
  if (socialOnly) reasons.push("social-only, no corroboration");
  if (confirmed) reasons.push("meets confirmed corroboration threshold");

  return {
    event,
    likelihood,
    confirmed,
    tier,
    evidence,
    corroboration,
    reasons: reasons.slice(0, 4),
  };
}

function signalKindFromRecord(signal: SignalRecord): EvidenceKind {
  if (signal.type === "connectivity") return "connectivity";
  if (signal.type === "flight") return "flight";
  if (signal.type === "firms") return "firms";
  if (signal.type === "satellite") return "satellite";
  if (signal.type === "power") return "power";
  if (signal.type === "seismic") return "seismic";
  return "other_signal";
}

function signalBaseScore(kind: EvidenceKind, payload: Record<string, unknown>): number {
  if (kind === "seismic") {
    const mag = Number(payload.magnitude ?? payload.mag ?? 0);
    if (Number.isFinite(mag)) {
      return clamp(42 + mag * 9);
    }
    return 70;
  }

  if (kind === "power") {
    const outage = Number(payload.outagePct ?? NaN);
    if (Number.isFinite(outage)) {
      return clamp(45 + outage * 0.9);
    }
    return 66;
  }

  if (kind === "connectivity") {
    const availability = Number(payload.availabilityPct ?? NaN);
    if (Number.isFinite(availability)) {
      return clamp(92 - availability * 0.7);
    }
    return 62;
  }

  if (kind === "firms") {
    const brightness = Number(payload.brightness ?? payload.bright_ti4 ?? NaN);
    if (Number.isFinite(brightness)) {
      return clamp(38 + brightness * 0.2);
    }
    return 64;
  }

  if (kind === "satellite") return 68;
  if (kind === "flight") return 57;
  return 54;
}

function toSignalMapPoint(signal: SignalRecord): MapSignalPoint | null {
  const lat = Number(signal.payload?.lat ?? NaN);
  const lon = Number(signal.payload?.lon ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }

  const evidenceKind = signalKindFromRecord(signal);
  const placeName =
    String(signal.payload?.region ?? signal.payload?.city ?? signal.payload?.placeName ?? "Unknown area");
  const label = String(signal.payload?.title ?? `${signal.type} signal`);
  const score = signalBaseScore(evidenceKind, signal.payload);

  return {
    id: signal._id,
    type: signal.type,
    evidenceKind,
    lat,
    lon,
    label,
    placeName,
    score,
    createdAt: signal.createdAt,
    payload: signal.payload,
  };
}

type WorkingHotspot = {
  id: string;
  lat: number;
  lon: number;
  eventEntries: AssessedEvent[];
  signalEntries: MapSignalPoint[];
  scoreTotal: number;
  scoreWeight: number;
};

function signalWeight(kind: EvidenceKind): number {
  if (kind === "seismic") return 1.55;
  if (kind === "power") return 1.4;
  if (kind === "satellite" || kind === "firms") return 1.3;
  if (kind === "connectivity") return 1.25;
  return 1.1;
}

function eventWeight(item: AssessedEvent): number {
  if (item.confirmed) return 2.1;
  if (item.tier === "likely") return 1.45;
  return 0.9;
}

function buildHotspots(assessedEvents: AssessedEvent[], mapSignals: MapSignalPoint[]): FusionHotspot[] {
  const clusters: WorkingHotspot[] = [];
  const CLUSTER_RADIUS_KM = 55;

  const appendPoint = (
    lat: number,
    lon: number,
    score: number,
    weight: number,
    item: { event?: AssessedEvent; signal?: MapSignalPoint },
  ) => {
    let cluster = clusters.find((candidate) => haversineKm(lat, lon, candidate.lat, candidate.lon) <= CLUSTER_RADIUS_KM);

    if (!cluster) {
      cluster = {
        id: `hotspot_${clusters.length + 1}`,
        lat,
        lon,
        eventEntries: [],
        signalEntries: [],
        scoreTotal: 0,
        scoreWeight: 0,
      };
      clusters.push(cluster);
    }

    const count = cluster.eventEntries.length + cluster.signalEntries.length;
    cluster.lat = (cluster.lat * count + lat) / (count + 1);
    cluster.lon = (cluster.lon * count + lon) / (count + 1);
    cluster.scoreTotal += score * weight;
    cluster.scoreWeight += weight;

    if (item.event) cluster.eventEntries.push(item.event);
    if (item.signal) cluster.signalEntries.push(item.signal);
  };

  for (const item of assessedEvents) {
    appendPoint(item.event.lat, item.event.lon, item.likelihood, eventWeight(item), {
      event: item,
    });
  }

  for (const signal of mapSignals) {
    appendPoint(signal.lat, signal.lon, signal.score, signalWeight(signal.evidenceKind), {
      signal,
    });
  }

  return clusters
    .map((cluster) => {
      const weightedScore =
        cluster.scoreWeight > 0 ? clamp(cluster.scoreTotal / cluster.scoreWeight) : 0;
      const confirmedEvents = cluster.eventEntries.filter((entry) => entry.confirmed).length;
      const strongSignalKinds = new Set(
        cluster.signalEntries
          .map((entry) => entry.evidenceKind)
          .filter((kind) => STRONG_SIGNAL_KINDS.has(kind)),
      ).size;
      const confirmed =
        confirmedEvents > 0 || (weightedScore >= 80 && strongSignalKinds >= 2 && cluster.eventEntries.length > 0);
      const tier: ActivityTier = confirmed ? "confirmed" : weightedScore >= 56 ? "likely" : "watch";

      const evidenceKinds = new Set<EvidenceKind>();
      for (const eventEntry of cluster.eventEntries) {
        for (const kind of Object.keys(eventEntry.evidence) as EvidenceKind[]) {
          if (eventEntry.evidence[kind] > 0) {
            evidenceKinds.add(kind);
          }
        }
      }
      for (const signalEntry of cluster.signalEntries) {
        evidenceKinds.add(signalEntry.evidenceKind);
      }

      const topEvent = [...cluster.eventEntries].sort((a, b) => b.likelihood - a.likelihood)[0];
      const topSignal = [...cluster.signalEntries].sort((a, b) => b.score - a.score)[0];
      const topLabel = topEvent?.event.title ?? topSignal?.label ?? "Hotspot";

      const summary = confirmed
        ? `${cluster.eventEntries.length} events + ${cluster.signalEntries.length} signals with corroborated activity.`
        : `${cluster.eventEntries.length} events + ${cluster.signalEntries.length} signals indicate likely activity.`;

      return {
        id: cluster.id,
        lat: cluster.lat,
        lon: cluster.lon,
        eventCount: cluster.eventEntries.length,
        signalCount: cluster.signalEntries.length,
        likelihood: weightedScore,
        confirmed,
        tier,
        evidenceKinds: [...evidenceKinds].slice(0, 7),
        topLabel,
        summary,
      } satisfies FusionHotspot;
    })
    .sort(
      (a, b) =>
        Number(b.confirmed) - Number(a.confirmed) ||
        b.likelihood - a.likelihood ||
        b.eventCount + b.signalCount - (a.eventCount + a.signalCount),
    )
    .slice(0, 120);
}

export function buildFusionSnapshot(events: DashboardEvent[], signals: SignalRecord[]): FusionSnapshot {
  const assessedEvents = events
    .filter(
      (event) =>
        Number.isFinite(event.lat) &&
        Number.isFinite(event.lon) &&
        Math.abs(event.lat) <= 90 &&
        Math.abs(event.lon) <= 180,
    )
    .map((event) => assessEvent(event))
    .sort(
      (a, b) =>
        Number(b.confirmed) - Number(a.confirmed) ||
        b.likelihood - a.likelihood ||
        b.event.eventTs - a.event.eventTs,
    );

  const mapSignals = signals
    .map((signal) => toSignalMapPoint(signal))
    .filter((item): item is MapSignalPoint => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  const hotspots = buildHotspots(assessedEvents, mapSignals);

  return {
    assessedEvents,
    mapSignals,
    hotspots,
  };
}
