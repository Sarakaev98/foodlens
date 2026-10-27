# FoodLens

Монорепозиторий (pnpm workspaces).

```
apps/
  mobile/     React Native + Expo (Expo Router), TypeScript
  api/        NestJS
packages/
  core/       общие доменные типы (Product, NutritionFacts, MealPlan, ProductScore...) и feature flags
  scoring/    Scoring Engine (контракт, без логики; зависит только от core)
  nutrition/  Nutrition Engine: дневные цели по калориям и БЖУ из профиля (чистый TS)
  ai/         интерфейс AIProvider и каркас MetaProvider
  database/   Prisma + PostgreSQL
```

Граф зависимостей пакетов:

```
core  <-  scoring
core  <-  nutrition
core  <-  ai
core  <-  mobile
core, ai, nutrition, database  <-  api
```

## Требования

- Node.js 20+
- pnpm 10 (`corepack enable`)
- PostgreSQL 16 (или `docker compose up -d`)

## Запуск

```bash
pnpm install

# База: PostgreSQL + миграции
docker compose up -d
cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
pnpm db:deploy

# API: http://localhost:3000/health, /feature-flags, /profile
pnpm dev:api

# Mobile: Expo Dev Server (QR для Expo Go, `w` — web, `a` — Android)
pnpm dev:mobile
```

Перед запуском приложений общие пакеты собираются в `dist` (`pnpm build:packages`),
это делают скрипты `dev:*` автоматически.

Прочее:

```bash
pnpm typecheck      # проверка типов во всём монорепо
pnpm test           # unit tests (node:test, сейчас packages/nutrition)
pnpm build          # сборка пакетов и API
pnpm db:generate    # сгенерировать Prisma Client
pnpm db:migrate     # prisma migrate dev: создать миграцию после изменения schema.prisma
pnpm db:deploy      # применить существующие миграции
```

## Feature flags

Реестр флагов — `packages/core/src/feature-flags`. По умолчанию все включены.
Выключение без удаления кода:

- mobile: `EXPO_PUBLIC_FEATURE_MEAL_PLAN=false` в `apps/mobile/.env`
- api: `FEATURE_MEAL_PLAN=false` в `apps/api/.env`

Новый флаг: добавить ключ в `DEFAULT_FEATURE_FLAGS` и env-переменную в
`apps/mobile/src/shared/feature-flags/featureFlags.config.ts` (TypeScript подскажет).

## Адрес API в mobile

По умолчанию mobile обращается к API на том же компьютере, где запущен Expo
(хост dev server, порт 3000). Это работает в web, в эмуляторе и на телефоне в той же Wi-Fi сети.
Иначе задайте `EXPO_PUBLIC_API_URL` в `apps/mobile/.env`.
