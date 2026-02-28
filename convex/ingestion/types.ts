import { EventCategory, SignalType, SourceType } from "../types";

export type NormalizedIngestItem = {
  sourceType: SourceType;
  sourceName: string;
  url?: string;
  publishedTs: number;
  fetchedTs: number;
  title: string;
  summary: string;
  category: EventCategory;
  lat: number;
  lon: number;
  placeName: string;
  country: string;
  keywords: string[];
  credibilityWeight: number;
  rawJson: Record<string, unknown>;
  isGeoPrecise: boolean;
  signalType?: SignalType;
  isConflicting?: boolean;
  whatWeKnow: string[];
  whatWeDontKnow: string[];
};

export type IngestionAdapterResult = {
  items: NormalizedIngestItem[];
  warnings: string[];
};

export type AdapterContext = {
  now: number;
};
