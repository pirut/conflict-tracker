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
    return "border-slate-300";
  }
  if (event.sourceTypes.includes("signals")) {
    return "border-slate-300";
  }
  return "border-slate-300";
}

function confidenceBar(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-rose-500";
}

export function EventsTimeline({
  events,
  selectedEventId,
  onSelect,
  translateText,
  labels,
}: EventsTimelineProps) {
  return (
    <section className="flex h-full min-h-[32rem] flex-col rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{labels.liveTimeline}</h2>
        <span className="text-xs text-slate-500">{labels.newestFirst}</span>
      </div>

      <div className="space-y-3 overflow-y-auto pr-1">
        {events.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
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
              className={`cursor-pointer rounded-md border bg-white p-3 transition hover:border-slate-400 ${
                selectedEventId === event._id ? "border-slate-900" : sourceTone(event)
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{translateText(event.title)}</h3>
                  <p className="mt-1 text-xs text-slate-500">{translateText(event.placeName)}</p>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  <p>{formatAgo(event.eventTs)}</p>
                  <p>{formatLocal(event.eventTs)}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-md border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700">
                  {translateText(event.category.replace(/_/g, " "))}
                </span>
                {event.sourceTypes.map((sourceType) => (
                  <span
                    key={`${event._id}-${sourceType}`}
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      sourceType === "news"
                        ? "border-slate-300 text-slate-700"
                        : sourceType === "signals"
                          ? "border-slate-300 text-slate-700"
                          : "border-slate-300 text-slate-700"
                    }`}
                  >
                    {translateText(sourceType)}
                  </span>
                ))}
                {socialOnly ? (
                  <span className="rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                    {translateText("Unverified")}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${confidenceBar(event.confidence)}`}
                  style={{ width: `${Math.max(event.confidence, 4)}%` }}
                />
              </div>

              <p className="mt-2 line-clamp-2 text-xs text-slate-700">
                {translateText(event.summary)}
              </p>

              <div className="mt-2 grid gap-2 text-xs text-slate-700 md:grid-cols-2">
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-500">{labels.whatWeKnow}</p>
                  <p className="mt-1 line-clamp-2">
                    {translateText(event.whatWeKnow.join(" "))}
                  </p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-500">{labels.whatWeDontKnow}</p>
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
                    className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700 hover:border-slate-500"
                  >
                    {translateText(source.sourceName)}
                  </a>
                ))}
                <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
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
