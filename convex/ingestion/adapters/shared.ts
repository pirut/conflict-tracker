import {
  CATEGORY_KEYWORDS,
  CONFLICT_RELEVANCE_TERMS,
  IRAN_RELEVANCE_TERMS,
  NOISE_TERMS,
  TRUSTED_NEWS_DOMAINS,
} from "../../constants";
import { resolvePlaceFromText } from "../../lib/geo";

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

export function extractCredibilityWeight(url?: string): number {
  if (!url) {
    return 0.55;
  }

  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return 0.55;
  }

  if (TRUSTED_NEWS_DOMAINS.some((trusted) => hostname.endsWith(trusted))) {
    return 0.9;
  }

  return 0.65;
}

export function derivePlace(text: string): {
  placeName: string;
  lat: number;
  lon: number;
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countMatches(text: string, terms: readonly string[]): string[] {
  const lowered = text.toLowerCase();
  return terms.filter((term) => lowered.includes(term));
}

export function computeNewsRelevanceScore(text: string): number {
  const normalized = normalizeText(text).toLowerCase();
  const geoMatches = countMatches(normalized, IRAN_RELEVANCE_TERMS);
  const conflictMatches = countMatches(normalized, CONFLICT_RELEVANCE_TERMS);
  const noiseMatches = countMatches(normalized, NOISE_TERMS);

  let score = 0;
  score += geoMatches.length * 18;
  score += conflictMatches.length * 14;
  score -= noiseMatches.length * 12;

  if (normalized.includes("iran")) {
    score += 16;
  }
  if (geoMatches.length >= 2) {
    score += 10;
  }
  if (conflictMatches.length >= 2) {
    score += 12;
  }
  if (geoMatches.length === 0) {
    score -= 24;
  }
  if (conflictMatches.length === 0) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function isRelevantIranConflictNews(
  title: string,
  summary?: string,
): boolean {
  const score = computeNewsRelevanceScore(`${title} ${summary ?? ""}`);
  return score >= 38;
}

function extractActors(text: string): string[] {
  const actorTerms = [
    "iran",
    "israel",
    "united states",
    "us",
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
  whatWeKnow: string[];
  whatWeDontKnow: string[];
} {
  const merged = normalizeText(`${input.title} ${input.summary}`);
  const relevanceScore = computeNewsRelevanceScore(merged);
  const actors = extractActors(merged);
  const impacts = extractImpacts(merged);

  const whatWeKnow = [
    `${input.sourceName} reported this incident.`,
    input.baseConfidenceHint ?? "This report passed conflict relevance filtering.",
    relevanceScore >= 65
      ? "Content strongly matches Iran conflict indicators."
      : "Content has partial conflict relevance indicators.",
  ];

  if (actors.length > 0) {
    whatWeKnow.push(`Actors mentioned: ${actors.join(", ")}.`);
  }
  if (impacts.length > 0) {
    whatWeKnow.push(`Potential impact signals: ${impacts.join(", ")}.`);
  }
  if (input.url) {
    whatWeKnow.push("Raw source link is available for audit.");
  }

  const whatWeDontKnow = [
    "Independent verification across additional sources may still be pending.",
    "Ground truth (scale, casualties, and sequence) can change rapidly.",
  ];

  if (relevanceScore < 65) {
    whatWeDontKnow.push(
      "This report is relevant but may require stronger corroboration before high-confidence interpretation.",
    );
  }

  return {
    relevanceScore,
    whatWeKnow: whatWeKnow.slice(0, 5),
    whatWeDontKnow: whatWeDontKnow.slice(0, 4),
  };
}
