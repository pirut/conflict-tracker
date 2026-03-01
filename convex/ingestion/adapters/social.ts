"use node";

import { extractKeywords } from "../../lib/categorize";
import { EventCategory } from "../../types";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import {
  derivePlace,
  detectCategoryFromText,
  fetchJson,
  isRelevantIranConflictNews,
  parseTimestamp,
} from "./shared";

type SocialPayload = {
  posts?: Array<{
    text?: string;
    url?: string;
    publishedAt?: string;
    author?: string;
    engagement?: number;
  }>;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{
      data?: {
        title?: string;
        selftext?: string;
        permalink?: string;
        subreddit?: string;
        author?: string;
        created_utc?: number;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
};

const REDDIT_QUERIES = [
  "iran united states pentagon centcom strike missile drone retaliation",
  "iran iraq syria yemen lebanon red sea us military base attack",
];

const SOCIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function withinSocialWindow(ts: number, now: number): boolean {
  if (!Number.isFinite(ts)) {
    return false;
  }
  const delta = now - ts;
  return delta >= 0 && delta <= SOCIAL_MAX_AGE_MS;
}


async function fetchRedditItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];
  const minScore = Number(process.env.REDDIT_MIN_SCORE ?? 5);
  const minComments = Number(process.env.REDDIT_MIN_COMMENTS ?? 1);

  const runs = await Promise.allSettled(
    REDDIT_QUERIES.map(async (query) => {
      const url = new URL("https://www.reddit.com/search.json");
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", "70");
      url.searchParams.set("t", "day");

      const payload = await fetchJson<RedditSearchResponse>(url.toString(), {
        headers: {
          "User-Agent": "conflict-tracker/2.0",
        },
      });

      return payload.data?.children ?? [];
    }),
  );

  for (const run of runs) {
    if (run.status !== "fulfilled") {
      warnings.push(`Reddit fetch failed: ${(run.reason as Error).message}`);
      continue;
    }

    for (const row of run.value) {
      const post = row.data;
      if (!post?.title) {
        continue;
      }

      const summaryRaw = `${post.title} ${post.selftext ?? ""}`.trim();
      if (!isRelevantIranConflictNews(post.title, summaryRaw)) {
        continue;
      }

      const score = Number(post.score ?? 0);
      const comments = Number(post.num_comments ?? 0);
      if (score < minScore || comments < minComments) {
        continue;
      }

      const publishedTs =
        typeof post.created_utc === "number" ? Math.round(post.created_utc * 1000) : now;
      if (!withinSocialWindow(publishedTs, now)) {
        continue;
      }

      const place = derivePlace(summaryRaw);
      const category = detectCategoryFromText(summaryRaw) as EventCategory;
      const postUrl = post.permalink ? `https://www.reddit.com${post.permalink}` : undefined;

      if (!postUrl) {
        continue;
      }

      items.push({
        sourceType: "social",
        sourceName: `Reddit/r/${post.subreddit ?? "all"}`,
        url: postUrl,
        publishedTs,
        fetchedTs: now,
        title: `UNVERIFIED Reddit signal: ${post.title.slice(0, 90)}`,
        summary: summaryRaw,
        category,
        lat: place.lat,
        lon: place.lon,
        placeName: place.placeName,
        country: place.country,
        keywords: extractKeywords(summaryRaw),
        credibilityWeight: 0.3,
        rawJson: {
          source: "reddit",
          subreddit: post.subreddit,
          author: post.author,
          score,
          num_comments: comments,
          permalink: post.permalink,
        },
        isGeoPrecise: place.isGeoPrecise,
        whatWeKnow: [
          "An unverified Reddit post references a possible development.",
          `Engagement snapshot: score ${score}, comments ${comments}.`,
        ],
        whatWeDontKnow: [
          "Social posts may contain rumors, misattribution, or recycled footage.",
          "Independent corroboration is required before treating this as factual.",
        ],
      });
    }
  }

  const deduped = new Map<string, NormalizedIngestItem>();
  for (const item of items) {
    const key = item.url ?? `${item.sourceName}:${item.title}:${item.publishedTs}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return {
    items: [...deduped.values()].slice(0, 120),
    warnings,
  };
}

async function fetchEndpointItems(endpoint: string, now: number): Promise<NormalizedIngestItem[]> {
  const payload = await fetchJson<SocialPayload>(endpoint, {
    headers:
      process.env.SOCIAL_FEED_TOKEN
        ? { Authorization: `Bearer ${process.env.SOCIAL_FEED_TOKEN}` }
        : undefined,
  });

  const items: NormalizedIngestItem[] = [];

  for (const post of payload.posts ?? []) {
    const text = post.text?.trim();
    if (!text || !post.url) {
      continue;
    }

    if (!isRelevantIranConflictNews(text, text)) {
      continue;
    }

    const publishedTs = parseTimestamp(post.publishedAt, now);
    if (!withinSocialWindow(publishedTs, now)) {
      continue;
    }

    const place = derivePlace(text);
    const category = detectCategoryFromText(text) as EventCategory;

    items.push({
      sourceType: "social",
      sourceName: post.author ?? "SocialFeed",
      url: post.url,
      publishedTs,
      fetchedTs: now,
      title: `UNVERIFIED social signal: ${text.slice(0, 90)}`,
      summary: text,
      category,
      lat: place.lat,
      lon: place.lon,
      placeName: place.placeName,
      country: place.country,
      keywords: extractKeywords(text),
      credibilityWeight: 0.32,
      rawJson: {
        ...post,
        engagement: Number(post.engagement ?? 0),
      } as unknown as Record<string, unknown>,
      isGeoPrecise: place.isGeoPrecise,
      whatWeKnow: ["An unverified social post references a possible development."],
      whatWeDontKnow: [
        "This report is unverified and may be inaccurate.",
        "Independent corroboration is required before treating this as factual.",
      ],
    });
  }

  return items;
}

export async function fetchSocialReports(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];

  if ((process.env.ENABLE_SOCIAL_INGESTION ?? "false") !== "true") {
    return {
      items: [],
      warnings: ["Social adapter disabled. Set ENABLE_SOCIAL_INGESTION=true to enable."],
    };
  }

  const endpoint = process.env.SOCIAL_FEED_ENDPOINT?.trim();
  if (endpoint) {
    try {
      items.push(...(await fetchEndpointItems(endpoint, now)));
    } catch (error) {
      warnings.push(`Social endpoint fetch failed: ${(error as Error).message}`);
    }
  }

  const useReddit = (process.env.SOCIAL_REDDIT_ENABLED ?? "true") === "true";
  if (useReddit) {
    const reddit = await fetchRedditItems(now);
    items.push(...reddit.items);
    warnings.push(...reddit.warnings);
  }

  if ((process.env.SOCIAL_X_ENABLED ?? "false") === "true") {
    warnings.push("X ingestion is disabled in this build. Use Reddit/custom social feed instead.");
  }

  const deduped = new Map<string, NormalizedIngestItem>();
  for (const item of items) {
    const key = item.url ?? `${item.sourceName}:${item.title}:${item.publishedTs}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  const filtered = [...deduped.values()]
    .sort((a, b) => b.publishedTs - a.publishedTs)
    .slice(0, 180);

  if (filtered.length === 0) {
    warnings.push("No social rows passed quality filters; no synthetic fallback is emitted.");
  }

  return { items: filtered, warnings };
}
