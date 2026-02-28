"use node";

import { extractKeywords } from "../../lib/categorize";
import { EventCategory } from "../../types";
import { AdapterContext, IngestionAdapterResult, NormalizedIngestItem } from "../types";
import { derivePlace, detectCategoryFromText, fetchJson, parseTimestamp } from "./shared";

type SocialPayload = {
  posts?: Array<{
    text?: string;
    url?: string;
    publishedAt?: string;
    author?: string;
  }>;
};

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

export async function fetchSocialReports(
  context: AdapterContext,
): Promise<IngestionAdapterResult> {
  const now = context.now;

  if ((process.env.ENABLE_SOCIAL_INGESTION ?? "false") !== "true") {
    return {
      items: [],
      warnings: ["Social adapter disabled. Set ENABLE_SOCIAL_INGESTION=true to enable."],
    };
  }

  const endpoint = process.env.SOCIAL_FEED_ENDPOINT;
  if (!endpoint) {
    return {
      items: buildMockSocialItems(now),
      warnings: [
        "ENABLE_SOCIAL_INGESTION=true but SOCIAL_FEED_ENDPOINT is missing. Emitting mock UNVERIFIED social items.",
      ],
    };
  }

  try {
    const payload = await fetchJson<SocialPayload>(endpoint, {
      headers:
        process.env.SOCIAL_FEED_TOKEN
          ? { Authorization: `Bearer ${process.env.SOCIAL_FEED_TOKEN}` }
          : undefined,
    });

    const items = (payload.posts ?? [])
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

    return { items, warnings: [] };
  } catch (error) {
    return {
      items: [],
      warnings: [`Social adapter fetch failed: ${(error as Error).message}`],
    };
  }
}
