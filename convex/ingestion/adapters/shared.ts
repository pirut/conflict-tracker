import {
  CATEGORY_KEYWORDS,
  CONFLICT_RELEVANCE_TERMS,
  IRAN_RELEVANCE_TERMS,
  NOISE_TERMS,
  STRIKE_FOCUS_TERMS,
  TRUSTED_NEWS_DOMAINS,
  US_RELEVANCE_TERMS,
} from "../../constants";
import { resolvePlaceFromText } from "../../lib/geo";

const MAX_NEWS_AGE_HOURS_RAW = Number(process.env.MAX_NEWS_AGE_HOURS ?? 72);
const MAX_NEWS_AGE_HOURS = Number.isFinite(MAX_NEWS_AGE_HOURS_RAW)
  ? Math.max(6, Math.min(7 * 24, Math.round(MAX_NEWS_AGE_HOURS_RAW)))
  : 72;

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(
  url: string,
  init?: RequestInit,
  timeoutMs = 20000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

type NominatimReverseResponse = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

const reverseNominatimCache = new Map<string, { placeName: string; country: string }>();

export async function reverseGeocodeNominatim(
  lat: number,
  lon: number,
): Promise<{ placeName: string; country: string } | null> {
  if ((process.env.NOMINATIM_REVERSE_ENABLED ?? "true") !== "true") {
    return null;
  }

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = reverseNominatimCache.get(key);
  if (cached) {
    return cached;
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("accept-language", "en");

  try {
    const payload = await fetchJson<NominatimReverseResponse>(url.toString(), {
      headers: {
        "User-Agent": "conflict-tracker/3.0 (+https://localhost)",
      },
    });
    const placeName =
      payload.address?.city ??
      payload.address?.town ??
      payload.address?.village ??
      payload.address?.county ??
      payload.address?.state ??
      payload.display_name?.split(",")[0]?.trim() ??
      "Unknown area";
    const country = payload.address?.country ?? "Unknown";
    const normalized = { placeName, country };
    reverseNominatimCache.set(key, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export function parseTimestamp(input: string | number | undefined, fallback: number): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : fallback;
  }

  if (!input) {
    return fallback;
  }

  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countMatches(text: string, terms: readonly string[]): string[] {
  const lowered = text.toLowerCase();
  return terms.filter((term) => lowered.includes(term));
}

export function hostnameFromUrl(url?: string): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedNewsUrl(url?: string): boolean {
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return false;
  }

  return TRUSTED_NEWS_DOMAINS.some((trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`));
}

export function isFreshNewsTimestamp(ts: number, now: number): boolean {
  if (!Number.isFinite(ts)) {
    return false;
  }

  const ageMs = now - ts;
  if (ageMs < -10 * 60 * 1000) {
    return false;
  }

  return ageMs <= MAX_NEWS_AGE_HOURS * 60 * 60 * 1000;
}

export function extractCredibilityWeight(url?: string): number {
  if (!url) {
    return 0.52;
  }

  if (isTrustedNewsUrl(url)) {
    return 0.92;
  }

  return 0.45;
}

export function derivePlace(text: string): {
  placeName: string;
  lat: number;
  lon: number;
  country: string;
  isGeoPrecise: boolean;
} {
  return resolvePlaceFromText(text);
}

export function detectCategoryFromText(text: string): string {
  const lowered = text.toLowerCase();
  for (const [category, terms] of Object.entries(CATEGORY_KEYWORDS)) {
    if (terms.some((term) => lowered.includes(term))) {
      return category;
    }
  }
  return "other";
}

export function computeNewsRelevanceScore(text: string): number {
  const normalized = normalizeText(text).toLowerCase();
  const iranMatches = countMatches(normalized, IRAN_RELEVANCE_TERMS);
  const conflictMatches = countMatches(normalized, CONFLICT_RELEVANCE_TERMS);
  const strikeMatches = countMatches(normalized, STRIKE_FOCUS_TERMS);
  const usMatches = countMatches(normalized, US_RELEVANCE_TERMS);
  const noiseMatches = countMatches(normalized, NOISE_TERMS);

  let score = 0;
  score += iranMatches.length * 20;
  score += conflictMatches.length * 15;
  score += strikeMatches.length * 16;
  score += usMatches.length * 12;
  score -= noiseMatches.length * 20;

  if (iranMatches.length > 0 && conflictMatches.length > 0) {
    score += 18;
  }
  if (usMatches.length > 0 && iranMatches.length > 0) {
    score += 12;
  }
  if (strikeMatches.length >= 2) {
    score += 10;
  }

  if (iranMatches.length === 0) {
    score -= 38;
  }
  if (conflictMatches.length === 0 && strikeMatches.length === 0) {
    score -= 26;
  }

  return Math.max(0, Math.min(100, score));
}

export function computeUSIranWarScore(text: string): number {
  const normalized = normalizeText(text).toLowerCase();
  const usMatches = countMatches(normalized, US_RELEVANCE_TERMS);
  const iranMatches = countMatches(normalized, IRAN_RELEVANCE_TERMS);
  const strikeMatches = countMatches(normalized, STRIKE_FOCUS_TERMS);

  let score = 0;
  score += usMatches.length * 24;
  score += iranMatches.length * 20;
  score += strikeMatches.length * 18;

  if (usMatches.length > 0 && iranMatches.length > 0) {
    score += 14;
  }
  if (usMatches.length > 0 && strikeMatches.length > 0) {
    score += 10;
  }
  if (iranMatches.length > 0 && strikeMatches.length > 0) {
    score += 10;
  }

  if (usMatches.length === 0) {
    score -= 20;
  }
  if (iranMatches.length === 0) {
    score -= 28;
  }
  if (strikeMatches.length === 0) {
    score -= 16;
  }

  return Math.max(0, Math.min(100, score));
}

export function isRelevantIranConflictNews(
  title: string,
  summary?: string,
): boolean {
  const merged = normalizeText(`${title} ${summary ?? ""}`);
  if (merged.length < 24) {
    return false;
  }

  const lowered = merged.toLowerCase();
  const hasIranTerm = countMatches(lowered, IRAN_RELEVANCE_TERMS).length > 0;
  const hasConflictTerm =
    countMatches(lowered, CONFLICT_RELEVANCE_TERMS).length > 0 ||
    countMatches(lowered, STRIKE_FOCUS_TERMS).length > 0;
  const hasUsTerm = countMatches(lowered, US_RELEVANCE_TERMS).length > 0;

  if (!hasIranTerm || !hasConflictTerm) {
    return false;
  }

  const relevance = computeNewsRelevanceScore(merged);
  const usIranWarScore = computeUSIranWarScore(merged);

  if (hasUsTerm) {
    return relevance >= 50 && usIranWarScore >= 40;
  }

  return relevance >= 72;
}

function extractActors(text: string): string[] {
  const actorTerms = [
    "iran",
    "israel",
    "united states",
    "u.s.",
    "american",
    "pentagon",
    "centcom",
    "irgc",
    "iaea",
    "idf",
    "hezbollah",
    "hamas",
    "russia",
    "china",
    "un",
  ];
  return countMatches(text.toLowerCase(), actorTerms).slice(0, 4);
}

function extractImpacts(text: string): string[] {
  const impacts: string[] = [];
  const lowered = text.toLowerCase();

  const casualtyMatch = lowered.match(
    /(\d{1,4})\s+(killed|dead|injured|wounded|casualties)/,
  );
  if (casualtyMatch) {
    impacts.push(`${casualtyMatch[1]} ${casualtyMatch[2]} reported`);
  }

  if (lowered.includes("airspace")) impacts.push("airspace impact");
  if (lowered.includes("refinery")) impacts.push("energy infrastructure impact");
  if (lowered.includes("nuclear")) impacts.push("nuclear-site relevance");
  if (lowered.includes("internet") || lowered.includes("connectivity")) {
    impacts.push("connectivity impact");
  }

  return impacts.slice(0, 3);
}

export function buildNewsIntelligence(input: {
  title: string;
  summary: string;
  sourceName: string;
  url?: string;
  baseConfidenceHint?: string;
}): {
  relevanceScore: number;
  usIranWarScore: number;
  isUSLinked: boolean;
  whatWeKnow: string[];
  whatWeDontKnow: string[];
} {
  const merged = normalizeText(`${input.title} ${input.summary}`);
  const relevanceScore = computeNewsRelevanceScore(merged);
  const usIranWarScore = computeUSIranWarScore(merged);
  const usTerms = countMatches(merged.toLowerCase(), US_RELEVANCE_TERMS);
  const isUSLinked = usTerms.length > 0;
  const actors = extractActors(merged);
  const impacts = extractImpacts(merged);

  const whatWeKnow = [
    `${input.sourceName} reported this incident.`,
    input.baseConfidenceHint ?? "This report passed strict US-Iran conflict relevance filtering.",
    usIranWarScore >= 55
      ? "Report strongly matches direct US-Iran confrontation indicators."
      : relevanceScore >= 70
        ? "Content strongly matches Iran conflict escalation indicators."
        : "Content has partial conflict relevance indicators.",
  ];

  if (isUSLinked) {
    whatWeKnow.push("US-linked actor terms are present in this report.");
  }

  if (actors.length > 0) {
    whatWeKnow.push(`Actors mentioned: ${actors.join(", ")}.`);
  }
  if (impacts.length > 0) {
    whatWeKnow.push(`Potential impact signals: ${impacts.join(", ")}.`);
  }
  if (input.url) {
    whatWeKnow.push("Raw source link is available for verification.");
  }

  const whatWeDontKnow = [
    "Independent verification across additional sources may still be pending.",
    "Ground truth (sequence, casualties, and damage) can shift quickly.",
  ];

  if (relevanceScore < 72) {
    whatWeDontKnow.push(
      "This item met minimum relevance criteria but still needs corroboration for high-confidence interpretation.",
    );
  }

  return {
    relevanceScore,
    usIranWarScore,
    isUSLinked,
    whatWeKnow: whatWeKnow.slice(0, 5),
    whatWeDontKnow: whatWeDontKnow.slice(0, 4),
  };
}
