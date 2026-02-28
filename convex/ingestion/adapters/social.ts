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
      bookmark_count?: number;
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
        following_count?: number;
        tweet_count?: number;
        listed_count?: number;
      };
    }>;
  };
  meta?: {
    result_count?: number;
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
  };
};

type XUser = {
  id?: string;
  username?: string;
  name?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
};

const REDDIT_QUERIES = [
  "iran iraq syria yemen lebanon red sea hormuz united states us u.s. pentagon centcom strike explosion missile drone air defense",
  "tehran baghdad damascus sanaa beirut us attack airstrike retaliation bombardment missile drone military base",
];

function resolveXQuery(): string {
  const fromEnv = process.env.X_API_QUERY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const base = [
    "(iran OR tehran OR isfahan OR natanz OR qom OR tabriz OR iraq OR baghdad OR erbil OR syria OR damascus OR yemen OR sanaa OR lebanon OR beirut OR red sea OR hormuz OR persian gulf)",
    '("united states" OR "u.s." OR us OR pentagon OR centcom OR "us military" OR american)',
    '(strike OR airstrike OR explosion OR attack OR missile OR drone OR retaliation OR bombardment OR "air defense" OR "military base")',
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

async function fetchXItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const token = process.env.X_API_BEARER_TOKEN?.trim();

  if (!token) {
    return {
      items: [],
      warnings: ["X API token missing. Set X_API_BEARER_TOKEN to enable X ingestion."],
    };
  }

  const maxResultsRaw = Number(process.env.X_API_MAX_RESULTS ?? 70);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.max(10, Math.min(100, Math.round(maxResultsRaw)))
    : 70;

  const query = resolveXQuery();
  const baseUrl = (process.env.X_API_BASE_URL ?? "https://api.x.com").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/2/tweets/search/recent`);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("tweet.fields", "created_at,lang,author_id,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,verified,public_metrics");

  try {
    const payload = await fetchJson<XRecentSearchResponse>(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const usersById = new Map<string, XUser>();
    for (const user of payload.includes?.users ?? []) {
      if (user.id) {
        usersById.set(user.id, user);
      }
    }

    const items: NormalizedIngestItem[] = [];

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
      const url = username
        ? `https://x.com/${username}/status/${postId}`
        : `https://x.com/i/status/${postId}`;

      const place = derivePlace(text);
      const category = detectCategoryFromText(text) as EventCategory;
      const metrics = post.public_metrics ?? {};
      const publishedTs = parseTimestamp(post.created_at, now);
      const followers = Number(author?.public_metrics?.followers_count ?? 0);
      const likes = Number(metrics.like_count ?? 0);
      const reposts = Number(metrics.retweet_count ?? 0);
      const replies = Number(metrics.reply_count ?? 0);
      const verified = Boolean(author?.verified);

      const credibilityWeight = Math.min(0.34, 0.2 + (verified ? 0.06 : 0) + (followers > 50000 ? 0.04 : 0));

      items.push({
        sourceType: "social",
        sourceName: `X/${profileLabel}`,
        url,
        publishedTs,
        fetchedTs: now,
        title: `UNVERIFIED X report: ${text.slice(0, 84)}`,
        summary: text,
        category,
        lat: place.lat,
        lon: place.lon,
        placeName: place.placeName,
        country: place.country,
        keywords: extractKeywords(text),
        credibilityWeight,
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
            public_metrics: author?.public_metrics,
          },
        },
        isGeoPrecise: place.isGeoPrecise,
        whatWeKnow: [
          "An unverified X post references a possible development.",
          `Engagement snapshot: ${likes} likes, ${reposts} reposts, ${replies} replies.`,
          verified ? "Author account is verified." : "Author verification status is unconfirmed.",
        ],
        whatWeDontKnow: [
          "Posts can include rumors, stale media, or context loss.",
          "Independent corroboration is required before treating as factual.",
        ],
      });
    }

    const deduped = new Map<string, NormalizedIngestItem>();
    for (const item of items) {
      const key = item.url ?? `${item.sourceName}:${item.title}:${item.publishedTs}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }

    return {
      items: [...deduped.values()].slice(0, 140),
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

function buildMockSocialItems(now: number): NormalizedIngestItem[] {
  const mockPosts = [
    {
      text: "Unverified posts mention loud blasts near Tehran industrial area.",
      author: "SocialMock",
      publishedAt: now - 8 * 60 * 1000,
    },
    {
      text: "Unverified chatter references temporary internet slowdown in Isfahan.",
      author: "SocialMock",
      publishedAt: now - 11 * 60 * 1000,
    },
    {
      text: "Unverified claims discuss drone activity near Tabriz outskirts.",
      author: "SocialMock",
      publishedAt: now - 14 * 60 * 1000,
    },
  ];

  return mockPosts.map((post) => {
    const place = derivePlace(post.text);
    const category = detectCategoryFromText(post.text) as EventCategory;

    return {
      sourceType: "social",
      sourceName: post.author,
      url: undefined,
      publishedTs: post.publishedAt,
      fetchedTs: now,
      title: `UNVERIFIED social report: ${post.text.slice(0, 84)}`,
      summary: post.text,
      category,
      lat: place.lat,
      lon: place.lon,
      placeName: place.placeName,
      country: place.country,
      keywords: extractKeywords(post.text),
      credibilityWeight: 0.2,
      rawJson: post as unknown as Record<string, unknown>,
      isGeoPrecise: place.isGeoPrecise,
      whatWeKnow: ["An unverified social post references a possible development."],
      whatWeDontKnow: [
        "Content is synthetic fallback data, not direct platform ingestion.",
        "Independent corroboration is required before treating as factual.",
      ],
    };
  });
}

async function fetchRedditItems(now: number): Promise<{
  items: NormalizedIngestItem[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const items: NormalizedIngestItem[] = [];

  const runs = await Promise.allSettled(
    REDDIT_QUERIES.map(async (query) => {
      const url = new URL("https://www.reddit.com/search.json");
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", "70");
      url.searchParams.set("t", "day");

      const payload = await fetchJson<RedditSearchResponse>(url.toString(), {
        headers: {
          "User-Agent": "conflict-tracker/1.0",
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

      const place = derivePlace(summaryRaw);
      const category = detectCategoryFromText(summaryRaw) as EventCategory;
      const url = post.permalink ? `https://www.reddit.com${post.permalink}` : undefined;
      const publishedTs =
        typeof post.created_utc === "number" ? Math.round(post.created_utc * 1000) : now;

      items.push({
        sourceType: "social",
        sourceName: `Reddit/r/${post.subreddit ?? "all"}`,
        url,
        publishedTs,
        fetchedTs: now,
        title: `UNVERIFIED social report: ${post.title.slice(0, 84)}`,
        summary: summaryRaw,
        category,
        lat: place.lat,
        lon: place.lon,
        placeName: place.placeName,
        country: place.country,
        keywords: extractKeywords(summaryRaw),
        credibilityWeight: 0.24,
        rawJson: {
          source: "reddit",
          subreddit: post.subreddit,
          author: post.author,
          score: post.score ?? 0,
          num_comments: post.num_comments ?? 0,
          permalink: post.permalink,
        },
        isGeoPrecise: place.isGeoPrecise,
        whatWeKnow: [
          "An unverified social post references a possible development.",
          `Engagement snapshot: score ${post.score ?? 0}, comments ${post.num_comments ?? 0}.`,
        ],
        whatWeDontKnow: [
          "Social posts may contain rumors, misattribution, or recycled footage.",
          "Independent corroboration is required before treating as factual.",
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

  return (payload.posts ?? [])
    .map((post) => {
      const text = post.text?.trim();
      if (!text) {
        return null;
      }

      const place = derivePlace(text);
      const category = detectCategoryFromText(text) as EventCategory;

      return {
        sourceType: "social",
        sourceName: post.author ?? "SocialFeed",
        url: post.url,
        publishedTs: parseTimestamp(post.publishedAt, now),
        fetchedTs: now,
        title: `Unverified social report: ${text.slice(0, 84)}`,
        summary: text,
        category,
        lat: place.lat,
        lon: place.lon,
        placeName: place.placeName,
        country: place.country,
        keywords: extractKeywords(text),
        credibilityWeight: 0.28,
        rawJson: post as unknown as Record<string, unknown>,
        isGeoPrecise: place.isGeoPrecise,
        whatWeKnow: ["A social media post mentions a possible incident."],
        whatWeDontKnow: [
          "This report is unverified and may be inaccurate.",
          "Independent corroboration is required before treating as factual.",
        ],
      };
    })
    .filter(Boolean) as NormalizedIngestItem[];
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

  const endpoint = process.env.SOCIAL_FEED_ENDPOINT;
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

  if (items.length === 0) {
    items.push(...buildMockSocialItems(now));
    warnings.push(
      "No social API records available; emitting mock UNVERIFIED social items for pipeline continuity.",
    );
  }

  return { items, warnings };
}
