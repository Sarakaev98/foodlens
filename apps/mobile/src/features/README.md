# Features

Each folder here is a self-contained app feature.

```
features/<feature>/
  screens/     screens (mounted in src/app as routes)
  components/  UI used only inside the feature
  hooks/       state and presentation logic
  services/    API calls through src/shared/api
  state/       minimal feature state (context) when several screens need it
  types/       feature types (shared domain types come from @foodlens/core)
  index.ts     the feature's public API
```

Rules:

- Subfolders are created only when they get code.
- From outside, a feature is imported only through `index.ts`, with no deep imports.
- A feature may use another one only through its `index.ts`, with no cycles.
  For example, `onboarding` reuses the form fields and saving from `profile`.
  Independent features know nothing about each other: `meal-plan` knows nothing about `scan`.
- Anything shared lives in `@foodlens/core` (models, validation) or `src/shared` (UI, API client).
- The UI never calls AI providers: only its own API through `services/`.
- Features are turned on and off with feature flags (`src/shared/feature-flags`);
  the route is guarded in `src/app`, and the feature code stays untouched.
