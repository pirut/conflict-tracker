# US-Iran Conflict Intelligence Desk

A rebuilt Next.js + Convex monitoring app focused on one job: high-signal aggregation and AI summarization of the active US-Iran conflict cycle.

## What Changed

This version was reset around data quality:

- Synthetic/mock ingestion is removed.
- News ingestion now defaults to strict trusted-domain filtering.
- Old/noisy rows are filtered by relevance + recency.
- Social ingestion is optional and heavily gated.
- AI briefing is now powered directly by OpenRouter using `OPEN_ROUTER_API`.

## Stack

- Frontend: Next.js 16, React 19, Tailwind 4
- Backend: Convex
- AI summarization: OpenRouter Chat Completions API

## Core Data Sources

- News (primary):
  - GDELT (strict filtering on accepted rows)
  - Guardian API
  - Curated RSS (BBC, Al Jazeera, NYTimes, Guardian, Reuters)
- Signals:
  - OONI connectivity anomalies
  - OpenSky (with ADSB.lol fallback) flight observations
  - NASA FIRMS hotspots (if `FIRMS_API_KEY` is set)
- Social (optional, unverified):
  - Reddit (quality-gated)
  - X recent search (quality-gated)
  - Custom social endpoint

## Environment

Copy `.env.example` to `.env.local` and fill what you use:

```bash
cp .env.example .env.local
```

### Required

- `NEXT_PUBLIC_CONVEX_URL`

### AI Briefing (required for model summaries)

- `OPEN_ROUTER_API`
- `OPEN_ROUTER_MODEL` (default: `openai/gpt-4o-mini`)
- `OPEN_ROUTER_MODEL_FALLBACKS` (optional comma-separated list for automatic retry on rate limits/outages)

If `OPEN_ROUTER_API` is missing or OpenRouter fails, the app falls back to deterministic local synthesis.

## Run Locally

1. Install deps:

```bash
npm install
```

2. Start Convex dev:

```bash
npx convex dev
```

3. Run Next.js:

```bash
npm run dev
```

## Ingestion Schedules

Defined in [`convex/crons.ts`](./convex/crons.ts):

- News every 2 minutes
- FIRMS every 5 minutes
- Flights every 5 minutes
- Connectivity every 5 minutes
- Social every 5 minutes (only when `ENABLE_SOCIAL_INGESTION=true`)

## Quality Controls

- Strict trust mode on by default: `STRICT_TRUSTED_NEWS=true`
- News recency window: `MAX_NEWS_AGE_HOURS=72`
- Social rows are never synthetic and are always marked unverified
- AI output is shown with mode (`ai` or `fallback`) and model metadata

## Validation

```bash
npm run lint
npm run build
```

## Operations

### Sync Vercel env vars into Convex

This pulls Vercel `development`, `preview`, and `production` env vars and syncs them to Convex dev and prod deployments (production values win on key conflicts):

```bash
npm run env:sync:vercel-convex
```

Optional: pass specific Vercel environments:

```bash
node scripts/sync-vercel-env-to-convex.mjs production
```

Optional: sync target control (`--dev`, `--prod`, or `--both` default):

```bash
node scripts/sync-vercel-env-to-convex.mjs --prod
```

### Wipe old data and reingest fresh

This purges legacy ingestion rows in batches and immediately runs ingestion again:

```bash
npm run data:wipe-reingest
```

Direct Convex call:

```bash
npx convex run admin:wipeOldDataAndReingest '{"confirm":"WIPE_AND_REINGEST","purgeAlerts":false,"includeSocial":true}'
```
