"use client";

import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useMemo } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { AssessedEvent, EvidenceKind, FusionHotspot, MapSignalPoint } from "@/lib/fusion";

type MapCanvasProps = {
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
  onSelect: (event: AssessedEvent["event"]) => void;
  selectedEventId: string | null;
};

function markerColorByTier(tier: AssessedEvent["tier"]): string {
  if (tier === "confirmed") {
    return "#d52f43";
  }
  if (tier === "likely") {
    return "#ff9f1c";
  }
  return "#4f6d7a";
}

function signalColor(kind: EvidenceKind): string {
  if (kind === "seismic") return "#8f2d56";
  if (kind === "power") return "#f25f5c";
  if (kind === "satellite") return "#247ba0";
  if (kind === "firms") return "#f18f01";
  if (kind === "connectivity") return "#3a86ff";
  if (kind === "flight") return "#6a4c93";
  return "#6c757d";
}

function hotspotColor(hotspot: FusionHotspot): string {
  if (hotspot.confirmed) return "#b80f2f";
  if (hotspot.tier === "likely") return "#d17d00";
  return "#4361ee";
}

function MapViewportController({
  points,
}: {
  points: Array<{ lat: number; lon: number }>;
}) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();

    if (points.length === 0) {
      map.setView([26.0, 36.0], 3);
      return;
    }

    const bounds = latLngBounds(points.map((point) => [point.lat, point.lon] as [number, number]));
    map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 7,
      animate: false,
    });
  }, [map, points]);

  return null;
}

function isTierVisible(
  tier: AssessedEvent["tier"],
  layers: MapCanvasProps["layers"],
): boolean {
  if (tier === "confirmed") return layers.showConfirmed;
  if (tier === "likely") return layers.showLikely;
  return layers.showWatch;
}

export function MapCanvas({
  assessedEvents,
  mapSignals,
  hotspots,
  layers,
  onSelect,
  selectedEventId,
}: MapCanvasProps) {
  const visibleEvents = useMemo(
    () => assessedEvents.filter((item) => isTierVisible(item.tier, layers)),
    [assessedEvents, layers],
  );

  const visibleSignals = useMemo(
    () =>
      layers.showSignals
        ? mapSignals.filter((signal) => layers.signalKinds[signal.evidenceKind] ?? false)
        : [],
    [mapSignals, layers],
  );

  const visibleHotspots = useMemo(
    () => (layers.showHotspots ? hotspots.filter((hotspot) => isTierVisible(hotspot.tier, layers)) : []),
    [hotspots, layers],
  );

  const points = useMemo(
    () => [
      ...visibleEvents.map((item) => ({ lat: item.event.lat, lon: item.event.lon })),
      ...visibleSignals.map((signal) => ({ lat: signal.lat, lon: signal.lon })),
      ...visibleHotspots.map((hotspot) => ({ lat: hotspot.lat, lon: hotspot.lon })),
    ],
    [visibleEvents, visibleSignals, visibleHotspots],
  );

  return (
    <MapContainer
      center={[26.0, 36.0]}
      zoom={3}
      minZoom={2}
      maxZoom={9}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <MapViewportController points={points} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {visibleHotspots.map((hotspot) => (
        <Circle
          key={hotspot.id}
          center={[hotspot.lat, hotspot.lon]}
          radius={Math.max(16000, (hotspot.eventCount + hotspot.signalCount) * 3600)}
          pathOptions={{
            color: hotspotColor(hotspot),
            weight: hotspot.confirmed ? 2.2 : 1.4,
            fillColor: hotspotColor(hotspot),
            fillOpacity: hotspot.confirmed ? 0.16 : 0.09,
            dashArray: hotspot.confirmed ? undefined : "4 6",
          }}
        >
          <Tooltip direction="top">
            <div className="space-y-1 text-xs">
              <p className="font-semibold">
                {hotspot.confirmed ? "Confirmed hotspot" : "Likely hotspot"} ({Math.round(hotspot.likelihood)})
              </p>
              <p>{hotspot.topLabel}</p>
              <p>{hotspot.summary}</p>
            </div>
          </Tooltip>
        </Circle>
      ))}

      {visibleEvents.map((item) => {
        const isSelected = selectedEventId === item.event._id;
        const color = markerColorByTier(item.tier);
        return (
          <CircleMarker
            key={item.event._id}
            center={[item.event.lat, item.event.lon]}
            radius={Math.min(12, 5 + item.likelihood / 24)}
            pathOptions={{
              color: isSelected ? "#111827" : "#0b1220",
              weight: isSelected ? 2.2 : 1,
              fillColor: color,
              fillOpacity: isSelected ? 0.95 : 0.78,
            }}
            eventHandlers={{
              click: () => onSelect(item.event),
            }}
          >
            <Tooltip direction="top">
              <div className="space-y-1 text-xs">
                <p className="font-semibold">
                  {item.confirmed ? "Confirmed event" : item.tier === "likely" ? "Likely event" : "Watch event"}
                </p>
                <p>{item.event.title}</p>
                <p>
                  {item.event.placeName}
                  {item.event.country ? `, ${item.event.country}` : ""}
                </p>
                <p>Likelihood: {Math.round(item.likelihood)}</p>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}

      {visibleSignals.map((signal) => (
        <CircleMarker
          key={`signal-${signal.id}`}
          center={[signal.lat, signal.lon]}
          radius={Math.min(9, 3.8 + signal.score / 38)}
          pathOptions={{
            color: "#0b1220",
            weight: 0.8,
            fillColor: signalColor(signal.evidenceKind),
            fillOpacity: 0.72,
          }}
        >
          <Tooltip direction="top">
            <div className="space-y-1 text-xs">
              <p className="font-semibold">{signal.label}</p>
              <p>
                {signal.placeName} • {signal.type}
              </p>
              <p>Signal score: {Math.round(signal.score)}</p>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
