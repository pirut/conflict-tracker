"use client";

import { X } from "lucide-react";
import { formatAgo, formatLocal, formatUtc } from "@/lib/format";
import { DashboardEvent } from "@/lib/types";

type EventDrawerProps = {
  event: DashboardEvent | null;
  onClose: () => void;
};

function confidenceTone(score: number): string {
  if (score >= 75) return "text-emerald-200";
  if (score >= 45) return "text-amber-200";
  return "text-rose-200";
}

export function EventDrawer({ event, onClose }: EventDrawerProps) {
  if (!event) {
    return null;
  }

  const socialOnly =
    event.sourceTypes.includes("social") &&
    !event.sourceTypes.includes("news") &&
    !event.sourceTypes.includes("signals");

  return (
    <aside className="absolute right-4 top-4 z-[1000] w-[min(26rem,calc(100%-2rem))] rounded-2xl border border-white/20 bg-slate-950/92 p-4 shadow-glow backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Event Detail</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-50">{event.title}</h3>
          <p className="mt-1 text-xs text-slate-400">{formatAgo(event.eventTs)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/20 p-1 text-slate-200 transition hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Confidence</p>
          <p className={`mt-1 text-sm font-semibold ${confidenceTone(event.confidence)}`}>
            {event.confidence.toFixed(0)} ({event.confidenceLabel})
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Location</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{event.placeName}</p>
        </div>
      </div>

      {socialOnly ? (
        <p className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-rose-200">
          Unverified social-only report
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-slate-300">{event.summary}</p>

      <div className="mt-3 space-y-2 text-xs text-slate-300">
        <div>
          <p className="font-semibold uppercase tracking-wider text-slate-500">What We Know</p>
          <ul className="mt-1 space-y-1">
            {event.whatWeKnow.map((item) => (
              <li key={item} className="rounded-lg bg-white/5 px-2 py-1">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wider text-slate-500">What We Don&apos;t Know</p>
          <ul className="mt-1 space-y-1">
            {event.whatWeDontKnow.map((item) => (
              <li key={item} className="rounded-lg bg-white/5 px-2 py-1">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/80 p-2 text-xs text-slate-300">
        <p className="font-semibold uppercase tracking-wider text-slate-500">Time</p>
        <p className="mt-1">Local: {formatLocal(event.eventTs)}</p>
        <p>UTC: {formatUtc(event.eventTs)}</p>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        <p className="font-semibold uppercase tracking-wider text-slate-500">Source Links</p>
        {event.sources.map((source) => (
          <a
            key={source._id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-cyan-200 transition hover:bg-slate-800"
          >
            {source.sourceName} {source.sourceType === "social" ? "(UNVERIFIED)" : ""}
          </a>
        ))}
      </div>
    </aside>
  );
}
