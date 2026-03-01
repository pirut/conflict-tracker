"use client";

import dynamic from "next/dynamic";
import { AssessedEvent, EvidenceKind, FusionHotspot, MapSignalPoint } from "@/lib/fusion";
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
  assessedEvents: AssessedEvent[];
  mapSignals: MapSignalPoint[];
  hotspots: FusionHotspot[];
  layers: {
    showConfirmed: boolean;
    showLikely: boolean;
    showWatch: boolean;
    showSignals: boolean;
    showHotspots: boolean;
    signalKinds: Record<EvidenceKind, boolean>;
  };
  selectedEvent: DashboardEvent | null;
  onSelectEvent: (event: DashboardEvent) => void;
  onCloseDrawer: () => void;
  className?: string;
};

export function MapPanel({
  assessedEvents,
  mapSignals,
  hotspots,
  layers,
  selectedEvent,
  onSelectEvent,
  onCloseDrawer,
  className,
}: MapPanelProps) {
  return (
    <section
      className={`relative w-full min-h-[16rem] overflow-hidden rounded-2xl border border-[#d7d2c4] bg-white ${className ?? ""}`}
    >
      <div className="absolute left-3 top-3 z-[900] rounded-md border border-[#d7d2c4] bg-white/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3c4158]">
        Multi-source conflict map
      </div>
      <MapCanvas
        assessedEvents={assessedEvents}
        mapSignals={mapSignals}
        hotspots={hotspots}
        layers={layers}
        selectedEventId={selectedEvent?._id ?? null}
        onSelect={onSelectEvent}
      />
      {assessedEvents.length === 0 && mapSignals.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[850] flex items-center justify-center bg-white/65">
          <p className="rounded-md border border-[#d9d2c5] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#6d6d83]">
            No geolocated events for current filters
          </p>
        </div>
      ) : null}
      <EventDrawer
        event={selectedEvent}
        onClose={onCloseDrawer}
        translateText={(text) => text}
        labels={{
          eventDetail: "Event detail",
          whatWeKnow: "What we know",
          whatWeDontKnow: "What we do not know",
          sourceLinks: "Source links",
        }}
      />
    </section>
  );
}
