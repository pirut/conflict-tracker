"use client";

import dynamic from "next/dynamic";
import { DashboardEvent } from "@/lib/types";
import { EventDrawer } from "./event-drawer";

const MapCanvas = dynamic(
  () => import("./map-canvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-900/80 text-sm text-slate-300">
        Loading map...
      </div>
    ),
  },
);

type MapPanelProps = {
  events: DashboardEvent[];
  selectedEvent: DashboardEvent | null;
  onSelectEvent: (event: DashboardEvent) => void;
  onCloseDrawer: () => void;
  translateText: (text: string) => string;
  labels: {
    confidenceMap: string;
    eventDetail: string;
    whatWeKnow: string;
    whatWeDontKnow: string;
    sourceLinks: string;
  };
};

export function MapPanel({
  events,
  selectedEvent,
  onSelectEvent,
  onCloseDrawer,
  translateText,
  labels,
}: MapPanelProps) {
  return (
    <section className="relative h-full min-h-[32rem] overflow-hidden rounded-2xl border border-white/15 bg-slate-950/60 shadow-glow backdrop-blur-xl">
      <div className="absolute left-4 top-4 z-[900] rounded-full border border-white/20 bg-slate-950/85 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-200">
        {labels.confidenceMap}
      </div>
      <MapCanvas
        events={events}
        selectedEventId={selectedEvent?._id ?? null}
        onSelect={onSelectEvent}
        translateText={translateText}
      />
      <EventDrawer
        event={selectedEvent}
        onClose={onCloseDrawer}
        translateText={translateText}
        labels={{
          eventDetail: labels.eventDetail,
          whatWeKnow: labels.whatWeKnow,
          whatWeDontKnow: labels.whatWeDontKnow,
          sourceLinks: labels.sourceLinks,
        }}
      />
    </section>
  );
}
