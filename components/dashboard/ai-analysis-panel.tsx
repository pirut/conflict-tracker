"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAgo } from "@/lib/format";
import { DashboardEvent, SignalRecord } from "@/lib/types";

type AnalysisShape = {
  headline: string;
  executiveSummary: string;
  keyDevelopments: string[];
  assessedRisks: string[];
  monitoringGaps: string[];
  recommendedChecks: string[];
  confidenceNote: string;
};

type AIAnalysisPanelProps = {
  events: DashboardEvent[];
  connectivitySignals: SignalRecord[];
  flightSignals: SignalRecord[];
  firmsSignals: SignalRecord[];
  language: string;
  translateText: (text: string) => string;
};

export function AIAnalysisPanel({
  events,
  connectivitySignals,
  flightSignals,
  firmsSignals,
  language,
  translateText,
}: AIAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisShape | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<"ai" | "fallback" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => {
    return {
      language,
      events: events.slice(0, 35).map((event) => ({
        title: event.title,
        summary: event.summary,
        category: event.category,
        confidence: event.confidence,
        confidenceLabel: event.confidenceLabel,
        placeName: event.placeName,
        eventTs: event.eventTs,
        sourceTypes: event.sourceTypes,
        whatWeKnow: event.whatWeKnow.slice(0, 3),
        whatWeDontKnow: event.whatWeDontKnow.slice(0, 3),
      })),
      signals: {
        connectivity: connectivitySignals.slice(0, 40).map((row) => ({
          createdAt: row.createdAt,
          region: String(row.payload?.region ?? "Iran"),
          availabilityPct: Number(row.payload?.availabilityPct ?? 0),
          provider: String(row.payload?.provider ?? row.payload?.sourceName ?? "unknown"),
        })),
        flight: flightSignals.slice(0, 40).map((row) => ({
          createdAt: row.createdAt,
          city: String(row.payload?.city ?? row.payload?.region ?? "Iran"),
          count: Number(row.payload?.count ?? 0),
          anomaly: Boolean(row.payload?.anomaly),
          dropPct: Number(row.payload?.dropPct ?? 0),
          provider: String(row.payload?.provider ?? row.payload?.sourceName ?? "unknown"),
        })),
        firms: firmsSignals.slice(0, 40).map((row) => ({
          createdAt: row.createdAt,
          region: String(row.payload?.region ?? "Iran"),
          brightness: Number(row.payload?.brightness ?? row.payload?.bright_ti4 ?? 0),
        })),
      },
    };
  }, [events, connectivitySignals, flightSignals, firmsSignals, language]);

  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);

  useEffect(() => {
    if (events.length === 0) {
      setAnalysis(null);
      setGeneratedAt(null);
      setMode(null);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadKey,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = (await response.json()) as {
          analysis?: AnalysisShape;
          generatedAt?: number;
          mode?: "ai" | "fallback";
        };

        if (json.analysis) {
          setAnalysis(json.analysis);
          setGeneratedAt(json.generatedAt ?? Date.now());
          setMode(json.mode ?? null);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [events.length, payloadKey]);

  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {translateText("AI Situation Analysis")}
        </h2>
        <p className="text-xs text-slate-500">
          {mode ? `${translateText("Mode")}: ${mode}` : loading ? translateText("Updating...") : ""}
        </p>
      </div>

      {error ? (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {translateText("Analysis error")}: {error}
        </p>
      ) : null}

      {!analysis ? (
        <p className="mt-2 text-sm text-slate-500">
          {loading
            ? translateText("Generating AI briefing...")
            : translateText("AI briefing will appear when event data is available.")}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="space-y-3 lg:col-span-2">
            <p className="text-base font-semibold text-slate-900">{analysis.headline}</p>
            <p className="text-sm text-slate-700">{analysis.executiveSummary}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {translateText("Key Developments")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {analysis.keyDevelopments.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {translateText("Assessed Risks")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {analysis.assessedRisks.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {translateText("Monitoring Gaps")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {analysis.monitoringGaps.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {translateText("Recommended Checks")}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {analysis.recommendedChecks.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>{analysis.confidenceNote}</p>
            {generatedAt ? (
              <p className="mt-1 text-xs text-slate-500">
                {translateText("Updated")} {formatAgo(generatedAt)}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
