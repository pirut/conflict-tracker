"use client";

import "leaflet/dist/leaflet.css";

import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
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

export function MapCanvas({ events, onSelect, selectedEventId, translateText }: MapCanvasProps) {
  const clusters = clusterEvents(events);

  return (
    <MapContainer
      center={[32.4279, 53.688]}
      zoom={5}
      minZoom={4}
      maxZoom={10}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
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
                <p>{translateText(event.placeName)}</p>
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
