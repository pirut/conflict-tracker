export const IRAN_DEFAULT_CENTER = { lat: 32.4279, lon: 53.688 };

export const EVENT_CATEGORIES = [
  "strike",
  "explosion",
  "air_defense",
  "missile",
  "drone",
  "refinery",
  "nuclear",
  "military_base",
  "connectivity",
  "flight",
  "fire",
  "other",
] as const;

export const SOURCE_TYPES = ["news", "signals", "social"] as const;

export const CONFIDENCE_LABELS = ["High", "Medium", "Low"] as const;

export const SIGNAL_TYPES = ["connectivity", "flight", "firms"] as const;

export const INGEST_STATUS = ["running", "success", "failed"] as const;

export const ALERT_KINDS = ["strike_proximity", "connectivity_drop"] as const;

export const ALERT_SEVERITIES = ["low", "medium", "high"] as const;

export const NEWS_QUERY_KEYWORDS = [
  "Iran",
  "Tehran",
  "Isfahan",
  "Natanz",
  "Qom",
  "Tabriz",
  "strike",
  "explosion",
  "air defense",
  "missile",
  "drone",
  "refinery",
  "nuclear",
  "military base",
] as const;

export const IRAN_CITIES = [
  { name: "Tehran", lat: 35.6892, lon: 51.389 },
  { name: "Isfahan", lat: 32.6546, lon: 51.668 },
  { name: "Shiraz", lat: 29.5918, lon: 52.5837 },
  { name: "Mashhad", lat: 36.2605, lon: 59.6168 },
  { name: "Tabriz", lat: 38.0962, lon: 46.2738 },
  { name: "Qom", lat: 34.6416, lon: 50.8746 },
  { name: "Natanz", lat: 33.5121, lon: 51.9162 },
  { name: "Ahvaz", lat: 31.3183, lon: 48.6706 },
  { name: "Kermanshah", lat: 34.3142, lon: 47.065 },
] as const;

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  strike: ["strike", "attack", "hit", "shelling"],
  explosion: ["explosion", "blast", "detonation"],
  air_defense: ["air defense", "anti-air", "intercept"],
  missile: ["missile", "ballistic", "rocket"],
  drone: ["drone", "uav", "quadcopter"],
  refinery: ["refinery", "petrochemical", "oil facility"],
  nuclear: ["nuclear", "uranium", "enrichment", "reactor"],
  military_base: ["military base", "garrison", "barracks", "airbase"],
  connectivity: ["internet", "connectivity", "shutdown", "outage"],
  flight: ["flight", "air traffic", "aviation", "airspace"],
  fire: ["wildfire", "hotspot", "thermal anomaly", "fire"],
};

export const TRUSTED_NEWS_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "aljazeera.com",
  "theguardian.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "guardian.co.uk",
] as const;

export const IRAN_RELEVANCE_TERMS = [
  "iran",
  "iranian",
  "tehran",
  "isfahan",
  "natanz",
  "qom",
  "tabriz",
  "shiraz",
  "mashhad",
  "ahvaz",
  "irgc",
  "islamic republic",
] as const;

export const CONFLICT_RELEVANCE_TERMS = [
  "strike",
  "explosion",
  "blast",
  "air defense",
  "missile",
  "drone",
  "attack",
  "intercept",
  "military",
  "base",
  "refinery",
  "nuclear",
  "uranium",
  "rocket",
  "raid",
] as const;

export const NOISE_TERMS = [
  "football",
  "soccer",
  "movie",
  "celebrity",
  "music",
  "tv",
  "fashion",
] as const;
