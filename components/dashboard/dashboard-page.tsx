"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Radar } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { shortNumber } from "@/lib/format";
import { AlertRule, DashboardEvent, NotificationItem, SignalRecord } from "@/lib/types";
import { EventsTimeline } from "./events-timeline";
import { FiltersBar, DashboardFilters } from "./filters-bar";
import { MapPanel } from "./map-panel";
import { SignalsPanel } from "./signals-panel";

const DEFAULT_FILTERS: DashboardFilters = {
  timeRangeHours: 24,
  minConfidence: 0,
  category: "all",
  q: "",
  sourceTypes: {
    news: true,
    signals: true,
    social: true,
  },
};

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const enabledTypes = useMemo(() => {
    return (Object.entries(filters.sourceTypes) as Array<[
      keyof DashboardFilters["sourceTypes"],
      boolean,
    ]>)
      .filter(([, enabled]) => enabled)
      .map(([type]) => type);
  }, [filters.sourceTypes]);

  const eventsQuery = useQuery(api.events.getEvents, {
    since: tick - filters.timeRangeHours * 60 * 60 * 1000,
    minConfidence: filters.minConfidence,
    category: filters.category === "all" ? undefined : (filters.category as never),
    types: enabledTypes.length === 3 ? undefined : (enabledTypes as never),
    q: filters.q.trim() ? filters.q.trim() : undefined,
  }) as DashboardEvent[] | undefined;

  const events = useMemo(() => eventsQuery ?? [], [eventsQuery]);

  const stats = useQuery(api.events.getStats, {});

  const connectivitySignals =
    (useQuery(api.events.getSignals, { type: "connectivity" }) as SignalRecord[] | undefined) ?? [];
  const flightSignals =
    (useQuery(api.events.getSignals, { type: "flight" }) as SignalRecord[] | undefined) ?? [];
  const firmsSignals =
    (useQuery(api.events.getSignals, { type: "firms" }) as SignalRecord[] | undefined) ?? [];

  const alerts = (useQuery(api.events.getAlerts, {}) as AlertRule[] | undefined) ?? [];
  const notifications =
    (useQuery(api.events.getNotifications, { unreadOnly: true }) as
      | NotificationItem[]
      | undefined) ?? [];

  const selectedEvent = useMemo(
    () => events.find((event) => event._id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  return (
    <main className="relative min-h-screen p-3 text-slate-100 sm:p-5 lg:p-6">
      <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/20 bg-slate-950/60 p-4 shadow-glow backdrop-blur-xl lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
            <Radar className="h-3.5 w-3.5" /> Iran Live Situation Dashboard
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white lg:text-3xl">
            Confirmed News + Signals + Optional Social Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            Live clustering, confidence scoring, corroboration-aware event stream.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2 text-xs">
            <p className="uppercase tracking-wider text-slate-500">Events (24h)</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">
              {stats ? shortNumber(stats.totalEvents24h) : "..."}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-xs">
            <p className="uppercase tracking-wider text-emerald-200/80">High</p>
            <p className="mt-1 text-lg font-semibold text-emerald-100">
              {stats?.byLabel?.High ?? "..."}
            </p>
          </div>
          <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs">
            <p className="uppercase tracking-wider text-amber-200/80">Medium</p>
            <p className="mt-1 text-lg font-semibold text-amber-100">
              {stats?.byLabel?.Medium ?? "..."}
            </p>
          </div>
          <div className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs">
            <p className="uppercase tracking-wider text-rose-200/80">Low</p>
            <p className="mt-1 text-lg font-semibold text-rose-100">
              {stats?.byLabel?.Low ?? "..."}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 rounded-xl border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
        Signals and social reports may be incomplete or inaccurate. Confidence reflects corroboration, not certainty.
      </div>

      <FiltersBar filters={filters} onChange={setFilters} />

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <MapPanel
            events={events}
            selectedEvent={selectedEvent}
            onSelectEvent={(event) => setSelectedEventId(event._id)}
            onCloseDrawer={() => setSelectedEventId(null)}
          />
        </div>

        <div className="xl:col-span-4">
          <EventsTimeline
            events={events}
            selectedEventId={selectedEventId}
            onSelect={(event) => setSelectedEventId(event._id)}
          />
        </div>

        <div className="xl:col-span-4">
          <SignalsPanel
            connectivitySignals={connectivitySignals}
            flightSignals={flightSignals}
            firmsSignals={firmsSignals}
            alerts={alerts}
            notifications={notifications}
          />
        </div>
      </section>
    </main>
  );
}
