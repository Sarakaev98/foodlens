-- Normalize persisted legacy and multi-select profiles before removing enum members.
-- Preserve the first supported restriction; removed/empty-only arrays become neutral.
BEGIN;
UPDATE "user_nutrition_profiles" AS p
SET "dietary_preferences" = ARRAY[COALESCE((
  SELECT value FROM unnest(p."dietary_preferences"::text[]) WITH ORDINALITY AS old(value, position)
  WHERE value IN ('vegetarian', 'vegan', 'pescatarian')
  ORDER BY position LIMIT 1
), 'none')]::"DietaryPreference"[];

ALTER TYPE "DietaryPreference" RENAME TO "DietaryPreference_legacy";
CREATE TYPE "DietaryPreference" AS ENUM ('none', 'vegetarian', 'vegan', 'pescatarian');
ALTER TABLE "user_nutrition_profiles"
  ALTER COLUMN "dietary_preferences" TYPE "DietaryPreference"[]
  USING "dietary_preferences"::text[]::"DietaryPreference"[];
DROP TYPE "DietaryPreference_legacy";
COMMIT;
