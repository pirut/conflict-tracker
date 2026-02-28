import { generateObject } from "ai";
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
      summary: (event.summary ?? "").slice(0, 500),
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

function fallbackAnalysis(payload: ReturnType<typeof sanitizeRequest>) {
  const topEvent = payload.events[0];
  const highConfidence = payload.events.filter((event) => event.confidence >= 75).length;
  const socialOnly = payload.events.filter(
    (event) =>
      event.sourceTypes.includes("social") &&
      !event.sourceTypes.includes("news") &&
      !event.sourceTypes.includes("signals"),
  ).length;
  const flightAnomalies = payload.flight.filter((row) => row.anomaly).length;
  const lowConnectivity = payload.connectivity.filter(
    (row) => Number(row.availabilityPct ?? 100) < 80,
  ).length;

  return {
    headline: topEvent
      ? `Live brief: ${topEvent.category.replace(/_/g, " ")} activity around ${topEvent.placeName}`
      : "Live brief: monitoring window active",
    executiveSummary:
      topEvent
        ? `${payload.events.length} events in scope, with ${highConfidence} high-confidence clusters. Latest focal point: ${topEvent.placeName}.`
        : "No event rows are currently available for AI synthesis.",
    keyDevelopments: [
      `${payload.events.length} events processed for this window.`,
      `${highConfidence} events are currently tagged high confidence.`,
      `${flightAnomalies} flight anomaly signals and ${lowConnectivity} low-connectivity rows are present.`,
    ],
    assessedRisks: [
      "Social-only claims remain high-noise and require corroboration.",
      "Short-lived signal anomalies may reflect sensor/coverage changes, not only on-ground incidents.",
      socialOnly > 0
        ? `${socialOnly} social-only events are active and should not be treated as confirmed facts.`
        : "Most active events are supported by at least one non-social signal or news source.",
    ],
    monitoringGaps: [
      "Ground-truth casualty and damage confirmation is often delayed.",
      "Coverage limitations can reduce flight/connectivity signal precision in local areas.",
      "Some data providers may throttle or delay updates during high-volume periods.",
    ],
    recommendedChecks: [
      "Track changes in high-confidence clusters over the next 30-60 minutes.",
      "Cross-check social-only claims against trusted news and signal corroboration.",
      "Verify whether connectivity and flight anomalies persist across multiple snapshots.",
    ],
    confidenceNote:
      "Automated fallback synthesis; use source links and confidence scoring for verification.",
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

  const model = process.env.AI_SUMMARY_MODEL ?? "openai/gpt-4.1-mini";

  try {
    const result = await generateObject({
      model,
      schema: analysisSchema,
      system:
        "You are an intelligence analyst for a live conflict monitoring dashboard. Be explicit about uncertainty, avoid speculation, and keep claims tied to provided inputs.",
      prompt: [
        `Write all output in language code: ${targetLang}.`,
        "Treat social-only claims as unverified.",
        "Prioritize operationally useful analysis over narrative writing.",
        "Data snapshot:",
        JSON.stringify(payload),
      ].join("\n"),
    });

    return NextResponse.json({
      analysis: result.object,
      generatedAt: Date.now(),
      mode: "ai",
      model,
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
