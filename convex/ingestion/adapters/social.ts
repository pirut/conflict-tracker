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

type XRecentSearchResponse = {
  data?: Array<{
    id?: string;
    text?: string;
    created_at?: string;
    author_id?: string;
    lang?: string;
    public_metrics?: {
      retweet_count?: number;
      reply_count?: number;
      like_count?: number;
      quote_count?: number;
      impression_count?: number;
    };
  }>;
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
      name?: string;
      verified?: boolean;
      public_metrics?: {
        followers_count?: number;
      };
    }>;
  };
};

type XUser = {
  id?: string;
  username?: string;
  name?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count?: number;
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

function resolveXQuery(): string {
  const fromEnv = process.env.X_API_QUERY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const base = [
    "(iran OR tehran OR isfahan OR natanz OR qom OR tabriz OR iraq OR syria OR yemen OR lebanon OR red sea OR hormuz)",
    '("united states" OR "u.s." OR us OR pentagon OR centcom OR "us military" OR american)',
    "(strike OR airstrike OR explosion OR attack OR missile OR drone OR retaliation OR bombardment OR military)",
  ].join(" ");

  const includeReplies = (process.env.X_API_INCLUDE_REPLIES ?? "false") === "true";
  const lang = process.env.X_API_LANG?.trim().toLowerCase();
  const parts = [base, "-is:retweet"];

  if (!includeReplies) {
    parts.push("-is:reply");
  }

  if (lang) {
    parts.push(`lang:${lang}`);
  }

  return parts.join(" ");
}

function resolveXBearerCandidates(rawToken: string): string[] {
  const candidates = [rawToken];
  if (rawToken.includes("%")) {
    try {
      const decoded = decodeURIComponent(rawToken);
      if (decoded && decoded !== rawToken) {
        candidates.push(decoded);
      }
    } catch {
      // keep original token only
    }
  }
  return [...new Set(candidates)];
}

async function fetchXItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const rawToken = process.env.X_API_BEARER_TOKEN?.trim();

  if (!rawToken) {
    return {
      items: [],
      warnings: ["X API token missing. Set X_API_BEARER_TOKEN to enable X ingestion."],
    };
  }

  const maxResultsRaw = Number(process.env.X_API_MAX_RESULTS ?? 50);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.max(10, Math.min(100, Math.round(maxResultsRaw)))
    : 50;
  const minFollowersRaw = Number(process.env.X_MIN_FOLLOWERS ?? 1200);
  const minFollowers = Number.isFinite(minFollowersRaw) ? Math.max(0, Math.round(minFollowersRaw)) : 1200;
  const minEngagementRaw = Number(process.env.X_MIN_ENGAGEMENT ?? 12);
  const minEngagement = Number.isFinite(minEngagementRaw) ? Math.max(0, Math.round(minEngagementRaw)) : 12;
  const allowLowQualityFallback = (process.env.X_ALLOW_LOW_QUALITY_FALLBACK ?? "true") === "true";

  const query = resolveXQuery();
  const baseUrl = (process.env.X_API_BASE_URL ?? "https://api.x.com").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("tweet.fields", "created_at,lang,author_id,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,verified,public_metrics");

  const tokenCandidates = resolveXBearerCandidates(rawToken);
  let payload: XRecentSearchResponse | null = null;
  let lastError: Error | null = null;

  for (const token of tokenCandidates) {
    try {
      payload = await fetchJson<XRecentSearchResponse>(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (!payload) {
    warnings.push(`X API fetch failed: ${lastError?.message ?? "unknown error"}`);
    return {
      items: [],
      warnings,
    };
  }

  try {
    const usersById = new Map<string, XUser>();
    for (const user of payload.includes?.users ?? []) {
      if (user.id) {
        usersById.set(user.id, user);
      }
    }

    const strongItems: NormalizedIngestItem[] = [];
    const weakItems: Array<{ item: NormalizedIngestItem; engagement: number }> = [];

    for (const post of payload.data ?? []) {
      const text = post.text?.trim();
      const postId = post.id?.trim();
      if (!text || !postId) {
        continue;
      }

      if (!isRelevantIranConflictNews(text, text)) {
        continue;
      }

      const author = post.author_id ? usersById.get(post.author_id) : undefined;
      const username = author?.username?.trim();
      const name = author?.name?.trim();
      const profileLabel = username ? `@${username}` : name || "unknown";
      const postUrl = username
        ? `https://x.com/${username}/status/${postId}`
        : `https://x.com/i/status/${postId}`;

      const metrics = post.public_metrics ?? {};
      const publishedTs = parseTimestamp(post.created_at, now);
      if (!withinSocialWindow(publishedTs, now)) {
        continue;
      }

      const followers = Number(author?.public_metrics?.followers_count ?? 0);
      const likes = Number(metrics.like_count ?? 0);
      const reposts = Number(metrics.retweet_count ?? 0);
      const replies = Number(metrics.reply_count ?? 0);
      const engagement = likes + reposts + replies;
      const verified = Boolean(author?.verified);

      const place = derivePlace(text);
      const category = detectCategoryFromText(text) as EventCategory;

      const item: NormalizedIngestItem = {
        sourceType: "social",
        sourceName: `X/${profileLabel}`,
        url: postUrl,
        publishedTs,
        fetchedTs: now,
        title: `UNVERIFIED X signal: ${text.slice(0, 90)}`,
        summary: text,
        category,
        lat: place.lat,
        lon: place.lon,
        placeName: place.placeName,
        country: place.country,
        keywords: extractKeywords(text),
        credibilityWeight: Math.min(0.42, 0.24 + (verified ? 0.08 : 0) + (followers > 20000 ? 0.08 : 0)),
        rawJson: {
          source: "x",
          id: postId,
          lang: post.lang,
          metrics,
          author: {
            id: author?.id,
            username,
            name,
            verified,
            followers,
          },
        },
        isGeoPrecise: place.isGeoPrecise,
        whatWeKnow: [
          "An unverified X post references a possible development.",
          `Engagement snapshot: ${likes} likes, ${reposts} reposts, ${replies} replies.`,
          verified ? "Author account is verified." : "Author account is not verified.",
        ],
        whatWeDontKnow: [
          "Social posts can contain rumors, stale media, or missing context.",
          "Independent corroboration is required before treating this as factual.",
        ],
      };

      const passesQualityGate = verified || followers >= minFollowers || engagement >= minEngagement;
      if (passesQualityGate) {
        strongItems.push(item);
      } else {
        weakItems.push({
          item: {
            ...item,
            credibilityWeight: Math.max(0.2, item.credibilityWeight - 0.08),
          },
          engagement,
        });
      }
    }

    if (strongItems.length === 0 && weakItems.length > 0 && allowLowQualityFallback) {
      warnings.push(
        "X quality gate yielded 0 strong items; including limited low-engagement rows for visibility.",
      );
      weakItems
        .sort((a, b) => b.engagement - a.engagement || b.item.publishedTs - a.item.publishedTs)
        .slice(0, 20)
        .forEach((row) => strongItems.push(row.item));
    }

    const deduped = new Map<string, NormalizedIngestItem>();
    for (const item of strongItems) {
      if (!deduped.has(item.url ?? `${item.sourceName}:${item.title}:${item.publishedTs}`)) {
        deduped.set(item.url ?? `${item.sourceName}:${item.title}:${item.publishedTs}`, item);
      }
    }

    return {
      items: [...deduped.values()].slice(0, 120),
      warnings,
    };
  } catch (error) {
    warnings.push(`X API fetch failed: ${(error as Error).message}`);
    return {
      items: [],
      warnings,
    };
  }
}

async function fetchRedditItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];
  const minScore = Number(process.env.REDDIT_MIN_SCORE ?? 40);
  const minComments = Number(process.env.REDDIT_MIN_COMMENTS ?? 12);

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

  const useX = (process.env.SOCIAL_X_ENABLED ?? "false") === "true";
  if (useX) {
    const x = await fetchXItems(now);
    items.push(...x.items);
    warnings.push(...x.warnings);
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
