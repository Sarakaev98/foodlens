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
  ai/         интерфейс AIProvider и MetaProvider (анализ фото продукта через Meta Model API)
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

# API: http://localhost:3000/health, /feature-flags, /profile, /nutrition-targets, POST /scan/analyze
pnpm dev:api

# Mobile: Expo Dev Server (QR для Expo Go, `w` — web, `a` — Android)
pnpm dev:mobile
```

Перед запуском приложений общие пакеты собираются в `dist` (`pnpm build:packages`),
это делают скрипты `dev:*` автоматически.

Прочее:

```bash
pnpm typecheck      # проверка типов во всём монорепо
pnpm test           # unit tests (node:test: packages/nutrition, packages/ai, apps/api)
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

## Сканирование продукта (Meta)

Цепочка: камера или галерея → `POST /scan/analyze` (multipart, поле `image`) → `MetaProvider`
→ Meta Model API (structured output по JSON Schema) → нормализатор → `Product` из `@foodlens/core`.

Ключ задаётся **только** в `apps/api/.env`:

```
MODEL_API_KEY=...
```

Ключ не попадает в mobile, `EXPO_PUBLIC_*` и git (`.env` в `.gitignore`). Без ключа API
запускается, а сканирование отвечает `503 AI_NOT_CONFIGURED`. Фото обрабатывается в памяти
и нигде не сохраняется.

### Без ключа: mock-провайдер

Чтобы пройти весь сценарий Scan (камера → анализ → экран результата) без Meta, в `apps/api/.env`:

```
AI_PROVIDER=mock
```

и перезапустите API. Любое фото тогда возвращает один и тот же демо-продукт (греческий йогурт):
это фикстура в формате ответа Meta из `packages/ai/src/providers/mock/mock-product-analysis.ts`,
которая проходит ту же проверку схемы и тот же нормализатор. Фото по-прежнему проверяется
(тип и размер), но в Meta не отправляется. Mock включается только явно: при `AI_PROVIDER=meta`
без ключа ответ остаётся `503 AI_NOT_CONFIGURED`. Для настоящего анализа верните `AI_PROVIDER=meta`.
