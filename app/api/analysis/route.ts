import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type AnalysisRequest = {
  language?: string;
  events?: Array<{
    title?: string;
    summary?: string;
    category?: string;
    confidence?: number;
    confidenceLabel?: string;
    placeName?: string;
    eventTs?: number;
    sourceTypes?: string[];
    whatWeKnow?: string[];
    whatWeDontKnow?: string[];
  }>;
  signals?: {
    connectivity?: Array<{
      createdAt?: number;
      region?: string;
      availabilityPct?: number;
      provider?: string;
    }>;
    flight?: Array<{
      createdAt?: number;
      city?: string;
      count?: number;
      anomaly?: boolean;
      dropPct?: number;
      provider?: string;
    }>;
    firms?: Array<{
      createdAt?: number;
      region?: string;
      brightness?: number;
    }>;
  };
};

const MAX_EVENTS = 35;
const MAX_SIGNAL_ROWS = 40;

const analysisSchema = z.object({
  headline: z.string(),
  executiveSummary: z.string(),
  keyDevelopments: z.array(z.string()).min(2).max(6),
  assessedRisks: z.array(z.string()).min(2).max(6),
  monitoringGaps: z.array(z.string()).min(2).max(6),
  recommendedChecks: z.array(z.string()).min(2).max(6),
  confidenceNote: z.string(),
});

type AnalysisShape = z.infer<typeof analysisSchema>;

const ROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

function normalizeLang(language?: string): string {
  if (!language) {
    return "en";
  }
  const normalized = language.trim().toLowerCase().split("-")[0];
  return normalized || "en";
}

function sanitizeRequest(body: AnalysisRequest) {
  const events = (body.events ?? [])
    .slice(0, MAX_EVENTS)
    .map((event) => ({
      title: (event.title ?? "").slice(0, 260),
      summary: (event.summary ?? "").slice(0, 520),
      category: event.category ?? "other",
      confidence: Number(event.confidence ?? 0),
      confidenceLabel: event.confidenceLabel ?? "Low",
      placeName: event.placeName ?? "Iran",
      eventTs: Number(event.eventTs ?? Date.now()),
      sourceTypes: (event.sourceTypes ?? []).slice(0, 4),
      whatWeKnow: (event.whatWeKnow ?? []).slice(0, 3),
      whatWeDontKnow: (event.whatWeDontKnow ?? []).slice(0, 3),
    }));

  const connectivity = (body.signals?.connectivity ?? []).slice(0, MAX_SIGNAL_ROWS);
  const flight = (body.signals?.flight ?? []).slice(0, MAX_SIGNAL_ROWS);
  const firms = (body.signals?.firms ?? []).slice(0, MAX_SIGNAL_ROWS);

  return { events, connectivity, flight, firms };
}

function usFocusScore(text: string): number {
  const normalized = text.toLowerCase();
  const usTerms = ["united states", "u.s.", "us ", "us-", "pentagon", "centcom", "american"];
  const iranTerms = ["iran", "tehran", "isfahan", "natanz", "qom", "tabriz"];
  const strikeTerms = ["strike", "airstrike", "attack", "missile", "drone", "bombardment", "retaliat"];

  const count = (terms: string[]) => terms.reduce((acc, term) => acc + (normalized.includes(term) ? 1 : 0), 0);

  const us = count(usTerms);
  const iran = count(iranTerms);
  const strike = count(strikeTerms);

  return us * 3 + iran * 2 + strike * 2 + (us > 0 && iran > 0 ? 3 : 0);
}

function isUSLinkedStrikeEvent(event: {
  title: string;
  summary: string;
  category: string;
}) {
  const merged = `${event.title} ${event.summary}`;
  const score = usFocusScore(merged);
  const strikeCategory = ["strike", "missile", "drone", "explosion", "air_defense", "military_base"].includes(
    event.category,
  );
  return score >= 6 && strikeCategory;
}

function fallbackAnalysis(payload: ReturnType<typeof sanitizeRequest>): AnalysisShape {
  const ranked = [...payload.events].sort((a, b) => {
    const aScore = usFocusScore(`${a.title} ${a.summary}`);
    const bScore = usFocusScore(`${b.title} ${b.summary}`);
    return bScore - aScore || b.confidence - a.confidence || b.eventTs - a.eventTs;
  });

  const topEvent = ranked[0];
  const highConfidence = payload.events.filter((event) => event.confidence >= 75).length;
  const usLinkedStrikeCount = payload.events.filter((event) =>
    isUSLinkedStrikeEvent({
      title: event.title,
      summary: event.summary,
      category: event.category,
    }),
  ).length;
  const socialOnly = payload.events.filter(
    (event) =>
      event.sourceTypes.includes("social") &&
      !event.sourceTypes.includes("news") &&
      !event.sourceTypes.includes("signals"),
  ).length;
  const flightAnomalies = payload.flight.filter((row) => row.anomaly).length;
  const lowConnectivity = payload.connectivity.filter((row) => Number(row.availabilityPct ?? 100) < 80).length;

  return {
    headline: topEvent
      ? `US-Iran brief: ${topEvent.category.replace(/_/g, " ")} activity around ${topEvent.placeName}`
      : "US-Iran brief: monitoring window active",
    executiveSummary: topEvent
      ? `${payload.events.length} events in scope, including ${usLinkedStrikeCount} US-linked strike clusters and ${highConfidence} high-confidence events.`
      : "No event rows are currently available for synthesis.",
    keyDevelopments: [
      `${payload.events.length} total events passed current filters.`,
      `${usLinkedStrikeCount} events match direct US-Iran strike criteria.`,
      `${highConfidence} events are tagged high confidence.`,
      `${flightAnomalies} flight anomaly signals and ${lowConnectivity} low-connectivity rows are active.`,
    ],
    assessedRisks: [
      "Social-only claims remain high-noise until independently corroborated.",
      "Single-snapshot anomalies can reflect sensor/coverage changes, not only on-ground disruption.",
      socialOnly > 0
        ? `${socialOnly} social-only events are active and should be treated as unverified.`
        : "Most events are supported by at least one non-social source.",
    ],
    monitoringGaps: [
      "Ground-truth casualty and damage confirmation is often delayed.",
      "Coverage limitations reduce local precision for flight and connectivity indicators.",
      "Provider throttling can delay updates during surge periods.",
    ],
    recommendedChecks: [
      "Track top US-linked clusters over the next 30-60 minutes.",
      "Cross-check social-only claims against trusted news and signal corroboration.",
      "Confirm whether anomalies persist across multiple snapshots before escalation calls.",
    ],
    confidenceNote: "Fallback synthesis generated locally without model inference.",
  };
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/```$/, "")
    .trim();
}

function extractJSONObject(input: string): string {
  const stripped = stripCodeFence(input);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not contain JSON object payload.");
  }

  return stripped.slice(start, end + 1);
}

async function callOpenRouter(
  payload: ReturnType<typeof sanitizeRequest>,
  language: string,
): Promise<{ analysis: AnalysisShape; model: string }> {
  const apiKey = process.env.OPEN_ROUTER_API?.trim();
  if (!apiKey) {
    throw new Error("OPEN_ROUTER_API is missing.");
  }

  const model = process.env.OPEN_ROUTER_MODEL?.trim() || "openai/gpt-4o-mini";
  const referer = process.env.OPEN_ROUTER_REFERER?.trim() || "http://localhost:3000";
  const title = process.env.OPEN_ROUTER_APP_NAME?.trim() || "Conflict Tracker";

  const body = {
    model,
    temperature: 0.15,
    top_p: 0.9,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an intelligence analyst for a live US-Iran conflict monitoring desk. Prioritize US-linked strikes, retaliatory actions, and direct military exchanges involving Iran. Be explicit about uncertainty. Return JSON only.",
      },
      {
        role: "user",
        content: [
          `Language code for all output: ${language}.`,
          "Treat social-only claims as unverified.",
          "Prioritize high-confidence and recently updated events.",
          "Return strictly this JSON shape: { headline, executiveSummary, keyDevelopments[2-6], assessedRisks[2-6], monitoringGaps[2-6], recommendedChecks[2-6], confidenceNote }.",
          "Data snapshot:",
          JSON.stringify(payload),
        ].join("\n"),
      },
    ],
  };

  const response = await fetch(ROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      "X-Title": title,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${message.slice(0, 260)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter response did not include message content.");
  }

  const parsedObject = JSON.parse(extractJSONObject(content));
  const analysis = analysisSchema.parse(parsedObject);

  return {
    analysis,
    model,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as AnalysisRequest;
  const targetLang = normalizeLang(body.language);
  const payload = sanitizeRequest(body);

  if (payload.events.length === 0) {
    return NextResponse.json({
      analysis: fallbackAnalysis(payload),
      generatedAt: Date.now(),
      mode: "fallback",
    });
  }

  try {
    const result = await callOpenRouter(payload, targetLang);

    return NextResponse.json({
      analysis: result.analysis,
      generatedAt: Date.now(),
      mode: "ai",
      model: result.model,
    });
  } catch (error) {
    return NextResponse.json({
      analysis: fallbackAnalysis(payload),
      generatedAt: Date.now(),
      mode: "fallback",
      error: (error as Error).message,
    });
  }
}
