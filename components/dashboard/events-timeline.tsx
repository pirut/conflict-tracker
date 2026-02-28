"use client";

import { formatAgo, formatLocal, formatUtc } from "@/lib/format";
import { DashboardEvent } from "@/lib/types";

type EventsTimelineProps = {
  events: DashboardEvent[];
  selectedEventId: string | null;
  onSelect: (event: DashboardEvent) => void;
  translateText: (text: string) => string;
  labels: {
    liveTimeline: string;
    newestFirst: string;
    noEvents: string;
    whatWeKnow: string;
    whatWeDontKnow: string;
  };
};

function sourceTone(event: DashboardEvent): string {
  if (event.sourceTypes.includes("news")) {
    return "border-cyan-300/55";
  }
  if (event.sourceTypes.includes("signals")) {
    return "border-amber-300/55";
  }
  return "border-rose-300/55";
}

function confidenceBar(score: number): string {
  if (score >= 75) return "from-emerald-400 to-emerald-200";
  if (score >= 45) return "from-amber-400 to-amber-200";
  return "from-rose-400 to-rose-200";
}

export function EventsTimeline({
  events,
  selectedEventId,
  onSelect,
  translateText,
  labels,
}: EventsTimelineProps) {
  return (
    <section className="flex h-full min-h-[32rem] flex-col rounded-2xl border border-white/15 bg-slate-950/55 p-4 shadow-glow backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-200">{labels.liveTimeline}</h2>
        <span className="text-xs text-slate-400">{labels.newestFirst}</span>
      </div>

      <div className="space-y-3 overflow-y-auto pr-1">
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-6 text-center text-sm text-slate-400">
            {labels.noEvents}
          </div>
        ) : null}

        {events.map((event) => {
          const socialOnly =
            event.sourceTypes.includes("social") &&
            !event.sourceTypes.includes("news") &&
            !event.sourceTypes.includes("signals");

          return (
            <article
              key={event._id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(event)}
              onKeyDown={(eventKey) => {
                if (eventKey.key === "Enter" || eventKey.key === " ") {
                  onSelect(event);
                }
              }}
              className={`cursor-pointer rounded-2xl border bg-slate-900/75 p-3 transition hover:border-cyan-200/60 hover:bg-slate-900 ${
                selectedEventId === event._id ? "border-cyan-200/75" : sourceTone(event)
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">{translateText(event.title)}</h3>
                  <p className="mt-1 text-xs text-slate-400">{translateText(event.placeName)}</p>
                </div>
                <div className="text-right text-[11px] text-slate-400">
                  <p>{formatAgo(event.eventTs)}</p>
                  <p>{formatLocal(event.eventTs)}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
                  {translateText(event.category.replace(/_/g, " "))}
                </span>
                {event.sourceTypes.map((sourceType) => (
                  <span
                    key={`${event._id}-${sourceType}`}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      sourceType === "news"
                        ? "border-cyan-300/50 text-cyan-200"
                        : sourceType === "signals"
                          ? "border-amber-300/50 text-amber-200"
                          : "border-rose-300/50 text-rose-200"
                    }`}
                  >
                    {translateText(sourceType)}
                  </span>
                ))}
                {socialOnly ? (
                  <span className="rounded-full border border-rose-300/60 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-100">
                    {translateText("Unverified")}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${confidenceBar(event.confidence)}`}
                  style={{ width: `${Math.max(event.confidence, 4)}%` }}
                />
              </div>

              <p className="mt-2 line-clamp-2 text-xs text-slate-300">
                {translateText(event.summary)}
              </p>

              <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
                <div>
                  <p className="font-semibold uppercase tracking-wider text-slate-500">{labels.whatWeKnow}</p>
                  <p className="mt-1 line-clamp-2">
                    {translateText(event.whatWeKnow.join(" "))}
                  </p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wider text-slate-500">{labels.whatWeDontKnow}</p>
                  <p className="mt-1 line-clamp-2">
                    {translateText(event.whatWeDontKnow.join(" "))}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {event.sources.slice(0, 3).map((source) => (
                  <a
                    key={source._id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(eventClick) => eventClick.stopPropagation()}
                    className="rounded-md border border-white/15 bg-black/20 px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-300/40"
                  >
                    {translateText(source.sourceName)}
                  </a>
                ))}
                <span className="rounded-md border border-white/15 bg-black/20 px-2 py-0.5 text-[10px] text-slate-400">
                  {translateText("Sources")}: {event.sources.length}
                </span>
              </div>

              <p className="mt-2 text-[10px] text-slate-500">
                {translateText("UTC")}: {formatUtc(event.eventTs)}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
