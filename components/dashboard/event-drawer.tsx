"use client";

import { X } from "lucide-react";
import { formatAgo, formatLocal, formatUtc } from "@/lib/format";
import { DashboardEvent } from "@/lib/types";

type EventDrawerProps = {
  event: DashboardEvent | null;
  onClose: () => void;
  translateText: (text: string) => string;
  labels: {
    eventDetail: string;
    whatWeKnow: string;
    whatWeDontKnow: string;
    sourceLinks: string;
  };
};

function confidenceTone(score: number): string {
  if (score >= 75) return "text-emerald-700";
  if (score >= 45) return "text-amber-700";
  return "text-rose-700";
}

export function EventDrawer({ event, onClose, translateText, labels }: EventDrawerProps) {
  if (!event) {
    return null;
  }

  const socialOnly =
    event.sourceTypes.includes("social") &&
    !event.sourceTypes.includes("news") &&
    !event.sourceTypes.includes("signals");

  return (
    <aside className="absolute right-3 top-3 z-[1000] w-[min(26rem,calc(100%-1.5rem))] rounded-md border border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{labels.eventDetail}</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">{translateText(event.title)}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatAgo(event.eventTs)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 p-1 text-slate-700 transition hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{translateText("Confidence")}</p>
          <p className={`mt-1 text-sm font-semibold ${confidenceTone(event.confidence)}`}>
            {event.confidence.toFixed(0)} ({event.confidenceLabel})
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{translateText("Location")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{translateText(event.placeName)}</p>
        </div>
      </div>

      {socialOnly ? (
        <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-rose-700">
          {translateText("Unverified social-only report")}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-slate-700">{translateText(event.summary)}</p>

      <div className="mt-3 space-y-2 text-xs text-slate-700">
        <div>
          <p className="font-semibold uppercase tracking-wide text-slate-500">{labels.whatWeKnow}</p>
          <ul className="mt-1 space-y-1">
            {event.whatWeKnow.map((item) => (
              <li key={item} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                {translateText(item)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wide text-slate-500">{labels.whatWeDontKnow}</p>
          <ul className="mt-1 space-y-1">
            {event.whatWeDontKnow.map((item) => (
              <li key={item} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                {translateText(item)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
        <p className="font-semibold uppercase tracking-wide text-slate-500">{translateText("Time")}</p>
        <p className="mt-1">{translateText("Local")}: {formatLocal(event.eventTs)}</p>
        <p>{translateText("UTC")}: {formatUtc(event.eventTs)}</p>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        <p className="font-semibold uppercase tracking-wide text-slate-500">{labels.sourceLinks}</p>
        {event.sources.map((source) => (
          <a
            key={source._id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 transition hover:bg-slate-50"
          >
            {translateText(source.sourceName)}{" "}
            {source.sourceType === "social" ? `(${translateText("UNVERIFIED")})` : ""}
          </a>
        ))}
      </div>
    </aside>
  );
}
