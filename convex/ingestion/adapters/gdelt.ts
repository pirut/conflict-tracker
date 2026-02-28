"use node";

import {
  CONFLICT_RELEVANCE_TERMS,
  IRAN_RELEVANCE_TERMS,
  NEWS_QUERY_KEYWORDS,
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
  isRelevantIranConflictNews,
  parseTimestamp,
} from "./shared";

type GdeltArticle = {
  title?: string;
  seendate?: string;
  socialimage?: string;
  sourcecountry?: string;
  domain?: string;
  language?: string;
  url?: string;
  sourceurl?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type NewsApiArticle = {
  title?: string;
  description?: string;
  content?: string;
  publishedAt?: string;
  url?: string;
  source?: { name?: string };
};

type NewsApiResponse = {
  articles?: NewsApiArticle[];
};

type GuardianResponse = {
  response?: {
    results?: Array<{
      webTitle?: string;
      webPublicationDate?: string;
      webUrl?: string;
      sectionName?: string;
      fields?: {
        trailText?: string;
        bodyText?: string;
      };
    }>;
  };
};

type GNewsResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    content?: string;
    url?: string;
    publishedAt?: string;
    source?: { name?: string };
  }>;
};

type MediaStackResponse = {
  data?: Array<{
    title?: string;
    description?: string;
    url?: string;
    source?: string;
    published_at?: string;
    language?: string;
  }>;
};

type NytResponse = {
  response?: {
    docs?: Array<{
      abstract?: string;
      snippet?: string;
      web_url?: string;
      pub_date?: string;
      source?: string;
      headline?: { main?: string };
    }>;
  };
};

type NewsDataResponse = {
  results?: Array<{
    title?: string;
    description?: string;
    link?: string;
    pubDate?: string;
    source_id?: string;
    language?: string;
  }>;
};

type TheNewsApiResponse = {
  data?: Array<{
    title?: string;
    description?: string;
    url?: string;
    published_at?: string;
    source?: string;
    language?: string;
  }>;
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
];

function buildNewsQuery(): string {
  const geoTerms = NEWS_QUERY_KEYWORDS.filter((keyword) =>
    IRAN_RELEVANCE_TERMS.some((term) => keyword.toLowerCase().includes(term)),
  );
  const conflictTerms = NEWS_QUERY_KEYWORDS.filter((keyword) =>
    CONFLICT_RELEVANCE_TERMS.some((term) => keyword.toLowerCase().includes(term)),
  );

  const mapKeyword = (keyword: string) => (keyword.includes(" ") ? `"${keyword}"` : keyword);

  const geo = (geoTerms.length > 0 ? geoTerms : NEWS_QUERY_KEYWORDS)
    .map(mapKeyword)
    .join(" OR ");
  const incident = (conflictTerms.length > 0 ? conflictTerms : NEWS_QUERY_KEYWORDS)
    .map(mapKeyword)
    .join(" OR ");

  return `(${geo}) AND (${incident})`;
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

  const category = detectCategoryFromText(`${title} ${summary}`) as EventCategory;
  const place = derivePlace(`${title} ${summary}`);
  const intel = buildNewsIntelligence({
    title,
    summary,
    sourceName: candidate.sourceName,
    url: candidate.url,
  });

  return {
    sourceType: "news",
    sourceName: candidate.sourceName,
    url: candidate.url,
    publishedTs: parseTimestamp(candidate.publishedAt, now),
    fetchedTs: now,
    title,
    summary,
    category,
    lat: place.lat,
    lon: place.lon,
    placeName: place.placeName,
    country: "Iran",
    keywords: extractKeywords(`${title} ${summary}`),
    credibilityWeight: extractCredibilityWeight(candidate.url),
    rawJson: {
      ...candidate.raw,
      relevanceScore: intel.relevanceScore,
      originalLanguage: candidate.language,
      normalizedLanguage,
    },
    isGeoPrecise: place.isGeoPrecise,
    whatWeKnow: intel.whatWeKnow,
    whatWeDontKnow: intel.whatWeDontKnow,
  };
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

  if (aliases[lang]) {
    return aliases[lang];
  }

  return lang.slice(0, 2);
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

async function fetchNewsApiCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://newsapi.org/v2/everything");
  url.searchParams.set("q", query);
  url.searchParams.set("language", PREFERRED_NEWS_LANGUAGE);
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("pageSize", "40");

  const response = await fetchJson<NewsApiResponse>(url.toString(), {
    headers: { "X-Api-Key": apiKey },
  });

  return (response.articles ?? []).map((article) => ({
    sourceName: article.source?.name ?? "NewsAPI",
    title: article.title,
    summary: article.description ?? article.content,
    url: article.url,
    publishedAt: article.publishedAt,
    language: PREFERRED_NEWS_LANGUAGE,
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchGNewsCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://gnews.io/api/v4/search");
  url.searchParams.set("q", query);
  url.searchParams.set("lang", PREFERRED_NEWS_LANGUAGE);
  url.searchParams.set("max", "20");
  url.searchParams.set("sortby", "publishedAt");
  url.searchParams.set("apikey", apiKey);

  const response = await fetchJson<GNewsResponse>(url.toString());
  return (response.articles ?? []).map((article) => ({
    sourceName: article.source?.name ?? "GNews",
    title: article.title,
    summary: article.description ?? article.content,
    url: article.url,
    publishedAt: article.publishedAt,
    language: PREFERRED_NEWS_LANGUAGE,
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchMediaStackCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.MEDIASTACK_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("http://api.mediastack.com/v1/news");
  url.searchParams.set("access_key", apiKey);
  url.searchParams.set("languages", PREFERRED_NEWS_LANGUAGE);
  url.searchParams.set("sort", "published_desc");
  url.searchParams.set("limit", "50");
  url.searchParams.set("keywords", query.replace(/[()\"]/g, ""));

  const response = await fetchJson<MediaStackResponse>(url.toString());
  return (response.data ?? []).map((article) => ({
    sourceName: article.source ?? "MediaStack",
    title: article.title,
    summary: article.description,
    url: article.url,
    publishedAt: article.published_at,
    language: article.language,
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchNytCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.NYTIMES_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://api.nytimes.com/svc/search/v2/articlesearch.json");
  url.searchParams.set("q", query.replace(/[()\"]/g, " "));
  url.searchParams.set("sort", "newest");
  url.searchParams.set("api-key", apiKey);

  const response = await fetchJson<NytResponse>(url.toString());
  return (response.response?.docs ?? []).map((article) => ({
    sourceName: article.source ?? "New York Times",
    title: article.headline?.main,
    summary: article.abstract ?? article.snippet,
    url: article.web_url,
    publishedAt: article.pub_date,
    language: "en",
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchNewsDataCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://newsdata.io/api/1/news");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", query.replace(/[()"]/g, " "));
  url.searchParams.set("language", PREFERRED_NEWS_LANGUAGE);
  url.searchParams.set("size", "40");

  const response = await fetchJson<NewsDataResponse>(url.toString());
  return (response.results ?? []).map((article) => ({
    sourceName: article.source_id ?? "NewsData",
    title: article.title,
    summary: article.description,
    url: article.link,
    publishedAt: article.pubDate,
    language: article.language,
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchTheNewsApiCandidates(query: string): Promise<NewsCandidate[]> {
  const apiKey = process.env.THENEWSAPI_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://api.thenewsapi.com/v1/news/all");
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("search", query.replace(/[()"]/g, " "));
  url.searchParams.set("language", PREFERRED_NEWS_LANGUAGE);
  url.searchParams.set("sort", "published_at");
  url.searchParams.set("limit", "40");

  const response = await fetchJson<TheNewsApiResponse>(url.toString());
  return (response.data ?? []).map((article) => ({
    sourceName: article.source ?? "TheNewsAPI",
    title: article.title,
    summary: article.description,
    url: article.url,
    publishedAt: article.published_at,
    language: article.language,
    raw: article as unknown as Record<string, unknown>,
  }));
}

async function fetchRssCandidates(): Promise<NewsCandidate[]> {
  const runs = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url, {
        headers: {
          "User-Agent": "conflict-tracker/1.0",
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
    const key = item.url ? `url:${item.url}` : `${item.sourceName}:${item.title}:${item.publishedTs}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()]
    .sort((a, b) => b.publishedTs - a.publishedTs)
    .slice(0, 180);
}

export async function fetchGdeltNews(context: AdapterContext): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const query = buildNewsQuery();

  const candidateRuns = await Promise.allSettled([
    fetchGdeltCandidates(query),
    fetchGuardianCandidates(query),
    fetchNewsApiCandidates(query),
    fetchGNewsCandidates(query),
    fetchMediaStackCandidates(query),
    fetchNytCandidates(query),
    fetchNewsDataCandidates(query),
    fetchTheNewsApiCandidates(query),
    fetchRssCandidates(),
  ]);

  const candidates: NewsCandidate[] = [];
  const sourceNames = [
    "GDELT",
    "Guardian",
    "NewsAPI",
    "GNews",
    "MediaStack",
    "NYTimes",
    "NewsData",
    "TheNewsAPI",
    "RSS",
  ];

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

  return {
    items,
    warnings,
  };
}
