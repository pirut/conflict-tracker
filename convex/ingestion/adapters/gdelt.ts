"use node";

import { NEWS_QUERY_KEYWORDS } from "../../constants";
import { extractKeywords } from "../../lib/categorize";
import { EventCategory } from "../../types";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import {
  derivePlace,
  detectCategoryFromText,
  extractCredibilityWeight,
  fetchJson,
  fetchText,
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

function mapGdeltArticle(article: GdeltArticle, now: number): NormalizedIngestItem | null {
  const title = article.title?.trim();
  if (!title) {
    return null;
  }

  const sourceUrl = article.url ?? article.sourceurl;
  const summary = title;
  const category = detectCategoryFromText(`${title} ${summary}`) as EventCategory;
  const place = derivePlace(`${title} ${summary}`);

  return {
    sourceType: "news",
    sourceName: article.domain ?? "GDELT",
    url: sourceUrl,
    publishedTs: parseTimestamp(article.seendate, now),
    fetchedTs: now,
    title,
    summary,
    category,
    lat: place.lat,
    lon: place.lon,
    placeName: place.placeName,
    country: "Iran",
    keywords: extractKeywords(`${title} ${summary}`),
    credibilityWeight: extractCredibilityWeight(sourceUrl),
    rawJson: article as unknown as Record<string, unknown>,
    isGeoPrecise: place.isGeoPrecise,
    whatWeKnow: [
      "At least one news outlet published a report describing this event.",
      `Report category inferred as ${category}.`,
    ],
    whatWeDontKnow: [
      "The exact on-the-ground impact is not yet independently confirmed.",
      "Details may evolve as additional sources report.",
    ],
  };
}

function mapNewsApiArticle(article: NewsApiArticle, now: number): NormalizedIngestItem | null {
  const title = article.title?.trim();
  if (!title) {
    return null;
  }

  const summary = article.description?.trim() || article.content?.slice(0, 260) || title;
  const category = detectCategoryFromText(`${title} ${summary}`) as EventCategory;
  const place = derivePlace(`${title} ${summary}`);

  return {
    sourceType: "news",
    sourceName: article.source?.name ?? "NewsAPI",
    url: article.url,
    publishedTs: parseTimestamp(article.publishedAt, now),
    fetchedTs: now,
    title,
    summary,
    category,
    lat: place.lat,
    lon: place.lon,
    placeName: place.placeName,
    country: "Iran",
    keywords: extractKeywords(`${title} ${summary}`),
    credibilityWeight: extractCredibilityWeight(article.url),
    rawJson: article as unknown as Record<string, unknown>,
    isGeoPrecise: place.isGeoPrecise,
    whatWeKnow: [
      "An additional API-backed news source references this incident.",
      `Article source: ${article.source?.name ?? "Unknown"}.`,
    ],
    whatWeDontKnow: [
      "Article-level claims may change with corrections or updates.",
      "Independent official confirmation may still be pending.",
    ],
  };
}

export async function fetchGdeltNews(context: AdapterContext): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const query = `(${NEWS_QUERY_KEYWORDS.map((keyword) => {
    if (keyword.includes(" ")) {
      return `"${keyword}"`;
    }
    return keyword;
  }).join(" OR ")})`;

  // GDELT HTTPS is intermittently unreachable from some runtimes; HTTP endpoint is stable here.
  const url = new URL("http://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "80");
  url.searchParams.set("sort", "DateDesc");

  let items: NormalizedIngestItem[] = [];

  try {
    const response = await fetchJson<GdeltResponse>(url.toString());
    items = (response.articles ?? [])
      .map((article) => mapGdeltArticle(article, now))
      .filter((item): item is NormalizedIngestItem => item !== null);
  } catch (error) {
    try {
      // Fallback when direct GDELT is unreachable from the runtime.
      const proxyUrl = `https://r.jina.ai/http://api.gdeltproject.org/api/v2/doc/doc?${url.searchParams.toString()}`;
      const text = await fetchText(proxyUrl);
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) {
        throw new Error("Proxy response did not contain JSON payload.");
      }

      const response = JSON.parse(text.slice(start, end + 1)) as GdeltResponse;
      items = (response.articles ?? [])
        .map((article) => mapGdeltArticle(article, now))
        .filter((item): item is NormalizedIngestItem => item !== null);
      warnings.push("Direct GDELT request failed; used proxy fallback.");
    } catch (proxyError) {
      warnings.push(`GDELT fetch failed: ${(proxyError as Error).message}`);
      warnings.push(`Original GDELT error: ${(error as Error).message}`);
    }
  }

  const newsApiKey = process.env.NEWSAPI_KEY;
  if (newsApiKey) {
    try {
      const newsApiUrl = new URL("https://newsapi.org/v2/everything");
      newsApiUrl.searchParams.set("q", query);
      newsApiUrl.searchParams.set("language", "en");
      newsApiUrl.searchParams.set("sortBy", "publishedAt");
      newsApiUrl.searchParams.set("pageSize", "30");

      const response = await fetchJson<NewsApiResponse>(newsApiUrl.toString(), {
        headers: { "X-Api-Key": newsApiKey },
      });

      const mapped = (response.articles ?? [])
        .map((article) => mapNewsApiArticle(article, now))
        .filter((item): item is NormalizedIngestItem => item !== null);

      items = items.concat(mapped);
    } catch (error) {
      warnings.push(`NewsAPI fetch failed: ${(error as Error).message}`);
    }
  }

  return {
    items,
    warnings,
  };
}
