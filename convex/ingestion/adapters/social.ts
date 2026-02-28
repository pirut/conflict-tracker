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

const REDDIT_QUERIES = [
  "iran tehran isfahan natanz qom tabriz strike explosion missile drone air defense",
  "iran connectivity outage internet shutdown flights disruption",
];

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
      country: "Iran",
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
        country: "Iran",
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
        country: "Iran",
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

  if (items.length === 0) {
    items.push(...buildMockSocialItems(now));
    warnings.push(
      "No social API records available; emitting mock UNVERIFIED social items for pipeline continuity.",
    );
  }

  return { items, warnings };
}
