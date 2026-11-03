# Dietary type

Profiles expose exactly one of four choices:

| Wire value | UI label |
|---|---|
| none | Без ограничений |
| vegetarian | Вегетарианство |
| vegan | Веганство |
| pescatarian | Пескетарианство |

## Validation and compatibility

The API retains the array-shaped `dietaryPreferences` field for client
compatibility. Current profile writes accept one supported selection; duplicate
values are deduplicated. New multi-selections, unknown values and empty
selections are rejected. Onboarding and profile editing use the same validation.

Retired `halal`/`other` values are recognized only at compatibility boundaries,
not as active enum or UI options. A legacy-only selection becomes `['none']`.
If an older array also contains a supported restriction, the first supported
non-neutral selection in its existing order is preserved. Persisted old
multi-select arrays use the same deterministic rule. Allergens and avoided
ingredients are unchanged.

Shared normalization covers database mapping, profile writes, mobile API
responses, drafts, profile summaries, nutrition targets, Meal Plan inputs and
Goal Match inputs. The dietary control uses a single-select radio component;
allergens retain their separate multi-select control.

Meal Plan cache identity includes dietary preferences and other restrictions as
well as targets. A diet change invalidates the previous cached plan even when
calories and macros are unchanged.

No independent product-certification logic is changed. Only retired
profile-based dietary restrictions and their UI explanations are removed.

## Database migration

`20261103130000_simplify_dietary_preferences` normalizes existing arrays and then
recreates the PostgreSQL `DietaryPreference` enum with four members inside one
transaction. Historical migrations remain unchanged.

Apply the migration before starting an API with the regenerated Prisma client:

```sh
pnpm --filter @foodlens/database db:deploy
pnpm --filter @foodlens/database db:generate
pnpm typecheck
```

## Tests

```sh
pnpm test
pnpm typecheck
pnpm --filter @foodlens/api build
```

Regression coverage includes four radio labels and a single selection,
onboarding/edit validation, legacy read/save responses, database mapping,
neutral defaults, Meal Plan cache invalidation and provider inputs, and Goal
Match handling of retired values. SQL migration checks cover legacy-only,
mixed, empty and multiple-selection arrays before the enum is narrowed.
