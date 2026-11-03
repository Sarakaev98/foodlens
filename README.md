# FoodLens

A pnpm workspaces monorepo.

```
apps/
  mobile/     React Native + Expo (Expo Router), TypeScript
  api/        NestJS
packages/
  core/       shared domain types (Product, NutritionFacts, MealPlan, ProductScore...) and feature flags
  scoring/    Scoring Engine: deterministic Product Score and Goal Match (depends only on core)
  nutrition/  Nutrition Engine: daily calorie and macro targets from the profile, Meal Plan validation (plain TS)
  ai/         AIProvider interface with Google (Gemini), Meta and mock providers
  database/   Prisma + PostgreSQL
```

Package dependency graph:

```
core  <-  scoring
core  <-  nutrition
core  <-  ai
core  <-  mobile
core, ai, nutrition, scoring, database  <-  api
```

## Requirements

- Node.js 20+
- pnpm 10 (`corepack enable`)
- PostgreSQL 16 (or `docker compose up -d`)

## Getting started

```bash
pnpm install

# Database: PostgreSQL + migrations
docker compose up -d
cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
pnpm db:deploy

# API: http://localhost:3000/health, /feature-flags, /profile, /nutrition-targets, /meal-plan, POST /scan/analyze
pnpm dev:api

# Mobile: Expo dev server (QR code for Expo Go, `w` for web, `a` for Android)
pnpm dev:mobile
```

The shared packages are built into `dist` (`pnpm build:packages`) before the apps start;
the `dev:*` scripts do this automatically.

Other commands:

```bash
pnpm typecheck      # type-check the whole monorepo
pnpm test           # unit tests (node:test) in every package and app that has them
pnpm build          # build the packages and the API
pnpm db:generate    # generate the Prisma Client
pnpm db:migrate     # prisma migrate dev: create a migration after changing schema.prisma
pnpm db:deploy      # apply existing migrations
```

## Feature flags

The flag registry lives in `packages/core/src/feature-flags`. All flags are on by default.
To turn a feature off without removing code:

- mobile: `EXPO_PUBLIC_FEATURE_MEAL_PLAN=false` in `apps/mobile/.env`
- api: `FEATURE_MEAL_PLAN=false` in `apps/api/.env`

To add a flag, add the key to `DEFAULT_FEATURE_FLAGS` and the env variable to
`apps/mobile/src/shared/feature-flags/featureFlags.config.ts` (TypeScript will point out what is missing).

## API address in mobile

By default the mobile app calls the API on the same computer that runs Expo
(the dev server host, port 3000). This works on web, in an emulator and on a phone on the same Wi-Fi network.
Otherwise set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.

## Product scan

Flow: camera barcode or photo → `POST /scan/analyze` (multipart: `image`/`images`, optional `barcode`)
→ barcode sources (Open Food Facts, then optional web search for missing fields)
→ photo analysis by the AI provider when data is still missing → normalized `Product` from `@foodlens/core`
→ Product Score and Goal Match from the same merged nutrition.

The AI provider is chosen with `AI_PROVIDER` in `apps/api/.env`: `google` (Gemini through Vertex AI),
`meta` (Meta Model API) or `mock`. Keys are set **only** in `apps/api/.env`, for example:

```
AI_PROVIDER=google
GOOGLE_API_KEY=...
GOOGLE_CLOUD_PROJECT=...
```

Keys never reach mobile, `EXPO_PUBLIC_*` or git (`.env` is in `.gitignore`). Without a key the API
still starts, and scanning answers `503 AI_NOT_CONFIGURED`. Photos are processed in memory
and never stored. See `apps/api/.env.example` for every option, including `PRODUCT_LOOKUP`,
`WEB_SEARCH_LOOKUP` and `GOAL_MATCH_AI`.

### Without a key: the mock provider

To walk through the whole Scan flow (camera → analysis → result screen) without an AI key, set this in `apps/api/.env`:

```
AI_PROVIDER=mock
```

and restart the API. Every photo then returns the same demo product (Greek yogurt):
a fixture in the Meta response format from `packages/ai/src/providers/mock/mock-product-analysis.ts`
that goes through the same schema check and the same normalizer. The photo is still validated
(type and size) but never sent anywhere. Mock is only used when set explicitly: a real provider
without a key still answers `503 AI_NOT_CONFIGURED`.
