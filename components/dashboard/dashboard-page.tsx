"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Gauge,
  Globe,
  Radar,
  Radio,
  RefreshCcw,
  ShieldAlert,
  Signal,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatAgo, shortNumber } from "@/lib/format";
import { DashboardEvent, SignalRecord } from "@/lib/types";
import { AIAnalysisPanel } from "./ai-analysis-panel";
import { MapPanel } from "./map-panel";

type MonitorFilters = {
  timeRangeHours: number;
  minConfidence: number;
  q: string;
  includeSocial: boolean;
};

const DEFAULT_FILTERS: MonitorFilters = {
  timeRangeHours: 24,
  minConfidence: 45,
  q: "",
  includeSocial: true,
};

const TIME_WINDOWS = [
  { label: "1h", value: 1 },
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "72h", value: 72 },
  { label: "7d", value: 24 * 7 },
] as const;

function usIranSignalScore(event: DashboardEvent): number {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  const usTerms = ["united states", "u.s.", "pentagon", "centcom", "american"];
  const iranTerms = ["iran", "tehran", "isfahan", "natanz", "qom", "tabriz"];
  const strikeTerms = ["strike", "airstrike", "attack", "missile", "drone", "retaliat", "explosion"];

  const count = (terms: string[]) => terms.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
  const us = count(usTerms);
  const iran = count(iranTerms);
  const strike = count(strikeTerms);

  return us * 3 + iran * 2 + strike * 2 + (us > 0 && iran > 0 ? 4 : 0);
}

function priorityScore(event: DashboardEvent): number {
  const ageHours = Math.max(0, (Date.now() - event.eventTs) / (60 * 60 * 1000));
  const recency = Math.max(0, 30 - ageHours * 2.4);
  const corroboration = Math.min(16, event.sources.length * 3);
  const sourceSpread = event.sourceTypes.length * 6;
  const focus = usIranSignalScore(event) * 3.5;

  return event.confidence * 0.65 + recency + corroboration + sourceSpread + focus;
}

function confidenceTone(label: string) {
  if (label === "High") return "bg-[#deefd8] text-[#245b1f] border-[#badca9]";
  if (label === "Medium") return "bg-[#fff1cf] text-[#7f5d0f] border-[#e5d39a]";
  return "bg-[#ffe2dd] text-[#8b3126] border-[#efb8ae]";
}

function topSourceDomains(events: DashboardEvent[]): Array<{ host: string; count: number }> {
  const counts = new Map<string, number>();

  for (const event of events) {
    for (const source of event.sources) {
      if (!source.url) continue;
      try {
        const host = new URL(source.url).hostname.replace(/^www\./, "").toLowerCase();
        counts.set(host, (counts.get(host) ?? 0) + 1);
      } catch {
        continue;
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([host, count]) => ({ host, count }));
}

function numberFromSignal(signal: SignalRecord | undefined, key: string): number | null {
  if (!signal) return null;
  const value = Number(signal.payload?.[key]);
  return Number.isFinite(value) ? value : null;
}

function clip(text: string, maxChars = 260): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

export function DashboardPage() {
  const [filters, setFilters] = useState<MonitorFilters>(DEFAULT_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [feedLimit, setFeedLimit] = useState<number>(30);

  const activeTypes = filters.includeSocial ? undefined : (["news", "signals"] as const);

  const eventsQuery = useQuery(api.events.getEvents, {
    timeRangeHours: filters.timeRangeHours,
    minConfidence: filters.minConfidence,
    q: filters.q.trim() || undefined,
    types: activeTypes as never,
  }) as DashboardEvent[] | undefined;

  const stats = useQuery(api.events.getStats, {});

  const connectivitySignalsQuery = useQuery(api.events.getSignals, {
    type: "connectivity",
  }) as SignalRecord[] | undefined;

  const flightSignalsQuery = useQuery(api.events.getSignals, {
    type: "flight",
  }) as SignalRecord[] | undefined;

  const firmsSignalsQuery = useQuery(api.events.getSignals, {
    type: "firms",
  }) as SignalRecord[] | undefined;

  const events = useMemo(() => eventsQuery ?? [], [eventsQuery]);

  const prioritizedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const score = priorityScore(b) - priorityScore(a);
      return score || b.confidence - a.confidence || b.eventTs - a.eventTs;
    });
  }, [events]);

  const connectivitySignals = useMemo(
    () => connectivitySignalsQuery ?? [],
    [connectivitySignalsQuery],
  );
  const flightSignals = useMemo(() => flightSignalsQuery ?? [], [flightSignalsQuery]);
  const firmsSignals = useMemo(() => firmsSignalsQuery ?? [], [firmsSignalsQuery]);

  const highConfidenceCount = useMemo(
    () => prioritizedEvents.filter((event) => event.confidence >= 75).length,
    [prioritizedEvents],
  );

  const usIranDirectCount = useMemo(
    () => prioritizedEvents.filter((event) => usIranSignalScore(event) >= 8).length,
    [prioritizedEvents],
  );

  const mostRecentEventTs = prioritizedEvents[0]?.eventTs;
  const selectedEvent = useMemo(
    () => prioritizedEvents.find((event) => event._id === selectedEventId) ?? null,
    [prioritizedEvents, selectedEventId],
  );

  const dominantDomains = useMemo(() => topSourceDomains(prioritizedEvents), [prioritizedEvents]);
  const socialCount = useMemo(
    () => prioritizedEvents.filter((event) => event.sourceTypes.includes("social")).length,
    [prioritizedEvents],
  );
  const directRecentCount = useMemo(
    () => {
      const referenceTs = prioritizedEvents[0]?.eventTs;
      if (!referenceTs) {
        return 0;
      }
      return prioritizedEvents.filter(
        (event) => usIranSignalScore(event) >= 8 && referenceTs - event.eventTs <= 6 * 60 * 60 * 1000,
      ).length;
    },
    [prioritizedEvents],
  );

  const latestConnectivity = connectivitySignals[0];
  const latestFlight = flightSignals[0];
  const latestFirms = firmsSignals[0];

  const latestConnectivityPct = numberFromSignal(latestConnectivity, "availabilityPct");
  const latestFlightCount = numberFromSignal(latestFlight, "count");
  const latestFirmsBrightness = numberFromSignal(latestFirms, "brightness");

  return (
    <main className="monitor-shell min-h-screen px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
      <section className="monitor-hero monitor-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#d9d2c1] bg-[#f8f3e8] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f4b2a]">
              <Radar className="h-3.5 w-3.5" /> Conflict Tracker v2
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-[#1a1b25] sm:text-3xl">
              US-Iran Conflict Intelligence Desk
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#36364a] sm:text-base">
              High-signal aggregation of trusted news, technical indicators, and optional social signals for the
              current US-Iran conflict cycle. Synthetic records are disabled.
            </p>
          </div>

          <div className="grid gap-2 text-xs text-[#4f4f63]">
            <p className="inline-flex items-center gap-2 rounded-lg border border-[#ddd8cb] bg-white px-3 py-2">
              <RefreshCcw className="h-3.5 w-3.5" /> live Convex subscriptions
            </p>
            <p className="inline-flex items-center gap-2 rounded-lg border border-[#ddd8cb] bg-white px-3 py-2">
              <ShieldAlert className="h-3.5 w-3.5" /> strict trust filter active
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <article className="monitor-metric">
            <p>Events In Window</p>
            <strong>{stats ? shortNumber(stats.totalEvents24h) : "..."}</strong>
          </article>
          <article className="monitor-metric">
            <p>High Confidence</p>
            <strong>{highConfidenceCount}</strong>
          </article>
          <article className="monitor-metric">
            <p>US-Iran Direct</p>
            <strong>{usIranDirectCount}</strong>
          </article>
          <article className="monitor-metric">
            <p>Latest Update</p>
            <strong>{mostRecentEventTs ? formatAgo(mostRecentEventTs) : "..."}</strong>
          </article>
        </div>
      </section>

      <section className="monitor-card mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {TIME_WINDOWS.map((window) => (
              <button
                key={window.value}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, timeRangeHours: window.value }))}
                className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide transition ${
                  filters.timeRangeHours === window.value
                    ? "border-[#1f202f] bg-[#1f202f] text-white"
                    : "border-[#d5d0c4] bg-white text-[#3f4055] hover:border-[#8a7a53]"
                }`}
              >
                {window.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[#4d4e62]">
            <input
              type="checkbox"
              checked={filters.includeSocial}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  includeSocial: event.target.checked,
                }))
              }
            />
            include unverified social signals
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="text-xs text-[#58586e]">
            <span className="mb-1 block font-semibold uppercase tracking-[0.14em]">Search</span>
            <input
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              placeholder="keyword, location, actor"
              className="w-full rounded-lg border border-[#d8d2c5] bg-white px-3 py-2 text-sm text-[#1f2031] outline-none transition focus:border-[#947b45]"
            />
          </label>

          <label className="text-xs text-[#58586e]">
            <span className="mb-1 block font-semibold uppercase tracking-[0.14em]">Min Confidence</span>
            <input
              type="range"
              min={0}
              max={100}
              value={filters.minConfidence}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, minConfidence: Number(event.target.value) }))
              }
              className="w-full"
            />
            <span className="font-mono text-xs text-[#3f4055]">{filters.minConfidence}+</span>
          </label>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <article className="monitor-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Direct Signals (6h)</p>
          <p className="mt-2 text-2xl font-semibold text-[#1a1b25]">{directRecentCount}</p>
          <p className="mt-1 text-xs text-[#5a5a6f]">US-linked and Iran-linked strike clusters in the last six hours.</p>
        </article>
        <article className="monitor-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Social Footprint</p>
          <p className="mt-2 text-2xl font-semibold text-[#1a1b25]">{socialCount}</p>
          <p className="mt-1 text-xs text-[#5a5a6f]">Rows with social source type currently visible in this window.</p>
        </article>
        <article className="monitor-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Feed Density</p>
          <p className="mt-2 text-2xl font-semibold text-[#1a1b25]">{feedLimit}</p>
          <p className="mt-1 text-xs text-[#5a5a6f]">Priority rows rendered at once for quick scanning.</p>
        </article>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <AIAnalysisPanel
            events={prioritizedEvents}
            connectivitySignals={connectivitySignals}
            flightSignals={flightSignals}
            firmsSignals={firmsSignals}
            language="en"
          />

          <div className="monitor-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Priority Feed</h2>
              <div className="flex items-center gap-2">
                {[20, 30, 50].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFeedLimit(value)}
                    className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                      feedLimit === value
                        ? "border-[#1f202f] bg-[#1f202f] text-white"
                        : "border-[#d7d1c3] bg-white text-[#4f4f64] hover:border-[#8a7a53]"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-2 text-xs text-[#626277]">
              Sorted by confidence, recency, and US-Iran signal strength. Select one row to expand evidence and focus it on the map.
            </p>

            <div className="mt-3 space-y-3">
              {prioritizedEvents.length === 0 ? (
                <p className="rounded-lg border border-[#e4e0d5] bg-[#faf8f2] px-3 py-2 text-sm text-[#636379]">
                  No events matched current filters.
                </p>
              ) : (
                prioritizedEvents.slice(0, feedLimit).map((event, index) => {
                  const isSelected = selectedEvent?._id === event._id;
                  return (
                    <article
                      key={event._id}
                      className={`rounded-xl border p-3 transition ${
                        isSelected
                          ? "border-[#8d7645] bg-[#fffaf0] shadow-[0_6px_20px_rgba(95,78,41,0.13)]"
                          : "border-[#e7e2d7] bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6e6e83]">
                            #{index + 1} priority • {event.placeName}
                          </p>
                          <h3 className="mt-1 text-base font-semibold text-[#1c1d2a]">{event.title}</h3>
                          <p className="mt-1 text-xs text-[#6a6a7f]">
                            {event.category.replace(/_/g, " ")} • {formatAgo(event.eventTs)} • {event.sources.length} sources
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${confidenceTone(event.confidenceLabel)}`}
                          >
                            {event.confidenceLabel} {Math.round(event.confidence)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedEventId(event._id)}
                            className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                              isSelected
                                ? "border-[#7f6739] bg-[#7f6739] text-white"
                                : "border-[#d7d1c3] bg-white text-[#4f4f64] hover:border-[#8a7a53]"
                            }`}
                          >
                            {isSelected ? "Focused" : "Focus"}
                          </button>
                        </div>
                      </div>

                      <p className="mt-2 text-sm text-[#323347]">{clip(event.summary)}</p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {event.sourceTypes.map((type) => (
                          <span
                            key={type}
                            className="rounded-full border border-[#d8d2c5] bg-[#f7f4ec] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#655a45]"
                          >
                            {type}
                          </span>
                        ))}
                        <span className="rounded-full border border-[#ddd7ca] bg-[#faf8f2] px-2 py-0.5 text-[11px] font-semibold text-[#5a4b2b]">
                          score {Math.round(priorityScore(event))}
                        </span>
                      </div>

                      {isSelected ? (
                        <div className="mt-3 rounded-lg border border-[#ece7dc] bg-[#fcfaf5] p-3 text-sm text-[#333349]">
                          {event.whatWeKnow.length > 0 ? (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6f6f85]">What We Know</p>
                              <ul className="mt-1 space-y-1">
                                {event.whatWeKnow.map((line) => (
                                  <li key={line}>- {line}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {event.whatWeDontKnow.length > 0 ? (
                            <div className="mt-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6f6f85]">
                                What We Don&apos;t Know
                              </p>
                              <ul className="mt-1 space-y-1">
                                {event.whatWeDontKnow.map((line) => (
                                  <li key={line}>- {line}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {event.sources.length > 0 ? (
                            <div className="mt-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6f6f85]">Sources</p>
                              <ul className="mt-1 space-y-1">
                                {event.sources.slice(0, 8).map((source) => (
                                  <li key={source._id} className="text-sm">
                                    {source.url ? (
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[#2d4a89] underline decoration-[#98a8ca] underline-offset-2"
                                      >
                                        {source.sourceName}
                                      </a>
                                    ) : (
                                      <span>{source.sourceName}</span>
                                    )}{" "}
                                    ({source.sourceType}, {formatAgo(source.publishedTs)})
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-5 xl:sticky xl:top-4 xl:self-start">
          <MapPanel
            events={prioritizedEvents}
            selectedEvent={selectedEvent}
            onSelectEvent={(event) => setSelectedEventId(event._id)}
            onCloseDrawer={() => setSelectedEventId(null)}
            translateText={(text) => text}
            labels={{
              confidenceMap: "Conflict Map",
              eventDetail: "Event Detail",
              whatWeKnow: "What We Know",
              whatWeDontKnow: "What We Don't Know",
              sourceLinks: "Source Links",
            }}
          />

          <aside className="monitor-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Signals Board</h2>

            <div className="mt-3 space-y-3 text-sm text-[#2f3042]">
              <div className="rounded-xl border border-[#e7e2d7] bg-[#fcfaf5] p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#66667a]">
                  <Signal className="h-4 w-4" /> Connectivity
                </p>
                <p className="mt-2 text-sm">
                  {latestConnectivityPct !== null
                    ? `${latestConnectivityPct.toFixed(1)}% availability estimate`
                    : "No recent connectivity sample"}
                </p>
                <p className="mt-1 text-xs text-[#66667a]">
                  {latestConnectivity ? formatAgo(latestConnectivity.createdAt) : "-"}
                </p>
              </div>

              <div className="rounded-xl border border-[#e7e2d7] bg-[#fcfaf5] p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#66667a]">
                  <Radio className="h-4 w-4" /> Flight
                </p>
                <p className="mt-2 text-sm">
                  {latestFlightCount !== null ? `${Math.round(latestFlightCount)} tracked aircraft` : "No recent flight sample"}
                </p>
                <p className="mt-1 text-xs text-[#66667a]">{latestFlight ? formatAgo(latestFlight.createdAt) : "-"}</p>
              </div>

              <div className="rounded-xl border border-[#e7e2d7] bg-[#fcfaf5] p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#66667a]">
                  <Gauge className="h-4 w-4" /> FIRMS Thermal
                </p>
                <p className="mt-2 text-sm">
                  {latestFirmsBrightness !== null
                    ? `latest brightness index ${Math.round(latestFirmsBrightness)}`
                    : "No recent FIRMS hotspot sample"}
                </p>
                <p className="mt-1 text-xs text-[#66667a]">{latestFirms ? formatAgo(latestFirms.createdAt) : "-"}</p>
              </div>
            </div>
          </aside>

          <aside className="monitor-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6f6f85]">Source Radar</h2>

            <div className="mt-3 space-y-2 text-sm text-[#2f3042]">
              {dominantDomains.length === 0 ? (
                <p className="rounded-lg border border-[#e4e0d5] bg-[#faf8f2] px-3 py-2 text-sm text-[#636379]">
                  No source links available in current window.
                </p>
              ) : (
                dominantDomains.map((item) => (
                  <p key={item.host} className="flex items-center justify-between rounded-lg border border-[#e7e2d7] bg-[#fcfaf5] px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-[#7a7a91]" /> {item.host}
                    </span>
                    <span className="font-mono text-xs">{item.count}</span>
                  </p>
                ))
              )}
            </div>

            {stats?.latestIngestRuns?.length ? (
              <div className="mt-4 rounded-xl border border-[#e7e2d7] bg-[#fffdf9] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#66667a]">Ingestion Health</p>
                <ul className="mt-2 space-y-1.5 text-sm text-[#2f3042]">
                  {(stats.latestIngestRuns as Array<{ _id: string; sourceName: string; status: string; startedAt: number; error?: string | null }>).slice(0, 6).map((run) => (
                    <li key={run._id}>
                      <span className="font-semibold">{run.sourceName}</span>: {run.status} ({formatAgo(run.startedAt)})
                      {run.error ? (
                        <span className="mt-1 block rounded border border-[#f1c8b5] bg-[#fff2ea] px-2 py-1 text-xs text-[#8a4123]">
                          <AlertTriangle className="mr-1 inline h-3 w-3" /> {run.error}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
