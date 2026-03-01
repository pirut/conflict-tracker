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

type PullPushResponse = {
  data?: Array<{
    id?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit?: string;
    author?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    over_18?: boolean;
    removed_by_category?: string | null;
    subreddit_subscribers?: number;
  }>;
};

type RedditPostRow = {
  id?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  subreddit?: string;
  author?: string;
  createdUtc?: number;
  score?: number;
  comments?: number;
  provider: "reddit" | "pullpush";
  over18?: boolean;
  removedByCategory?: string | null;
  subredditSubscribers?: number;
};

const REDDIT_QUERIES = [
  "iran united states pentagon centcom strike missile drone retaliation",
  "iran iraq syria yemen lebanon red sea us military base attack",
];

const SOCIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REDDIT_MAX_RESULTS = 70;
const REDDIT_DEFAULT_HEADERS = {
  "User-Agent":
    process.env.REDDIT_USER_AGENT?.trim() ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "application/json",
} as const;
const PULLPUSH_PRIORITY_SUBREDDITS = new Set(
  [
    "worldnews",
    "news",
    "geopolitics",
    "credibledefense",
    "combatfootage",
    "middleeast",
    "iran",
    "iranian",
    "politics",
  ].map((item) => item.toLowerCase()),
);

function withinSocialWindow(ts: number, now: number): boolean {
  if (!Number.isFinite(ts)) {
    return false;
  }
  const delta = now - ts;
  return delta >= 0 && delta <= SOCIAL_MAX_AGE_MS;
}

function extractHttpStatus(error: unknown): number | null {
  const message = (error as Error)?.message ?? "";
  const match = message.match(/HTTP\s+(\d{3})\b/i);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldTryRedditMirrorFallback(error: unknown): boolean {
  const status = extractHttpStatus(error);
  return status === 403 || status === 429 || status === 401;
}

function parseRedditRowsFromOfficial(payload: RedditSearchResponse): RedditPostRow[] {
  return (payload.data?.children ?? []).map((row) => {
    const post = row.data;
    return {
      id: undefined,
      title: post?.title,
      selftext: post?.selftext,
      permalink: post?.permalink,
      subreddit: post?.subreddit,
      author: post?.author,
      createdUtc: post?.created_utc,
      score: post?.score,
      comments: post?.num_comments,
      provider: "reddit",
    };
  });
}

function parseRedditRowsFromPullPush(payload: PullPushResponse): RedditPostRow[] {
  return (payload.data ?? []).map((post) => ({
    id: post.id,
    title: post.title,
    selftext: post.selftext,
    permalink: post.permalink,
    subreddit: post.subreddit,
    author: post.author,
    createdUtc: post.created_utc,
    score: post.score,
    comments: post.num_comments,
    provider: "pullpush",
    over18: post.over_18,
    removedByCategory: post.removed_by_category,
    subredditSubscribers: post.subreddit_subscribers,
  }));
}

async function fetchRedditRowsOfficial(query: string): Promise<RedditPostRow[]> {
  const endpoints = ["https://www.reddit.com/search.json", "https://old.reddit.com/search.json"];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", String(REDDIT_MAX_RESULTS));
      url.searchParams.set("t", "day");
      url.searchParams.set("raw_json", "1");

      const payload = await fetchJson<RedditSearchResponse>(url.toString(), {
        headers: REDDIT_DEFAULT_HEADERS,
      });
      return parseRedditRowsFromOfficial(payload);
    } catch (error) {
      lastError = error as Error;
      if (!shouldTryRedditMirrorFallback(error)) {
        continue;
      }
    }
  }

  throw lastError ?? new Error("Reddit fetch failed for unknown reason.");
}

async function fetchRedditRowsPullPush(query: string): Promise<RedditPostRow[]> {
  const url = new URL("https://api.pullpush.io/reddit/search/submission/");
  url.searchParams.set("q", query);
  url.searchParams.set("size", String(REDDIT_MAX_RESULTS));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("sort_type", "created_utc");

  const payload = await fetchJson<PullPushResponse>(url.toString(), {
    headers: REDDIT_DEFAULT_HEADERS,
  });
  return parseRedditRowsFromPullPush(payload);
}

async function fetchRedditRowsWithFallback(query: string): Promise<{
  rows: RedditPostRow[];
  provider: "reddit" | "pullpush";
  warning?: string;
}> {
  try {
    const rows = await fetchRedditRowsOfficial(query);
    return {
      rows,
      provider: "reddit",
    };
  } catch (error) {
    if (!shouldTryRedditMirrorFallback(error)) {
      throw error;
    }

    const fallbackRows = await fetchRedditRowsPullPush(query);
    return {
      rows: fallbackRows,
      provider: "pullpush",
      warning: `Reddit API blocked (${(error as Error).message}); using PullPush fallback.`,
    };
  }
}

function isAllowedPullPushSubreddit(
  subredditRaw: string | undefined,
  subscribersRaw: number | undefined,
  minSubscribers: number,
): boolean {
  const subreddit = (subredditRaw ?? "").trim().toLowerCase();
  if (!subreddit) {
    return false;
  }
  if (PULLPUSH_PRIORITY_SUBREDDITS.has(subreddit)) {
    return true;
  }

  const subscribers = Number(subscribersRaw ?? 0);
  return Number.isFinite(subscribers) && subscribers >= minSubscribers;
}

async function fetchRedditItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];
  const minScore = Number(process.env.REDDIT_MIN_SCORE ?? 5);
  const minComments = Number(process.env.REDDIT_MIN_COMMENTS ?? 1);
  const minPullPushSubscribersRaw = Number(process.env.REDDIT_PULLPUSH_MIN_SUBSCRIBERS ?? 75000);
  const minPullPushSubscribers = Number.isFinite(minPullPushSubscribersRaw)
    ? Math.max(0, Math.round(minPullPushSubscribersRaw))
    : 75000;
  let pullPushFallbackQueries = 0;

  const runs = await Promise.allSettled(
    REDDIT_QUERIES.map((query) => fetchRedditRowsWithFallback(query)),
  );

  for (const run of runs) {
    if (run.status !== "fulfilled") {
      warnings.push(`Reddit fetch failed: ${(run.reason as Error).message}`);
      continue;
    }

    if (run.value.warning) {
      warnings.push(run.value.warning);
    }
    if (run.value.provider === "pullpush") {
      pullPushFallbackQueries += 1;
    }

    for (const post of run.value.rows) {
      if (!post?.title) {
        continue;
      }

      const summaryRaw = `${post.title} ${post.selftext ?? ""}`.trim();
      if (!isRelevantIranConflictNews(post.title, summaryRaw)) {
        continue;
      }

      if (post.provider === "pullpush") {
        if (post.over18 || post.removedByCategory) {
          continue;
        }
        if (
          !isAllowedPullPushSubreddit(
            post.subreddit,
            post.subredditSubscribers,
            minPullPushSubscribers,
          )
        ) {
          continue;
        }
      }

      const score = Number(post.score ?? 0);
      const comments = Number(post.comments ?? 0);
      if (score < minScore || comments < minComments) {
        continue;
      }

      const publishedTs = typeof post.createdUtc === "number" ? Math.round(post.createdUtc * 1000) : now;
      if (!withinSocialWindow(publishedTs, now)) {
        continue;
      }

      const place = derivePlace(summaryRaw);
      const category = detectCategoryFromText(summaryRaw) as EventCategory;
      const permalink =
        post.permalink && post.permalink.startsWith("/")
          ? `https://www.reddit.com${post.permalink}`
          : post.permalink;
      const postUrl =
        permalink ??
        (post.id && post.subreddit
          ? `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/`
          : undefined);

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
          source: post.provider,
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
    warnings:
      pullPushFallbackQueries > 0
        ? [
            ...warnings,
            `Reddit fallback source used for ${pullPushFallbackQueries}/${REDDIT_QUERIES.length} queries due Reddit API blocking.`,
          ]
        : warnings,
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
