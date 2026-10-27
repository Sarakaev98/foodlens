export { createDatabaseClient, type DatabaseClient, type DatabaseClientOptions } from './database-client';
export type {
  Allergen as DbAllergen,
  ActivityLevel as DbActivityLevel,
  BiologicalSex as DbBiologicalSex,
  DietaryPreference as DbDietaryPreference,
  NutritionGoal as DbNutritionGoal,
  UserNutritionProfile as DbUserNutritionProfile,
} from './generated/prisma/client';
