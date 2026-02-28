import { IRAN_CITIES, IRAN_DEFAULT_CENTER } from "../constants";

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

export function resolvePlaceFromText(text: string): {
  placeName: string;
  lat: number;
  lon: number;
  isGeoPrecise: boolean;
} {
  const lowered = text.toLowerCase();

  for (const city of IRAN_CITIES) {
    if (lowered.includes(city.name.toLowerCase())) {
      return {
        placeName: city.name,
        lat: city.lat,
        lon: city.lon,
        isGeoPrecise: true,
      };
    }
  }

  return {
    placeName: "Iran (unspecified)",
    lat: IRAN_DEFAULT_CENTER.lat,
    lon: IRAN_DEFAULT_CENTER.lon,
    isGeoPrecise: false,
  };
}

export function nearestIranCity(lat: number, lon: number): {
  name: string;
  lat: number;
  lon: number;
  km: number;
} {
  let closest = {
    name: "Iran (unspecified)",
    lat: IRAN_DEFAULT_CENTER.lat,
    lon: IRAN_DEFAULT_CENTER.lon,
    km: Number.POSITIVE_INFINITY,
  };

  for (const city of IRAN_CITIES) {
    const km = haversineKm(lat, lon, city.lat, city.lon);
    if (km < closest.km) {
      closest = {
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        km,
      };
    }
  }

  return closest;
}
