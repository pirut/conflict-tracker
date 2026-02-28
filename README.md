# Iran Live Situation Dashboard

Production-grade realtime dashboard built with Next.js App Router + Convex.

## Stack
- Frontend: Next.js 16 (App Router), TypeScript, TailwindCSS, React Leaflet, Recharts
- Backend: Convex (TypeScript)
- Realtime: Convex subscriptions (`useQuery`)
- Deployment: Vercel + Convex Cloud

## What It Does
- Aggregates **Confirmed News** from multi-source adapters:
  - GDELT 2.1
  - Guardian API
  - Optional key-based APIs: NewsAPI, GNews, MediaStack, NYTimes, NewsData, TheNewsAPI
  - RSS API-style feeds: BBC, Al Jazeera, NYTimes World, Guardian World
- Aggregates **Signals**:
  - NASA FIRMS hotspots
  - OpenSky flight snapshots
  - Connectivity adapter with pluggable provider + OONI anomaly telemetry
- Supports optional **Social feed** adapters (always unverified):
  - Custom social endpoint
  - Reddit JSON API enrichment
  - Mock fallback when enabled but no live social source is available
- Clusters duplicate reports into unified events
- Computes dynamic confidence scores and confidence labels
- Separates News vs Signals vs Social in UI
- Stores and evaluates user alert rules with in-app notifications
- Auto-translates dashboard content to user/browser language with DeepL or LibreTranslate fallback

## Safety UX
- Banner disclaimer shown on dashboard:
  - `Signals and social reports may be incomplete or inaccurate. Confidence reflects corroboration, not certainty.`
- Social-only reports are labeled `UNVERIFIED`
- Raw source links are shown on event cards and in event drawer
- Contradictory reports set event conflict state instead of silent merge

## Convex Data Model
- `events`
- `sources`
- `signals`
- `ingestRuns`
- `alerts`
- `notifications`

See [convex/schema.ts](./convex/schema.ts).

## Ingestion Schedules
Defined in [convex/crons.ts](./convex/crons.ts):
- `ingestGdelt()` every 2 minutes
- `ingestFirms()` every 5 minutes
- `ingestFlights()` every 5 minutes
- `ingestConnectivity()` every 5 minutes
- `ingestSocial()` every 5 minutes only when `ENABLE_SOCIAL_INGESTION=true`

## Public Convex API
Implemented in [convex/events.ts](./convex/events.ts):
- Queries:
  - `getEvents({ since, until, minConfidence, category, types, q })`
  - `getEventById(id)`
  - `getSignals(type)`
  - `getStats()`
- Mutations:
  - `upsertEvent`
  - `attachSource`
  - `createAlert`
  - `deleteAlert`

## Clustering + Confidence
Implemented in:
- [convex/lib/clustering.ts](./convex/lib/clustering.ts)
- [convex/lib/confidence.ts](./convex/lib/confidence.ts)
- [convex/ingestionPipeline.ts](./convex/ingestionPipeline.ts)

Rules implemented:
- Cluster by:
  - time window ±45 minutes
  - geo proximity ≤30km
  - keyword similarity / category match
- Confidence base:
  - news: 60
  - signals: 40
  - social: 20
- Confidence modifiers:
  - +15 per independent news source (max +30)
  - +10 signals corroboration
  - +10 geo precise
  - -15 if only social after 60 mins
  - -10 conflicting reports
- Labels:
  - `High >= 75`
  - `Medium 45-74`
  - `Low < 45`

## Local Setup

### 1) Scaffold command (reference)
This project was created with:

```bash
npx create-next-app@latest conflict-tracker --typescript --tailwind --eslint --app --use-npm --no-src-dir
```

### 2) Install dependencies
```bash
npm install
```

### 3) Configure environment
Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required:
- `NEXT_PUBLIC_CONVEX_URL`

Optional:
- `GUARDIAN_API_KEY` (`test` works for low-volume)
- `NEWSAPI_KEY`
- `GNEWS_API_KEY`
- `MEDIASTACK_API_KEY`
- `NYTIMES_API_KEY`
- `NEWSDATA_API_KEY`
- `THENEWSAPI_KEY`
- `PREFERRED_NEWS_LANGUAGE`
- `INCLUDE_NON_ENGLISH_NEWS`
- `FIRMS_API_KEY`
- `FIRMS_SATELLITE`
- `OPENSKY_USERNAME`
- `OPENSKY_PASSWORD`
- `CONNECTIVITY_PROVIDER` (`mock` default)
- `CONNECTIVITY_INCLUDE_OONI`
- `ENABLE_SOCIAL_INGESTION`
- `SOCIAL_FEED_ENDPOINT`
- `SOCIAL_FEED_TOKEN`
- `SOCIAL_REDDIT_ENABLED`
- `DEEPL_API_KEY`

### 4) Start Convex dev
```bash
npx convex dev
```

This step links/creates your Convex deployment and generates real `convex/_generated/*` bindings.

### 5) Run Next.js
```bash
npm run dev
```

### Validation
```bash
npm run lint
npm run build
```

## Deploy (Convex + Vercel)

### 1) Deploy Convex backend
```bash
npx convex deploy
```

### 2) Set frontend env to Convex production URL
In Vercel project settings, set:
- `NEXT_PUBLIC_CONVEX_URL=<your convex production url>`

### 3) Deploy Next.js to Vercel
```bash
npx vercel --prod
```

## Notes
- `convex/_generated/api.ts` and `convex/_generated/server.ts` in this repo are temporary compile stubs for one-shot buildability; `npx convex dev` overwrites them with real generated bindings.
