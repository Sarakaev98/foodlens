export { FireworksMealPlanProvider, FIREWORKS_MEAL_PLAN_MODEL, FIREWORKS_MEAL_PLAN_ENDPOINT, type FireworksMealPlanProviderConfig } from './providers/fireworks/fireworks-meal-plan-provider';
export { FireworksProductProvider, FIREWORKS_PRODUCT_MODEL, FIREWORKS_PRODUCT_ANALYSIS_VERSION, FIREWORKS_PRODUCT_RESPONSE_SCHEMA, type FireworksProductProviderConfig } from './providers/fireworks/fireworks-product-provider';
export { FireworksProductTextAI, FireworksProductGoalMatch, createFireworksProductTextTransport, productJsonSchema, type FireworksProductTextConfig } from './providers/fireworks/fireworks-product-text';
export type { AIProvider, AIProviderMethod } from './ai-provider';
export type * from './ai-provider.types';
export { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_ROLES, productImages } from './product-images';
export type { AILogger } from './ai-logger';
export { AIProviderError, AIMethodNotImplementedError, AIUnavailableError, type AIProviderErrorCode } from './errors';
export { MetaProvider, META_DEFAULT_BASE_URL, META_DEFAULT_MODEL, type MetaProviderConfig } from './providers/meta';
export {
  MockProvider, MOCK_GOAL_MATCH_MODEL, MOCK_GOAL_MATCH_RECORDINGS,
  type MockProviderConfig, type MockGoalMatchRecording,
} from './providers/mock';

export { MEAL_PHOTO_OUTPUT_SCHEMA, type MealPhotoAiItem, type MealPhotoAiOutput } from './meal-photo/meal-photo-output-schema';
export { GoogleMealPhotoProvider, GOOGLE_MEAL_PHOTO_TIMEOUT_MS, type GoogleMealPhotoProviderConfig } from './providers/google/google-meal-photo-provider';
export { MOCK_MEAL_PHOTO_OUTPUT } from './providers/mock/mock-meal-photo';
export type { GoalMatchEvaluator } from './goal-match-provider';
export { GoogleGoalMatchProvider, GOOGLE_GOAL_MATCH_MODEL, GOOGLE_GOAL_MATCH_TIMEOUT_MS, type GoogleGoalMatchProviderConfig } from './providers/google/google-goal-match-provider';
export { GoogleProvider, GOOGLE_PRODUCT_TIMEOUT_MS, type GoogleProviderConfig } from './providers/google/google-provider';
export { GoogleMealPlanProvider, GOOGLE_MEAL_PLAN_TIMEOUT_MS, type GoogleMealPlanProviderConfig } from './providers/google/google-meal-plan-provider';
export {
  GoogleNutritionSearch, GOOGLE_NUTRITION_EXTRACTION_SYSTEM_PROMPT, GOOGLE_NUTRITION_SEARCH_TIMEOUT_MS, GOOGLE_SOURCE_DISCOVERY_SYSTEM_PROMPT, MAX_EXTRACTION_TEXT_CHARS,
  type DiscoveredSource, type ExtractedPage, type ExtractionPage, type GoogleNutritionSearchConfig, type SourceDiscoveryInput, type SourceDiscoveryResponse,
} from './providers/google/google-nutrition-search';

export { FireworksMealPhotoProvider, FIREWORKS_MEAL_PHOTO_MODEL, FIREWORKS_MEAL_PHOTO_TIMEOUT_MS, type FireworksMealPhotoProviderConfig } from './providers/fireworks/fireworks-meal-photo-provider';
