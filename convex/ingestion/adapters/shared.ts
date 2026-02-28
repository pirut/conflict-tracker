import { CATEGORY_KEYWORDS, TRUSTED_NEWS_DOMAINS } from "../../constants";
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
