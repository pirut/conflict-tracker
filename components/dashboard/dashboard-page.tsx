"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Layers3,
  MapPinned,
  Radar,
  RefreshCcw,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ActivityTier, buildFusionSnapshot, EvidenceKind } from "@/lib/fusion";
import { formatAgo, shortNumber } from "@/lib/format";
import { DashboardEvent, SignalRecord } from "@/lib/types";
import { MapPanel } from "./map-panel";

type MonitorFilters = {
  timeRangeHours: number;
  q: string;
  includeSocial: boolean;
  showWatch: boolean;
};

const DEFAULT_FILTERS: MonitorFilters = {
  timeRangeHours: 24,
  q: "",
  includeSocial: true,
  showWatch: false,
};

const DEFAULT_SIGNAL_LAYERS: Record<EvidenceKind, boolean> = {
  news: false,
  social: false,
  connectivity: true,
  flight: true,
  firms: true,
  satellite: true,
  power: true,
  seismic: true,
  other_signal: true,
};

const TIME_WINDOWS = [
  { label: "3h", value: 3 },
  { label: "12h", value: 12 },
  { label: "24h", value: 24 },
  { label: "72h", value: 72 },
  { label: "7d", value: 24 * 7 },
] as const;

const SIGNAL_LAYER_OPTIONS: Array<{ key: EvidenceKind; label: string }> = [
  { key: "seismic", label: "Seismic" },
  { key: "power", label: "Power" },
  { key: "satellite", label: "Satellite" },
  { key: "firms", label: "Thermal" },
  { key: "connectivity", label: "Connectivity" },
  { key: "flight", label: "Flight" },
  { key: "other_signal", label: "Other" },
];

function tierLabel(tier: ActivityTier): string {
  if (tier === "confirmed") return "100% happening";
  if (tier === "likely") return "likely happening";
  return "watch";
}

function tierClass(tier: ActivityTier): string {
  if (tier === "confirmed") return "border-[#e4a6af] bg-[#ffe8ec] text-[#7f1024]";
  if (tier === "likely") return "border-[#f2cf97] bg-[#fff4de] text-[#7a4a00]";
  return "border-[#c8d1d8] bg-[#eef2f5] text-[#334e63]";
}

function evidenceTags(evidence: Record<EvidenceKind, number>): string[] {
  return (Object.entries(evidence) as Array<[EvidenceKind, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => `${key.replace(/_/g, " ")} ${count}`);
}

export function DashboardPage() {
  const [filters, setFilters] = useState<MonitorFilters>(DEFAULT_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [layers, setLayers] = useState({
    showConfirmed: true,
    showLikely: true,
    showWatch: false,
    showSignals: true,
    showHotspots: true,
    signalKinds: DEFAULT_SIGNAL_LAYERS,
  });

  const activeTypes = filters.includeSocial ? undefined : (["news", "signals"] as const);

  const eventsQuery = useQuery(api.events.getEvents, {
    timeRangeHours: filters.timeRangeHours,
    minConfidence: 0,
    q: filters.q.trim() || undefined,
    types: activeTypes as never,
  }) as DashboardEvent[] | undefined;

  const signalsQuery = useQuery(api.events.getSignals, {}) as SignalRecord[] | undefined;

  const stats = useQuery(api.events.getStats, {});

  const events = useMemo(() => eventsQuery ?? [], [eventsQuery]);
  const signals = useMemo(() => {
    const rows = signalsQuery ?? [];
    const referenceTs = rows[0]?.createdAt ?? 0;
    const since = referenceTs - filters.timeRangeHours * 60 * 60 * 1000;
    return rows.filter((row) => row.createdAt >= since);
  }, [signalsQuery, filters.timeRangeHours]);

  const fusion = useMemo(() => buildFusionSnapshot(events, signals), [events, signals]);

  const assessedEvents = useMemo(
    () =>
      fusion.assessedEvents.filter((item) => {
        if (filters.showWatch) {
          return true;
        }
        return item.tier !== "watch";
      }),
    [fusion.assessedEvents, filters.showWatch],
  );

  const hotspots = useMemo(
    () =>
      fusion.hotspots.filter((item) => {
        if (filters.showWatch) {
          return true;
        }
        return item.tier !== "watch";
      }),
    [fusion.hotspots, filters.showWatch],
  );

  const selectedEvent = useMemo(
    () => assessedEvents.find((item) => item.event._id === selectedEventId)?.event ?? null,
    [assessedEvents, selectedEventId],
  );

  const confirmedEvents = useMemo(
    () => assessedEvents.filter((item) => item.confirmed),
    [assessedEvents],
  );
  const likelyEvents = useMemo(
    () => assessedEvents.filter((item) => item.tier === "likely"),
    [assessedEvents],
  );

  const confirmedHotspots = useMemo(
    () => hotspots.filter((hotspot) => hotspot.confirmed),
    [hotspots],
  );

  const likelyHotspots = useMemo(
    () => hotspots.filter((hotspot) => !hotspot.confirmed && hotspot.tier === "likely"),
    [hotspots],
  );

  const signalTypesSeen = useMemo(
    () => new Set(fusion.mapSignals.map((signal) => signal.evidenceKind)),
    [fusion.mapSignals],
  );

  const topSignals = useMemo(
    () => [...fusion.mapSignals].sort((a, b) => b.score - a.score).slice(0, 10),
    [fusion.mapSignals],
  );

  return (
    <main className="monitor-shell min-h-[100dvh] px-3 py-3 sm:px-5 sm:py-5 lg:px-7">
      <div className="mx-auto flex w-full max-w-[1660px] flex-col gap-3">
        <section className="monitor-card monitor-hero overflow-hidden p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#d6cfbf] bg-[#f7f3e6] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#5f4b2a]">
                <Radar className="h-3.5 w-3.5" /> Multi-Source Conflict Fusion Desk
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#161a2f] sm:text-[2rem]">
                Likely vs Confirmed Activity Map
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-[#3f445e] sm:text-base">
                Free-source-first monitoring that merges trusted news, social signals, satellite telemetry, seismic rows,
                connectivity, flight movement, and power-outage indicators into a single geospatial evidence model.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <article className="monitor-metric">
                <p>Confirmed Hotspots</p>
                <strong>{confirmedHotspots.length}</strong>
              </article>
              <article className="monitor-metric">
                <p>Likely Hotspots</p>
                <strong>{likelyHotspots.length}</strong>
              </article>
              <article className="monitor-metric">
                <p>Mapped Points</p>
                <strong>{shortNumber(assessedEvents.length + fusion.mapSignals.length)}</strong>
              </article>
              <article className="monitor-metric">
                <p>Signal Types Live</p>
                <strong>{signalTypesSeen.size}</strong>
              </article>
              <article className="monitor-metric">
                <p>Events in Window</p>
                <strong>{stats ? shortNumber(stats.totalEvents24h) : "..."}</strong>
              </article>
              <article className="monitor-metric">
                <p>Social Included</p>
                <strong>{filters.includeSocial ? "Yes" : "No"}</strong>
              </article>
            </div>
          </div>
        </section>

        <section className="monitor-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {TIME_WINDOWS.map((window) => (
                <button
                  key={window.value}
                  type="button"
                  onClick={() => setFilters((prev) => ({ ...prev, timeRangeHours: window.value }))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide transition ${
                    filters.timeRangeHours === window.value
                      ? "border-[#1f2031] bg-[#1f2031] text-white"
                      : "border-[#d5d0c4] bg-white text-[#3f4055] hover:border-[#8a7a53]"
                  }`}
                >
                  {window.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-[#4d4e62]">
              <label className="inline-flex items-center gap-2">
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
                include social (unverified)
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.showWatch}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      showWatch: event.target.checked,
                    }))
                  }
                />
                include watch-tier rows
              </label>
            </div>
          </div>

          <label className="mt-3 block text-xs text-[#595a70]">
            <span className="mb-1 inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]">
              <Search className="h-3.5 w-3.5" /> Search
            </span>
            <input
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              placeholder="city, capability, actor, target"
              className="w-full rounded-xl border border-[#d7d1c3] bg-white px-3 py-2 text-sm text-[#1f2031] outline-none transition focus:border-[#846938]"
            />
          </label>
        </section>

        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-12">
          <div className="min-h-0 space-y-3 xl:col-span-8">
            <MapPanel
              assessedEvents={assessedEvents.slice(0, 320)}
              mapSignals={fusion.mapSignals.slice(0, 520)}
              hotspots={hotspots.slice(0, 180)}
              layers={layers}
              selectedEvent={selectedEvent}
              onSelectEvent={(event) => setSelectedEventId(event._id)}
              onCloseDrawer={() => setSelectedEventId(null)}
              className="h-[58vh] min-h-[24rem]"
            />

            <aside className="monitor-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#676b81]">
                  <Layers3 className="h-4 w-4" /> Map Layers
                </h2>
                <div className="text-xs text-[#6a6e84]">Toggle what appears on map</div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layers.showHotspots}
                    onChange={(event) =>
                      setLayers((prev) => ({
                        ...prev,
                        showHotspots: event.target.checked,
                      }))
                    }
                  />
                  hotspot rings
                </label>
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layers.showSignals}
                    onChange={(event) =>
                      setLayers((prev) => ({
                        ...prev,
                        showSignals: event.target.checked,
                      }))
                    }
                  />
                  raw signal points
                </label>
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layers.showConfirmed}
                    onChange={(event) =>
                      setLayers((prev) => ({
                        ...prev,
                        showConfirmed: event.target.checked,
                      }))
                    }
                  />
                  confirmed events
                </label>
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layers.showLikely}
                    onChange={(event) =>
                      setLayers((prev) => ({
                        ...prev,
                        showLikely: event.target.checked,
                      }))
                    }
                  />
                  likely events
                </label>
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layers.showWatch}
                    onChange={(event) =>
                      setLayers((prev) => ({
                        ...prev,
                        showWatch: event.target.checked,
                      }))
                    }
                  />
                  watch events
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {SIGNAL_LAYER_OPTIONS.map((option) => (
                  <label key={option.key} className="inline-flex items-center gap-1.5 rounded-full border border-[#d4cec0] bg-[#f8f4ea] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5f4b2a]">
                    <input
                      type="checkbox"
                      checked={layers.signalKinds[option.key]}
                      onChange={(event) =>
                        setLayers((prev) => ({
                          ...prev,
                          signalKinds: {
                            ...prev.signalKinds,
                            [option.key]: event.target.checked,
                          },
                        }))
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </aside>
          </div>

          <div className="min-h-0 space-y-3 xl:col-span-4">
            <section className="monitor-card p-4">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#676b81]">
                <ShieldCheck className="h-4 w-4" /> Confirmed Activity (100%)
              </h2>

              <div className="mt-3 max-h-[24vh] space-y-2 overflow-y-auto pr-1">
                {confirmedEvents.length === 0 ? (
                  <p className="rounded-lg border border-[#e5decf] bg-[#fbf8f1] px-3 py-2 text-sm text-[#60657c]">
                    No rows currently meet the confirmed threshold.
                  </p>
                ) : (
                  confirmedEvents.slice(0, 8).map((item) => (
                    <article key={item.event._id} className="rounded-xl border border-[#e6d9cc] bg-[#fff6f8] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7e5661]">
                            {item.event.placeName} • {formatAgo(item.event.eventTs)}
                          </p>
                          <h3 className="mt-1 text-sm font-semibold text-[#1d2238]">{item.event.title}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedEventId(item.event._id)}
                          className="rounded-full border border-[#ceafb8] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f1024]"
                        >
                          focus
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {evidenceTags(item.evidence).map((tag) => (
                          <span
                            key={`${item.event._id}-${tag}`}
                            className="rounded-full border border-[#e0c7ce] bg-[#fff0f3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7f1024]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="monitor-card p-4">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#676b81]">
                <MapPinned className="h-4 w-4" /> Likely Activity
              </h2>

              <div className="mt-3 max-h-[24vh] space-y-2 overflow-y-auto pr-1">
                {likelyEvents.length === 0 ? (
                  <p className="rounded-lg border border-[#e5decf] bg-[#fbf8f1] px-3 py-2 text-sm text-[#60657c]">
                    No likely rows in the current filter window.
                  </p>
                ) : (
                  likelyEvents.slice(0, 10).map((item) => (
                    <article key={item.event._id} className="rounded-xl border border-[#e6dfcb] bg-[#fffaf0] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7d6a39]">
                        {Math.round(item.likelihood)} • {tierLabel(item.tier)}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-[#1d2238]">{item.event.title}</h3>
                      <p className="mt-1 text-xs text-[#5e6277]">{item.event.placeName}</p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="monitor-card p-4">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#676b81]">
                <Zap className="h-4 w-4" /> Non-News Signal Insights
              </h2>

              <div className="mt-3 max-h-[22vh] space-y-2 overflow-y-auto pr-1">
                {topSignals.length === 0 ? (
                  <p className="rounded-lg border border-[#e5decf] bg-[#fbf8f1] px-3 py-2 text-sm text-[#60657c]">
                    No signal points available in this window.
                  </p>
                ) : (
                  topSignals.map((signal) => (
                    <article key={signal.id} className="rounded-xl border border-[#dde2ec] bg-[#f6f9fd] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3e5474]">
                        {signal.evidenceKind.replace(/_/g, " ")} • score {Math.round(signal.score)}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-[#1d2238]">{signal.label}</h3>
                      <p className="mt-1 text-xs text-[#5b6078]">
                        {signal.placeName} • {formatAgo(signal.createdAt)}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="monitor-card p-4">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#676b81]">
                <RefreshCcw className="h-4 w-4" /> Ingestion Health
              </h2>

              <div className="mt-3 space-y-2 text-xs text-[#3b4058]">
                {stats?.latestIngestRuns?.length ? (
                  (stats.latestIngestRuns as Array<{
                    _id: string;
                    sourceName: string;
                    status: string;
                    startedAt: number;
                    error?: string | null;
                  }>).slice(0, 10).map((run) => (
                    <div key={run._id} className="rounded-lg border border-[#e3ddcf] bg-[#fbf8f1] px-3 py-2">
                      <p className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{run.sourceName}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${run.status === "success" ? "border-[#bad9bf] bg-[#eaf7ed] text-[#1f6b2e]" : run.status === "failed" ? "border-[#e4b3bc] bg-[#fff0f3] text-[#8d1f35]" : "border-[#d2d7e1] bg-[#f2f5fa] text-[#405272]"}`}>
                          {run.status}
                        </span>
                      </p>
                      <p className="mt-1 text-[11px] text-[#60657a]">{formatAgo(run.startedAt)}</p>
                      {run.error ? (
                        <p className="mt-1 inline-flex items-start gap-1.5 rounded border border-[#efc5b8] bg-[#fff1ea] px-2 py-1 text-[11px] text-[#8a4123]">
                          <AlertTriangle className="mt-0.5 h-3 w-3" /> {run.error}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-[#e3ddcf] bg-[#fbf8f1] px-3 py-2 text-sm text-[#60657c]">
                    Waiting for ingest run metadata.
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Confirmed",
              value: confirmedEvents.length,
              tone: "confirmed" as const,
              icon: CheckCircle2,
            },
            {
              label: "Likely",
              value: likelyEvents.length,
              tone: "likely" as const,
              icon: MapPinned,
            },
            {
              label: "Watch",
              value: fusion.assessedEvents.filter((item) => item.tier === "watch").length,
              tone: "watch" as const,
              icon: Radar,
            },
            {
              label: "Signal Rows",
              value: fusion.mapSignals.length,
              tone: "watch" as const,
              icon: Zap,
            },
          ].map((item) => (
            <article key={item.label} className={`rounded-xl border px-3 py-2 ${tierClass(item.tone)}`}>
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]">
                <item.icon className="h-3.5 w-3.5" /> {item.label}
              </p>
              <p className="mt-1 text-xl font-semibold leading-none">{shortNumber(item.value)}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
