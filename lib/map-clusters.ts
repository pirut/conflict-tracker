import { DashboardEvent } from "./types";

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type EventCluster = {
  id: string;
  lat: number;
  lon: number;
  count: number;
  maxConfidence: number;
  events: DashboardEvent[];
};

export function clusterEvents(events: DashboardEvent[]): EventCluster[] {
  const clusters: EventCluster[] = [];

  for (const event of events) {
    let attached = false;

    for (const cluster of clusters) {
      const km = haversineKm(event.lat, event.lon, cluster.lat, cluster.lon);
      if (km > 24) {
        continue;
      }

      cluster.events.push(event);
      cluster.count += 1;
      cluster.maxConfidence = Math.max(cluster.maxConfidence, event.confidence);
      cluster.lat =
        (cluster.lat * (cluster.count - 1) + event.lat) / cluster.count;
      cluster.lon =
        (cluster.lon * (cluster.count - 1) + event.lon) / cluster.count;
      attached = true;
      break;
    }

    if (!attached) {
      clusters.push({
        id: event.clusterId,
        lat: event.lat,
        lon: event.lon,
        count: 1,
        maxConfidence: event.confidence,
        events: [event],
      });
    }
  }

  return clusters;
}
