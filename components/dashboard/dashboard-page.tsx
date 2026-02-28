"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Globe2, Radar } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatAgo, shortNumber } from "@/lib/format";
import { useEventTranslation } from "@/lib/i18n/use-event-translation";
import { normalizeLanguage, useUserLanguage } from "@/lib/i18n/use-language";
import { uiCopy } from "@/lib/i18n/ui-copy";
import { AlertRule, DashboardEvent, NotificationItem, SignalRecord } from "@/lib/types";
import { AIAnalysisPanel } from "./ai-analysis-panel";
import { EventsTimeline } from "./events-timeline";
import { FiltersBar, DashboardFilters } from "./filters-bar";
import { MapPanel } from "./map-panel";
import { SignalsPanel } from "./signals-panel";

const DEFAULT_FILTERS: DashboardFilters = {
  timeRangeHours: 24,
  minConfidence: 35,
  category: "all",
  q: "",
  sourceTypes: {
    news: true,
    signals: true,
    social: true,
  },
};

function warFocusScore(event: DashboardEvent): number {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  const usTerms = ["united states", "u.s.", "us ", "us-", "pentagon", "centcom", "american"];
  const iranTerms = ["iran", "tehran", "isfahan", "natanz", "qom", "tabriz"];
  const strikeTerms = ["strike", "airstrike", "attack", "missile", "drone", "bombard", "retaliat"];

  const count = (terms: string[]) => terms.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
  const us = count(usTerms);
  const iran = count(iranTerms);
  const strike = count(strikeTerms);
  return us * 3 + iran * 2 + strike * 2 + (us > 0 && iran > 0 ? 4 : 0);
}

function isUSLinkedStrike(event: DashboardEvent): boolean {
  const strikeCategories = new Set([
    "strike",
    "missile",
    "drone",
    "explosion",
    "air_defense",
    "military_base",
  ]);
  return warFocusScore(event) >= 6 && strikeCategories.has(event.category);
}

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const userLanguage = useUserLanguage();
  const [languagePreference, setLanguagePreference] = useState("auto");
  const activeLanguage = useMemo(() => {
    if (languagePreference === "auto") {
      return normalizeLanguage(userLanguage);
    }
    return normalizeLanguage(languagePreference);
  }, [languagePreference, userLanguage]);

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
  const alertsQuery = useQuery(api.events.getAlerts, {}) as AlertRule[] | undefined;
  const notificationsQuery = useQuery(api.events.getNotifications, {
    unreadOnly: true,
  }) as NotificationItem[] | undefined;

  const events = useMemo(() => eventsQuery ?? [], [eventsQuery]);
  const prioritizedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aScore = warFocusScore(a);
      const bScore = warFocusScore(b);
      return bScore - aScore || b.confidence - a.confidence || b.eventTs - a.eventTs;
    });
  }, [events]);
  const connectivitySignals = useMemo(
    () => connectivitySignalsQuery ?? [],
    [connectivitySignalsQuery],
  );
  const flightSignals = useMemo(() => flightSignalsQuery ?? [], [flightSignalsQuery]);
  const firmsSignals = useMemo(() => firmsSignalsQuery ?? [], [firmsSignalsQuery]);
  const alerts = useMemo(() => alertsQuery ?? [], [alertsQuery]);
  const notifications = useMemo(() => notificationsQuery ?? [], [notificationsQuery]);

  const translationSeedTexts = useMemo(() => {
    const texts: string[] = [
      "event",
      "events",
      "US-Iran Global Conflict Monitor",
      "Ongoing US-Iran Strikes, Attacks, and Escalation Signals Worldwide",
      "Prioritized tracking of US-linked strikes and attacks across Iran, Iraq, Syria, Yemen, Lebanon, Red Sea, and other theaters.",
      "Unverified",
      "UNVERIFIED",
      "UTC",
      "Local",
      "Time",
      "Confidence",
      "Location",
      "Category",
      "Source Types",
      "Search",
      "keyword or location",
      "Live clustering, confidence scoring, corroboration-aware event stream.",
      "high-confidence events in current window",
      "US-linked strike events in current window",
      "Latest update",
      "Source mix",
      "US-linked strikes",
      "Latest US-linked",
      "No sudden flight drops detected in this window.",
      "No hotspot rows yet for selected window.",
      "No notifications yet.",
      "Max confidence",
      "drop",
      "Show",
      "Hide",
      "High",
      "Medium",
      "Low",
      "news",
      "signals",
      "social",
      "AI Situation Analysis",
      "Key Developments",
      "Assessed Risks",
      "Monitoring Gaps",
      "Recommended Checks",
      "Updating...",
      "Mode",
      "Analysis error",
      "Generating AI briefing...",
      "AI briefing will appear when event data is available.",
      "Updated",
    ];

    for (const event of prioritizedEvents.slice(0, 40)) {
      texts.push(event.title, event.summary, event.placeName);
      texts.push(...event.whatWeKnow.slice(0, 3));
      texts.push(...event.whatWeDontKnow.slice(0, 3));
    }

    for (const signal of connectivitySignals.slice(0, 60)) {
      const region = signal.payload?.region;
      const title = signal.payload?.title;
      const summary = signal.payload?.summary;
      if (typeof region === "string") texts.push(region);
      if (typeof title === "string") texts.push(title);
      if (typeof summary === "string") texts.push(summary);
    }

    for (const signal of flightSignals.slice(0, 60)) {
      const city = signal.payload?.city;
      if (typeof city === "string") texts.push(city);
    }

    for (const signal of firmsSignals.slice(0, 60)) {
      const region = signal.payload?.region;
      if (typeof region === "string") texts.push(region);
    }

    for (const notification of notifications.slice(0, 100)) {
      texts.push(notification.message);
    }

    return Array.from(new Set(texts.filter(Boolean)));
  }, [prioritizedEvents, connectivitySignals, flightSignals, firmsSignals, notifications]);

  const { translateText } = useEventTranslation(prioritizedEvents, activeLanguage, translationSeedTexts);
  const copy = useMemo(
    () => (key: string, fallback: string) => uiCopy(activeLanguage, key, fallback),
    [activeLanguage],
  );

  const sourceMix = useMemo(() => {
    const mix = {
      news: 0,
      signals: 0,
      social: 0,
    };
    for (const event of prioritizedEvents) {
      if (event.sourceTypes.includes("news")) mix.news += 1;
      if (event.sourceTypes.includes("signals")) mix.signals += 1;
      if (event.sourceTypes.includes("social")) mix.social += 1;
    }
    return mix;
  }, [prioritizedEvents]);

  const topLocations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of prioritizedEvents) {
      counts.set(event.placeName, (counts.get(event.placeName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [prioritizedEvents]);

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of prioritizedEvents) {
      counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [prioritizedEvents]);

  const highConfidenceCount = useMemo(
    () => prioritizedEvents.filter((event) => event.confidence >= 75).length,
    [prioritizedEvents],
  );
  const usLinkedStrikeCount = useMemo(
    () => prioritizedEvents.filter((event) => isUSLinkedStrike(event)).length,
    [prioritizedEvents],
  );
  const latestEventTs = prioritizedEvents[0]?.eventTs;
  const latestUSLinkedTs = useMemo(
    () => prioritizedEvents.find((event) => isUSLinkedStrike(event))?.eventTs,
    [prioritizedEvents],
  );

  const selectedEvent = useMemo(
    () => prioritizedEvents.find((event) => event._id === selectedEventId) ?? null,
    [prioritizedEvents, selectedEventId],
  );

  return (
    <main className="min-h-screen p-3 text-slate-900 sm:p-5 lg:p-6">
      <header className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
              <Radar className="h-3.5 w-3.5" /> {translateText("US-Iran Global Conflict Monitor")}
            </p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
              {translateText("Ongoing US-Iran Strikes, Attacks, and Escalation Signals Worldwide")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {translateText("Prioritized tracking of US-linked strikes and attacks across Iran, Iraq, Syria, Yemen, Lebanon, Red Sea, and other theaters.")}
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Globe2 className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-semibold uppercase tracking-wide">
              {copy("language", "Language")}
            </span>
            <select
              value={languagePreference}
              onChange={(event) => setLanguagePreference(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            >
              <option value="auto">Auto ({userLanguage || "en"})</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
              <option value="fa">فارسی</option>
              <option value="tr">Türkçe</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <p className="uppercase tracking-wide text-slate-500">{copy("events24h", "Events (24h)")}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {stats ? shortNumber(stats.totalEvents24h) : "..."}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
            <p className="uppercase tracking-wide text-slate-500">{translateText("US-linked strikes")}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{usLinkedStrikeCount}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
            <p className="uppercase tracking-wide text-slate-500">{translateText("High confidence")}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{highConfidenceCount}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
            <p className="uppercase tracking-wide text-slate-500">{translateText("Latest US-linked")}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {latestUSLinkedTs ? formatAgo(latestUSLinkedTs) : "..."}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {translateText(
          "Signals and social reports may be incomplete or inaccurate. Confidence reflects corroboration, not certainty.",
        )}
      </div>

      <section className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-700 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="uppercase tracking-wide text-slate-500">{copy("intelligenceSnapshot", "Intelligence Snapshot")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {usLinkedStrikeCount} {translateText("US-linked strike events in current window")}
          </p>
          <p className="mt-1 text-slate-500">
            {translateText("Latest update")}: {latestEventTs ? formatAgo(latestEventTs) : "..."}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="uppercase tracking-wide text-slate-500">{translateText("Source mix")}</p>
          <p className="mt-1">
            {translateText("News")}: <span className="font-semibold text-slate-900">{sourceMix.news}</span>
          </p>
          <p>
            {translateText("Signals")}: <span className="font-semibold text-slate-900">{sourceMix.signals}</span>
          </p>
          <p>
            {translateText("Social")}: <span className="font-semibold text-slate-900">{sourceMix.social}</span>
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="uppercase tracking-wide text-slate-500">{copy("topLocations", "Top Locations")}</p>
          {topLocations.length === 0 ? (
            <p className="mt-1 text-slate-500">...</p>
          ) : (
            topLocations.map(([place, count]) => (
              <p key={place} className="mt-1">
                {translateText(place)}: <span className="font-semibold text-slate-900">{count}</span>
              </p>
            ))
          )}
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="uppercase tracking-wide text-slate-500">{copy("topCategories", "Top Categories")}</p>
          {topCategories.length === 0 ? (
            <p className="mt-1 text-slate-500">...</p>
          ) : (
            topCategories.map(([category, count]) => (
              <p key={category} className="mt-1">
                {translateText(category.replace(/_/g, " "))}:{" "}
                <span className="font-semibold text-slate-900">{count}</span>
              </p>
            ))
          )}
        </div>
      </section>

      <FiltersBar filters={filters} onChange={setFilters} translateText={translateText} />

      <AIAnalysisPanel
        events={prioritizedEvents}
        connectivitySignals={connectivitySignals}
        flightSignals={flightSignals}
        firmsSignals={firmsSignals}
        language={activeLanguage}
        translateText={translateText}
      />

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <MapPanel
            events={prioritizedEvents}
            selectedEvent={selectedEvent}
            onSelectEvent={(event) => setSelectedEventId(event._id)}
            onCloseDrawer={() => setSelectedEventId(null)}
            translateText={translateText}
            labels={{
              confidenceMap: copy("confidenceMap", "Confidence Map"),
              eventDetail: copy("eventDetail", "Event Detail"),
              whatWeKnow: copy("whatWeKnow", "What We Know"),
              whatWeDontKnow: copy("whatWeDontKnow", "What We Don't Know"),
              sourceLinks: copy("sourceLinks", "Source Links"),
            }}
          />
        </div>

        <div className="xl:col-span-4">
          <EventsTimeline
            events={prioritizedEvents}
            selectedEventId={selectedEventId}
            onSelect={(event) => setSelectedEventId(event._id)}
            translateText={translateText}
            labels={{
              liveTimeline: copy("liveTimeline", "Live Timeline"),
              newestFirst: copy("newestFirst", "Newest first"),
              noEvents: copy("noEvents", "No events match current filters."),
              whatWeKnow: copy("whatWeKnow", "What we know"),
              whatWeDontKnow: copy("whatWeDontKnow", "What we don't know"),
            }}
          />
        </div>

        <div className="xl:col-span-4">
          <SignalsPanel
            connectivitySignals={connectivitySignals}
            flightSignals={flightSignals}
            firmsSignals={firmsSignals}
            alerts={alerts}
            notifications={notifications}
            translateText={translateText}
            labels={{
              signals: copy("signals", "Signals"),
              connectivity24h: copy("connectivity24h", "Connectivity (24h)"),
              flightAlerts: copy("flightAlerts", "Flight Disruption Alerts"),
              firmsHotspots: copy("firmsHotspots", "FIRMS Hotspots"),
              notifications: copy("notifications", "In-app Notifications"),
            }}
          />
        </div>
      </section>
    </main>
  );
}
