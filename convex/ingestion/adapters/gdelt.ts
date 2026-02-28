"use node";

import {
  GLOBAL_US_IRAN_LOCATION_TERMS,
  TRUSTED_NEWS_DOMAINS,
} from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { EventCategory } from "../../types";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import {
  buildNewsIntelligence,
  derivePlace,
  detectCategoryFromText,
  extractCredibilityWeight,
  fetchJson,
  fetchText,
  hostnameFromUrl,
  isFreshNewsTimestamp,
  isRelevantIranConflictNews,
  isTrustedNewsUrl,
  parseTimestamp,
} from "./shared";

type GdeltArticle = {
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  url?: string;
  sourceurl?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type GuardianResponse = {
  response?: {
    results?: Array<{
      webTitle?: string;
      webPublicationDate?: string;
      webUrl?: string;
      fields?: {
        trailText?: string;
        bodyText?: string;
      };
    }>;
  };
};

type NewsCandidate = {
  sourceName: string;
  title?: string;
  summary?: string;
  url?: string;
  publishedAt?: string | number;
  language?: string;
  raw: Record<string, unknown>;
};

const PREFERRED_NEWS_LANGUAGE = process.env.PREFERRED_NEWS_LANGUAGE ?? "en";
const INCLUDE_NON_ENGLISH = (process.env.INCLUDE_NON_ENGLISH_NEWS ?? "false") === "true";
const FOCUS_US_IRAN = (process.env.FOCUS_US_IRAN ?? "true") === "true";
const STRICT_TRUSTED_NEWS = (process.env.STRICT_TRUSTED_NEWS ?? "true") === "true";

const RSS_FEEDS: Array<{
  sourceName: string;
  url: string;
  language?: string;
}> = [
  {
    sourceName: "BBC Middle East RSS",
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    language: "en",
  },
  {
    sourceName: "Al Jazeera RSS",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    language: "en",
  },
  {
    sourceName: "NYTimes World RSS",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    language: "en",
  },
  {
    sourceName: "The Guardian World RSS",
    url: "https://www.theguardian.com/world/rss",
    language: "en",
  },
  {
    sourceName: "Reuters World RSS",
    url: "https://feeds.reuters.com/reuters/worldNews",
    language: "en",
  },
];

function buildNewsQuery(): string {
  const locationClause = GLOBAL_US_IRAN_LOCATION_TERMS.map((term) =>
    term.includes(" ") ? `"${term}"` : term,
  ).join(" OR ");

  const conflictClause = [
    "strike",
    "airstrike",
    "attack",
    "missile",
    "drone",
    "retaliation",
    "explosion",
    "intercept",
    "military",
  ].join(" OR ");

  if (FOCUS_US_IRAN) {
    const usClause = [
      '"united states"',
      '"u.s."',
      "american",
      "pentagon",
      "centcom",
      '"us military"',
    ].join(" OR ");

    return [`(${locationClause})`, `(${conflictClause})`, `(${usClause})`].join(" AND ");
  }

  return [`(${locationClause})`, `(${conflictClause})`].join(" AND ");
}

function decodeXmlText(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return decodeXmlText(match?.[1]);
}

function extractAtomLink(block: string): string | undefined {
  const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch?.[1]) {
    return decodeXmlText(hrefMatch[1]);
  }
  return extractTag(block, "link");
}

function parseRssCandidates(
  xml: string,
  sourceName: string,
  language?: string,
): NewsCandidate[] {
  const items: NewsCandidate[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const summary =
      extractTag(block, "description") ??
      extractTag(block, "content:encoded") ??
      title;
    const url = extractTag(block, "link");
    const publishedAt =
      extractTag(block, "pubDate") ?? extractTag(block, "dc:date");

    items.push({
      sourceName,
      title,
      summary,
      url,
      publishedAt,
      language,
      raw: {
        feed: sourceName,
        title,
        summary,
        url,
        publishedAt,
      },
    });
  }

  for (const block of entryBlocks) {
    const title = extractTag(block, "title");
    const summary =
      extractTag(block, "summary") ??
      extractTag(block, "content") ??
      title;
    const url = extractAtomLink(block);
    const publishedAt =
      extractTag(block, "published") ??
      extractTag(block, "updated");

    items.push({
      sourceName,
      title,
      summary,
      url,
      publishedAt,
      language,
      raw: {
        feed: sourceName,
        title,
        summary,
        url,
        publishedAt,
      },
    });
  }

  return items;
}

function normalizeLanguageCode(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const lang = input.trim().toLowerCase();
  if (!lang) {
    return undefined;
  }

  const aliases: Record<string, string> = {
    english: "en",
    en: "en",
    arabic: "ar",
    ar: "ar",
    persian: "fa",
    farsi: "fa",
    fa: "fa",
    turkish: "tr",
    tr: "tr",
    french: "fr",
    fr: "fr",
    spanish: "es",
    es: "es",
  };

  return aliases[lang] ?? lang.slice(0, 2);
}

function normalizeNewsCandidate(candidate: NewsCandidate, now: number): NormalizedIngestItem | null {
  const title = candidate.title?.trim();
  if (!title) {
    return null;
  }

  const summary =
    candidate.summary?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    title;

  const normalizedLanguage = normalizeLanguageCode(candidate.language);
  if (!INCLUDE_NON_ENGLISH && normalizedLanguage && normalizedLanguage !== PREFERRED_NEWS_LANGUAGE) {
    return null;
  }

  if (!isRelevantIranConflictNews(title, summary)) {
    return null;
  }

  const publishedTs = parseTimestamp(candidate.publishedAt, now);
  if (!isFreshNewsTimestamp(publishedTs, now)) {
    return null;
  }

  if (STRICT_TRUSTED_NEWS && !isTrustedNewsUrl(candidate.url)) {
    return null;
  }

  const category = detectCategoryFromText(`${title} ${summary}`) as EventCategory;
  const place = derivePlace(`${title} ${summary}`);
  const intel = buildNewsIntelligence({
    title,
    summary,
    sourceName: candidate.sourceName,
    url: candidate.url,
  });

  const host = hostnameFromUrl(candidate.url) ?? "unknown";

  return {
    sourceType: "news",
    sourceName: candidate.sourceName,
    url: candidate.url,
    publishedTs,
    fetchedTs: now,
    title,
    summary,
    category,
    lat: place.lat,
    lon: place.lon,
    placeName: place.placeName,
    country: place.country,
    keywords: extractKeywords(`${title} ${summary}`),
    credibilityWeight: extractCredibilityWeight(candidate.url),
    rawJson: {
      ...candidate.raw,
      relevanceScore: intel.relevanceScore,
      usIranWarScore: intel.usIranWarScore,
      isUSLinked: intel.isUSLinked,
      originalLanguage: candidate.language,
      normalizedLanguage,
      host,
    },
    isGeoPrecise: place.isGeoPrecise,
    whatWeKnow: intel.whatWeKnow,
    whatWeDontKnow: intel.whatWeDontKnow,
  };
}

async function fetchGdeltCandidates(query: string): Promise<NewsCandidate[]> {
  const url = new URL("http://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "120");
  url.searchParams.set("sort", "DateDesc");

  try {
    const response = await fetchJson<GdeltResponse>(url.toString());
    return (response.articles ?? []).map((article) => ({
      sourceName: article.domain ?? "GDELT",
      title: article.title,
      summary: article.title,
      url: article.url ?? article.sourceurl,
      publishedAt: article.seendate,
      language: article.language,
      raw: article as unknown as Record<string, unknown>,
    }));
  } catch {
    const proxyUrl = `https://r.jina.ai/http://api.gdeltproject.org/api/v2/doc/doc?${url.searchParams.toString()}`;
    const text = await fetchText(proxyUrl);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("GDELT fallback response did not contain JSON.");
    }

    const parsed = JSON.parse(text.slice(start, end + 1)) as GdeltResponse;
    return (parsed.articles ?? []).map((article) => ({
      sourceName: article.domain ?? "GDELT",
      title: article.title,
      summary: article.title,
      url: article.url ?? article.sourceurl,
      publishedAt: article.seendate,
      language: article.language,
      raw: article as unknown as Record<string, unknown>,
    }));
  }
}

async function fetchGuardianCandidates(query: string): Promise<NewsCandidate[]> {
  const url = new URL("https://content.guardianapis.com/search");
  url.searchParams.set("api-key", process.env.GUARDIAN_API_KEY ?? "test");
  url.searchParams.set("q", query);
  url.searchParams.set("order-by", "newest");
  url.searchParams.set("page-size", "40");
  url.searchParams.set("show-fields", "trailText,bodyText");

  const response = await fetchJson<GuardianResponse>(url.toString());
  return (response.response?.results ?? []).map((article) => ({
    sourceName: "The Guardian",
    title: article.webTitle,
    summary: article.fields?.trailText ?? article.fields?.bodyText,
    url: article.webUrl,
    publishedAt: article.webPublicationDate,
    language: "en",
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchRssCandidates(): Promise<NewsCandidate[]> {
  const runs = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url, {
        headers: {
          "User-Agent": "conflict-tracker/2.0",
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
      });
      return parseRssCandidates(xml, feed.sourceName, feed.language);
    }),
  );

  const all: NewsCandidate[] = [];
  for (const run of runs) {
    if (run.status === "fulfilled") {
      all.push(...run.value);
    }
  }
  return all;
}

function dedupeNews(items: NormalizedIngestItem[]): NormalizedIngestItem[] {
  const map = new Map<string, NormalizedIngestItem>();

  for (const item of items) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const key = item.url
      ? `url:${item.url}`
      : `${item.sourceName}:${normalizedTitle}:${Math.floor(item.publishedTs / (30 * 60 * 1000))}`;

    if (!map.has(key)) {
      map.set(key, item);
      continue;
    }

    const existing = map.get(key)!;
    if (item.credibilityWeight > existing.credibilityWeight) {
      map.set(key, item);
    }
  }

  return [...map.values()]
    .sort((a, b) => {
      const aUS = Number(a.rawJson?.usIranWarScore ?? 0);
      const bUS = Number(b.rawJson?.usIranWarScore ?? 0);
      return bUS - aUS || b.credibilityWeight - a.credibilityWeight || b.publishedTs - a.publishedTs;
    })
    .slice(0, 220);
}

function sourceHealthWarnings(items: NormalizedIngestItem[]): string[] {
  if (items.length === 0) {
    return [
      "News adapters returned 0 accepted items after strict filtering. Consider widening query or disabling STRICT_TRUSTED_NEWS.",
    ];
  }

  const hostCounts = new Map<string, number>();
  for (const item of items) {
    const host = hostnameFromUrl(item.url) ?? "unknown";
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }

  const dominantHost = [...hostCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (dominantHost && dominantHost[1] >= Math.max(8, Math.floor(items.length * 0.7))) {
    return [`Source concentration warning: ${dominantHost[0]} contributed ${dominantHost[1]} of ${items.length} accepted news rows.`];
  }

  return [];
}

export async function fetchGdeltNews(context: AdapterContext): Promise<IngestionAdapterResult> {
  const now = context.now;
  const query = buildNewsQuery();
  const warnings: string[] = [];

  const candidateRuns = await Promise.allSettled([
    fetchGdeltCandidates(query),
    fetchGuardianCandidates(query),
    fetchRssCandidates(),
  ]);

  const candidates: NewsCandidate[] = [];
  const sourceNames = ["GDELT", "Guardian", "RSS"];

  candidateRuns.forEach((result, index) => {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
      return;
    }
    warnings.push(`${sourceNames[index]} fetch failed: ${(result.reason as Error).message}`);
  });

  const mapped = candidates
    .map((candidate) => normalizeNewsCandidate(candidate, now))
    .filter((item): item is NormalizedIngestItem => item !== null);

  const items = dedupeNews(mapped);
  warnings.push(...sourceHealthWarnings(items));

  const trustedCoverage = new Set(
    items
      .map((item) => hostnameFromUrl(item.url))
      .filter((host): host is string => Boolean(host)),
  );

  if (trustedCoverage.size > 0) {
    const unknownTrusted = [...trustedCoverage].filter(
      (host) => !TRUSTED_NEWS_DOMAINS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`)),
    );
    if (unknownTrusted.length > 0) {
      warnings.push(`Accepted items included domains outside trusted list: ${unknownTrusted.slice(0, 6).join(", ")}`);
    }
  }

  return {
    items,
    warnings,
  };
}
