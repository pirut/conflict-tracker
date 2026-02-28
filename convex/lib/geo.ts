import { IRAN_CITIES, IRAN_DEFAULT_CENTER } from "../constants";

const EARTH_RADIUS_KM = 6371;

type PlacePoint = {
  name: string;
  country: string;
  lat: number;
  lon: number;
  aliases?: string[];
};

const GLOBAL_US_IRAN_THEATER_LOCATIONS: PlacePoint[] = [
  { name: "Baghdad", country: "Iraq", lat: 33.3152, lon: 44.3661, aliases: ["iraq", "baghdad"] },
  { name: "Erbil", country: "Iraq", lat: 36.1911, lon: 44.0092, aliases: ["erbil"] },
  { name: "Damascus", country: "Syria", lat: 33.5138, lon: 36.2765, aliases: ["syria", "damascus"] },
  { name: "Deir ez-Zor", country: "Syria", lat: 35.3359, lon: 40.14, aliases: ["deir ez-zor", "deir ezzor"] },
  { name: "Aleppo", country: "Syria", lat: 36.2021, lon: 37.1343, aliases: ["aleppo"] },
  { name: "Sanaa", country: "Yemen", lat: 15.3694, lon: 44.191, aliases: ["yemen", "sanaa"] },
  { name: "Aden", country: "Yemen", lat: 12.7855, lon: 45.0187, aliases: ["aden"] },
  { name: "Hodeidah", country: "Yemen", lat: 14.7978, lon: 42.9545, aliases: ["hodeidah", "hudaydah"] },
  { name: "Beirut", country: "Lebanon", lat: 33.8938, lon: 35.5018, aliases: ["lebanon", "beirut"] },
  { name: "Tyre", country: "Lebanon", lat: 33.2704, lon: 35.2038, aliases: ["tyre", "sour"] },
  { name: "Jerusalem", country: "Israel", lat: 31.7683, lon: 35.2137, aliases: ["israel", "jerusalem"] },
  { name: "Tel Aviv", country: "Israel", lat: 32.0853, lon: 34.7818, aliases: ["tel aviv"] },
  { name: "Haifa", country: "Israel", lat: 32.794, lon: 34.9896, aliases: ["haifa"] },
  { name: "Gaza", country: "Palestine", lat: 31.5017, lon: 34.4668, aliases: ["gaza"] },
  { name: "Amman", country: "Jordan", lat: 31.9539, lon: 35.9106, aliases: ["jordan", "amman"] },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753, aliases: ["saudi", "riyadh"] },
  { name: "Jeddah", country: "Saudi Arabia", lat: 21.4858, lon: 39.1925, aliases: ["jeddah"] },
  { name: "Doha", country: "Qatar", lat: 25.2854, lon: 51.531, aliases: ["qatar", "doha"] },
  { name: "Manama", country: "Bahrain", lat: 26.2235, lon: 50.5876, aliases: ["bahrain", "manama"] },
  { name: "Kuwait City", country: "Kuwait", lat: 29.3759, lon: 47.9774, aliases: ["kuwait"] },
  { name: "Abu Dhabi", country: "UAE", lat: 24.4539, lon: 54.3773, aliases: ["abu dhabi"] },
  { name: "Dubai", country: "UAE", lat: 25.2048, lon: 55.2708, aliases: ["dubai"] },
  { name: "Muscat", country: "Oman", lat: 23.588, lon: 58.3829, aliases: ["oman", "muscat"] },
  { name: "Hormuz Strait", country: "Persian Gulf", lat: 26.5667, lon: 56.25, aliases: ["strait of hormuz", "hormuz"] },
  { name: "Red Sea", country: "International Waters", lat: 20.0, lon: 38.0, aliases: ["red sea"] },
  { name: "Mediterranean Sea", country: "International Waters", lat: 34.0, lon: 33.0, aliases: ["mediterranean"] },
];

const IRAN_NATIONAL_POINT: PlacePoint = {
  name: "Iran",
  country: "Iran",
  lat: IRAN_DEFAULT_CENTER.lat,
  lon: IRAN_DEFAULT_CENTER.lon,
  aliases: ["iran", "iranian"],
};

function countMatches(text: string, terms: string[]): { count: number; maxLength: number } {
  let count = 0;
  let maxLength = 0;

  for (const term of terms) {
    if (text.includes(term)) {
      count += 1;
      maxLength = Math.max(maxLength, term.length);
    }
  }

  return { count, maxLength };
}

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
  country: string;
  isGeoPrecise: boolean;
} {
  const lowered = text.toLowerCase();

  const candidates: PlacePoint[] = [
    ...IRAN_CITIES.map((city) => ({
      name: city.name,
      country: "Iran",
      lat: city.lat,
      lon: city.lon,
      aliases: [city.name.toLowerCase()],
    })),
    IRAN_NATIONAL_POINT,
    ...GLOBAL_US_IRAN_THEATER_LOCATIONS,
  ];

  let best: {
    point: PlacePoint;
    score: number;
    specificity: number;
  } | null = null;

  for (const point of candidates) {
    const terms = [point.name.toLowerCase(), ...(point.aliases ?? []).map((alias) => alias.toLowerCase())];
    const { count, maxLength } = countMatches(lowered, terms);
    if (count === 0) {
      continue;
    }

    if (!best || count > best.score || (count === best.score && maxLength > best.specificity)) {
      best = {
        point,
        score: count,
        specificity: maxLength,
      };
    }
  }

  if (best) {
    return {
      placeName: best.point.name,
      lat: best.point.lat,
      lon: best.point.lon,
      country: best.point.country,
      isGeoPrecise: best.point.name !== "Iran",
    };
  }

  return {
    placeName: "Location (unspecified)",
    lat: IRAN_DEFAULT_CENTER.lat,
    lon: IRAN_DEFAULT_CENTER.lon,
    country: "Unknown",
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
