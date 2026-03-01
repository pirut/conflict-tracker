"use client";

import dynamic from "next/dynamic";
import { DashboardEvent } from "@/lib/types";
import { EventDrawer } from "./event-drawer";

const MapCanvas = dynamic(
  () => import("./map-canvas").then((module) => module.MapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-white text-sm text-slate-500">
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
  className?: string;
};

export function MapPanel({
  events,
  selectedEvent,
  onSelectEvent,
  onCloseDrawer,
  translateText,
  labels,
  className,
}: MapPanelProps) {
  return (
    <section
      className={`relative h-full min-h-[16rem] overflow-hidden rounded-lg border border-slate-200 bg-white ${className ?? ""}`}
    >
      <div className="absolute left-3 top-3 z-[900] rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
        {labels.confidenceMap}
      </div>
      <MapCanvas
        events={events}
        selectedEventId={selectedEvent?._id ?? null}
        onSelect={onSelectEvent}
        translateText={translateText}
      />
      {events.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[850] flex items-center justify-center bg-white/65">
          <p className="rounded-md border border-[#d9d2c5] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#6d6d83]">
            No geolocated events for current filters
          </p>
        </div>
      ) : null}
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
