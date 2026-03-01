"use client";

import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { DashboardEvent } from "@/lib/types";
import { clusterEvents } from "@/lib/map-clusters";

type MapCanvasProps = {
  events: DashboardEvent[];
  onSelect: (event: DashboardEvent) => void;
  selectedEventId: string | null;
  translateText: (text: string) => string;
};

function markerColor(confidence: number): string {
  if (confidence >= 75) {
    return "#22c55e";
  }
  if (confidence >= 45) {
    return "#f59e0b";
  }
  return "#ef4444";
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

export function MapCanvas({ events, onSelect, selectedEventId, translateText }: MapCanvasProps) {
  const mappableEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          Number.isFinite(event.lat) &&
          Number.isFinite(event.lon) &&
          Math.abs(event.lat) <= 90 &&
          Math.abs(event.lon) <= 180,
      ),
    [events],
  );
  const clusters = useMemo(() => clusterEvents(mappableEvents), [mappableEvents]);

  return (
    <MapContainer
      center={[26.0, 36.0]}
      zoom={3}
      minZoom={2}
      maxZoom={9}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <MapViewportController points={clusters.map((cluster) => ({ lat: cluster.lat, lon: cluster.lon }))} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {clusters.map((cluster) => {
        const event = cluster.events[0];
        const isSelected = selectedEventId === event._id;

        return (
          <CircleMarker
            key={cluster.id}
            center={[cluster.lat, cluster.lon]}
            radius={Math.min(10 + cluster.count * 2, 24)}
            pathOptions={{
              color: "#0b1220",
              weight: 1,
              fillColor: markerColor(cluster.maxConfidence),
              fillOpacity: isSelected ? 0.95 : 0.78,
            }}
            eventHandlers={{
              click: () => {
                const highest = [...cluster.events].sort((a, b) => b.confidence - a.confidence)[0];
                onSelect(highest);
              },
            }}
          >
            <Tooltip direction="top">
              <div className="space-y-1 text-xs">
                <p className="font-semibold">
                  {cluster.count} {translateText(cluster.count > 1 ? "events" : "event")}
                </p>
                <p>
                  {translateText(event.placeName)}
                  {event.country ? `, ${translateText(event.country)}` : ""}
                </p>
                <p>
                  {translateText("Max confidence")}: {cluster.maxConfidence.toFixed(0)}
                </p>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
