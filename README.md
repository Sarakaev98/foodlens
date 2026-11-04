# FoodLens

### Scan. Understand. Track. Plan.

**FoodLens is an AI-powered mobile nutrition assistant that turns food information into clear, personalized insights.** Scan a packaged product, understand a nutrition label, estimate a meal from a photo, track daily intake, and create a meal plan aligned with your goals—all in one app.

Built for the **Meta Global AI Developer Hackathon**, FoodLens uses **Meta Muse Spark Open via Fireworks AI** for its AI-powered scanning and meal-planning workflows, alongside its own nutrition and scoring engines.

## Why FoodLens?

Food choices happen in real life—in the supermarket, at lunch, and while planning the day. Nutrition information is often spread across packaging, databases, and calorie trackers. Even when the numbers are available, it is not always clear what they mean **for your own goals**.

**FoodLens turns those separate steps into one simple mobile experience:** recognize food, understand the result, see how it fits your goals, track your meals, and plan what to eat next.

## What makes FoodLens different?

### 1. Easy to use, wherever you eat

- **At the supermarket:** scan a barcode to see available nutrition data, ingredients, allergens, and explainable scores. FoodLens checks Open Food Facts first and uses Meta when further interpretation is needed.
- **Reading a label:** photograph a nutrition facts panel instead of manually copying its numbers.
- **At mealtime:** take a photo of a prepared meal to get estimated portions and nutrients, then use **Add to Today** to log that result without another AI call.
- **Planning ahead:** generate a day's meal suggestions using your personal targets and dietary preferences.

The workflow is designed around familiar actions—**scan, photograph, review, and add**—rather than requiring users to interpret raw nutrition tables on their own.

### 2. Two scores that answer different questions

Most importantly, **nutritional quality and personal suitability are not the same thing**. FoodLens makes that distinction visible:

| Score | Question it answers |
| --- | --- |
| **Product Score · 0–10** | How does this packaged food compare against general nutritional criteria? |
| **Goal Match · 0–10** | How well does this food fit *my* goals, targets, serving context, and dietary restrictions? |

**Product Score** considers available evidence about sugar, saturated fat, salt, protein, fiber, additives, and processing.

**Goal Match** uses the user's nutrition profile and selected goal—**lose weight, maintain weight, gain weight, or eat healthier**—to provide a separate, personalized assessment.

Both scores are calculated by **FoodLens's own algorithms** from normalized information and validated inputs. Meta helps interpret food information; it does **not** simply invent the scores.

### 3. Clear answers, not just numbers

FoodLens pairs scores with explanations and relevant nutrition context, helping users understand *why* a product receives a particular assessment. When information is missing or approximate, the app preserves that distinction instead of presenting guesses as confirmed facts.

### 4. From a single scan to a daily routine

The same mobile app connects **product and label scanning**, **meal-photo estimates**, **daily calorie and macro tracking**, and **personalized meal planning**. A recognized meal can be added directly to Today, and the user's profile informs personalized scores and suggestions.

### 5. AI where it adds value; reliable calculations in code

FoodLens combines **Meta Muse Spark Open** for image/text understanding and meal suggestions with Open Food Facts and independent nutrition/scoring logic. A sufficiently complete product lookup can skip unnecessary AI image analysis, while validated application logic handles the calculations and explanations.

## A day with FoodLens

1. **Choose smarter in the store:** scan a packaged product and compare Product Score with your personal Goal Match.
2. **Understand lunch:** photograph a prepared meal, review its approximate calorie and macro estimates, and add it to Today.
3. **Plan your meals:** request a one-day meal plan aligned with your profile, goals, and dietary restrictions.

**One app. Familiar actions. More personal nutrition insights.**

## Core features

| Feature | Experience |
| --- | --- |
| **Label Scan** | Photograph a nutrition label, extract nutritional values, and view Product Score and Goal Match. Label text can be translated for the English interface. |
| **Product Scan** | Scan a barcode to look up product information, or analyze packaging, ingredient, and nutrition photos when more information is needed. View nutrients, ingredients, allergens, and scores. |
| **Meal Scan** | Take a photo of a prepared meal and receive estimated components, portions, calories, protein, carbohydrates, fats, and a calorie range. |
| **Today** | Add an analyzed meal to your daily journal and compare calorie and macro totals against your personal targets. |
| **Meal Plan** | Generate a one-day plan with three meals—or four including a snack—aligned with personal targets, dietary preferences, and restrictions. |

### Product Scan: use reliable data first

```text
Barcode
           |
           v
Open Food Facts lookup
           |
           v
Optional enrichment, then Meta photo analysis if needed
           |
           v
Nutrition normalization and source-aware checks
           |
           v
Product Score + Goal Match + explanations
```

With a barcode, FoodLens first uses available product data from **Open Food Facts**. When the information is sufficiently complete, unnecessary AI image analysis is skipped. When more detail is needed, the app can analyze supplied photos and use configured enrichment sources, including **Tavily**. **FatSecret** is available with separate credentials.

Without a barcode, Product Scan begins with photo analysis and then applies any configured enrichment. When source data is insufficient, suitable nutrition or ingredient photos can help complete the result.

The pipeline preserves original ingredient information and distinguishes sourced values from estimates. Ingredient translation may use a separate Meta text request without requiring a new image analysis.

**Label Scan** also supports a direct nutrition-label photo workflow without a barcode.

### Meal Scan: from a photo to daily tracking

Meta identifies likely meal components and estimates portions. FoodLens then normalizes those estimates and calculates meal totals. Results can include nutritional values, confidence, a calorie range, and explanatory assumptions.

With **Add to Today**, the analyzed meal is added to the daily journal using the accepted result—without another AI request. The current demo journal is held in API memory and resets when the server restarts.

### Meal Plan: personalized suggestions, validated in code

FoodLens calculates daily energy and macronutrient targets using the nutrition profile. Meta proposes a day's meals, and FoodLens validates the plan against dietary preferences, allergens, avoided ingredients, portion requirements, and nutritional targets. When appropriate, the system can request a corrective generation through the same model. Detected dietary-restriction violations are rejected; calorie or macro deviations are surfaced through `withinTargets`. The latest accepted plan is cached in API memory for the current profile, so reopening it does not itself generate another plan.

**Nutrition note:** Photo-based portion and nutrition estimates are approximate. For food allergies, always verify ingredient and allergen information on the product packaging.

## Powered by Meta Muse Spark Open

FoodLens uses **Meta Muse Spark Open**, served through **Fireworks AI**, for four AI workflows:

- **Label Scan:** nutrition-label understanding and display translation.
- **Product Scan:** image/text analysis, ingredient extraction, and translation when needed.
- **Meal Scan:** meal-photo interpretation and structured component estimates.
- **Meal Plan:** personalized meal suggestions for validation by FoodLens.

| Configuration | Value |
| --- | --- |
| **Model** | `accounts/fireworks/models/muse-spark-open` |
| **Inference provider** | Fireworks AI |
| **API** | `https://api.fireworks.ai/inference/v1/chat/completions` |
| **Inputs** | Text and images, depending on the workflow |
| **Processing** | Structured outputs, parsing, validation, and nutrition normalization |

The backend routes each workflow to the explicitly configured provider. The documented setup selects **Fireworks / Meta Muse Spark Open** for all four AI workflows and Label translation. Product Scan's image analysis follows the existing data-completeness rules; display translation is a separate text task when needed.

**Meta interprets and generates. FoodLens calculates, checks, and explains.**

## Architecture and technology

| Layer | Technology |
| --- | --- |
| **Mobile** | React Native, Expo, Expo Router, TypeScript |
| **Backend** | NestJS REST API, TypeScript |
| **AI inference** | Meta Muse Spark Open via Fireworks AI |
| **Product information** | Open Food Facts; optional Tavily and FatSecret integrations |
| **Nutrition calculations** | FoodLens Nutrition Engine |
| **Personalized scoring** | FoodLens Product Score and Goal Match |
| **Profile persistence** | PostgreSQL, Prisma |

```text
apps/
  mobile/         React Native / Expo app
  api/            NestJS API and workflow orchestration
packages/
  ai/             AI adapters, prompts, contracts, and validation
  core/           Shared types and feature flags
  nutrition/      Nutrition targets and meal/plan validation
  scoring/        Product Score and Goal Match
  database/       Prisma and PostgreSQL schema
```

## Getting started

### Requirements

- Node.js (version **22.23.4** used in local verification)
- pnpm **10.28.0** (pinned by the project)
- Docker and Docker Compose for local PostgreSQL
- Compatible Expo Go installation or development build on iOS/Android
- A Fireworks AI API key with access to Meta Muse Spark Open

### 1. Clone the repository

```bash
git clone https://github.com/Sarakaev98/foodlens.git
cd foodlens
git switch main
```

### 2. Configure the environment

For a fresh setup, copy the sample files without overwriting existing local `.env` files:

```bash
cp apps/api/.env.example apps/api/.env
cp packages/database/.env.example packages/database/.env
cp apps/mobile/.env.example apps/mobile/.env
```

In PowerShell, `Copy-Item` can be used instead of `cp`.

In `apps/api/.env`, configure:

```dotenv
FIREWORKS_API_KEY=replace-with-your-private-key
LABEL_SCAN_AI_PROVIDER=fireworks
PRODUCT_SCAN_AI_PROVIDER=fireworks
MEAL_SCAN_AI_PROVIDER=fireworks
MEAL_PLAN_PROVIDER=fireworks
GOAL_MATCH_AI=off
PRODUCT_LOOKUP=open_food_facts
```

Set all four workflow flags explicitly to reproduce the Meta configuration. `GOAL_MATCH_AI=off` uses FoodLens's application-based Goal Match scoring.

Optional web enrichment:

```dotenv
WEB_SEARCH_LOOKUP=tavily
TAVILY_API_KEY=replace-with-your-private-key
```

Use the provided environment examples for database settings and optional integrations. **Keep API keys server-side**; never commit real `.env` files or expose secrets through `EXPO_PUBLIC_*` variables.

### 3. Install dependencies and start the database

```bash
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:deploy
```

Use matching `DATABASE_URL` values in the API and database environments for the included Docker setup.

### 4. Run the API and mobile app

From the repository root, open two terminals:

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:mobile
```

The API normally listens on port `3000`. Visit `http://localhost:3000/health` and expect:

```json
{"status":"ok"}
```

For a physical phone, use the same local network as the development computer. If needed, add the following to `apps/mobile/.env`, then restart Expo:

```dotenv
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3000
```

Complete nutrition-profile onboarding before trying personalized scoring or meal planning. Live analysis and generation calls can incur Fireworks usage charges.

## API overview

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API health check |
| `GET`, `PUT` | `/profile` | Read or update the nutrition profile |
| `GET` | `/nutrition-targets` | Calculate personal nutrition targets |
| `POST` | `/scan/analyze` | Product Scan or Label Scan (`mode=nutrition_label`) |
| `POST` | `/scan/meal` | Estimate a prepared meal from a photo |
| `GET` | `/meal-plan` | Read the latest plan |
| `POST` | `/meal-plan/generate` | Generate a daily plan (three or four meals) |
| `GET` | `/today?date=YYYY-MM-DD` | Read the daily journal |
| `POST` | `/today/entries` | Add a meal entry with duplicate protection |

## Tested and verified

The latest reported project checks completed **1,599 passing automated tests**, a successful **TypeScript typecheck**, and a successful **API build**. Coverage includes provider routing, data extraction, barcode/Open Food Facts behavior, nutrition normalization, scoring, dietary restrictions, meal planning, errors and timeouts, and daily tracking.

```bash
pnpm test
pnpm typecheck
pnpm build
```

Automated tests use controlled provider responses. The four workflows have also been exercised on a real iPhone, including a Meal Scan followed by **Add to Today**.

To start a built API process:

```bash
pnpm --filter @foodlens/api start
```

## Project repository

**GitHub:** [Sarakaev98/foodlens](https://github.com/Sarakaev98/foodlens)

---

**FoodLens brings Meta-powered food understanding together with transparent nutrition calculations, personalized scores, daily tracking, and practical meal planning—helping people make more informed food choices.**
