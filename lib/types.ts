export type SourceType = "news" | "signals" | "social";
export type ConfidenceLabel = "High" | "Medium" | "Low";

export type EventSource = {
  _id: string;
  sourceType: SourceType;
  sourceName: string;
  url?: string;
  publishedTs: number;
  fetchedTs: number;
  rawJson: Record<string, unknown>;
  credibilityWeight: number;
};

export type DashboardEvent = {
  _id: string;
  eventTs: number;
  title: string;
  summary: string;
  category: string;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  lat: number;
  lon: number;
  placeName: string;
  country: string;
  sourceTypes: SourceType[];
  clusterId: string;
  hasConflict?: boolean;
  whatWeKnow: string[];
  whatWeDontKnow: string[];
  createdAt: number;
  updatedAt: number;
  sources: EventSource[];
};

export type SignalRecord = {
  _id: string;
  type: "connectivity" | "flight" | "firms";
  payload: Record<string, unknown>;
  createdAt: number;
};

export type AlertRule = {
  _id: string;
  name: string;
  kind: "strike_proximity" | "connectivity_drop";
  radiusKm?: number;
  lat?: number;
  lon?: number;
  thresholdPct?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NotificationItem = {
  _id: string;
  alertId: string;
  message: string;
  severity: "low" | "medium" | "high";
  eventId?: string;
  signalId?: string;
  createdAt: number;
  readAt?: number;
};
