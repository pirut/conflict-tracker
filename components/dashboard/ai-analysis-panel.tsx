"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, LoaderCircle } from "lucide-react";
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
  language?: string;
};

const DEFAULT_ANALYSIS_MIN_REFRESH_MINUTES = 35;
const analysisRefreshMinutesRaw = Number(
  process.env.NEXT_PUBLIC_ANALYSIS_MIN_REFRESH_MINUTES ?? DEFAULT_ANALYSIS_MIN_REFRESH_MINUTES,
);
const ANALYSIS_MIN_REFRESH_MINUTES = Number.isFinite(analysisRefreshMinutesRaw)
  ? Math.max(5, Math.round(analysisRefreshMinutesRaw))
  : DEFAULT_ANALYSIS_MIN_REFRESH_MINUTES;
const ANALYSIS_MIN_REFRESH_MS = ANALYSIS_MIN_REFRESH_MINUTES * 60 * 1000;

export function AIAnalysisPanel({
  events,
  connectivitySignals,
  flightSignals,
  firmsSignals,
  language = "en",
}: AIAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisShape | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<"ai" | "fallback" | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);

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
      setModel(null);
      setError(null);
      setLoading(false);
      return;
    }

    const hasRecentAnalysis =
      generatedAt !== null && analysis !== null && Date.now() - generatedAt < ANALYSIS_MIN_REFRESH_MS;

    if (!manualRefreshPending && hasRecentAnalysis) {
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
          model?: string;
          error?: string;
        };

        if (!json.analysis) {
          throw new Error("Analysis payload was empty.");
        }

        setAnalysis(json.analysis);
        setGeneratedAt(json.generatedAt ?? Date.now());
        setMode(json.mode ?? null);
        setModel(json.model ?? null);

        if (json.error) {
          setError(json.error);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
        if (manualRefreshPending) {
          setManualRefreshPending(false);
        }
      }
    }, 450);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [events.length, payloadKey, generatedAt, analysis, manualRefreshPending]);

  return (
    <section className="monitor-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6f6f85]">
          <Bot className="h-4 w-4" /> AI Executive Brief
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6f6f85]">
          <button
            type="button"
            onClick={() => setManualRefreshPending(true)}
            disabled={loading || events.length === 0}
            className="rounded-full border border-[#dcd5c8] bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#59596f] transition hover:border-[#9f8a59] disabled:cursor-not-allowed disabled:opacity-60"
          >
            refresh now
          </button>
          <span className="rounded-full border border-[#e4e0d5] px-2 py-1">
            auto refresh {ANALYSIS_MIN_REFRESH_MINUTES}m
          </span>
          {loading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e4e0d5] px-2 py-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> updating
            </span>
          ) : null}
          {mode ? (
            <span className="rounded-full border border-[#e4e0d5] px-2 py-1">mode: {mode}</span>
          ) : null}
          {model ? (
            <span className="rounded-full border border-[#e4e0d5] px-2 py-1">model: {model}</span>
          ) : null}
          {generatedAt ? (
            <span className="rounded-full border border-[#e4e0d5] px-2 py-1">updated {formatAgo(generatedAt)}</span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 rounded-lg border border-[#f1c8b5] bg-[#fff2ea] px-3 py-2 text-xs text-[#8a4123]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}

      {!analysis ? (
        <p className="mt-4 text-sm text-[#57576d]">
          {loading ? "Generating conflict brief..." : "AI brief appears after events are loaded."}
        </p>
      ) : (
        <>
          <h2 className="mt-4 text-lg font-semibold text-[#1a1b25]">{analysis.headline}</h2>
          <p className="mt-2 text-sm text-[#34344a]">{analysis.executiveSummary}</p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-[#ece7dc] bg-[#fcfaf5] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Key Developments</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[#2a2a3a]">
                {analysis.keyDevelopments.map((row) => (
                  <li key={row}>- {row}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-[#ece7dc] bg-[#fcfaf5] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Assessed Risks</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[#2a2a3a]">
                {analysis.assessedRisks.map((row) => (
                  <li key={row}>- {row}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-[#ece7dc] bg-[#fcfaf5] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Monitoring Gaps</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[#2a2a3a]">
                {analysis.monitoringGaps.map((row) => (
                  <li key={row}>- {row}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-[#ece7dc] bg-[#fcfaf5] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Recommended Checks</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[#2a2a3a]">
                {analysis.recommendedChecks.map((row) => (
                  <li key={row}>- {row}</li>
                ))}
              </ul>
            </article>
          </div>

          <p className="mt-4 rounded-lg border border-[#ece7dc] bg-white px-3 py-2 text-xs text-[#57576d]">
            {analysis.confidenceNote}
          </p>
        </>
      )}
    </section>
  );
}
