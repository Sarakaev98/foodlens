-- CreateEnum
CREATE TYPE "NutritionGoal" AS ENUM ('lose_weight', 'maintain_weight', 'gain_weight', 'eat_healthier');

-- CreateEnum
CREATE TYPE "BiologicalSex" AS ENUM ('female', 'male');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('sedentary', 'light', 'moderate', 'active', 'very_active');

-- CreateEnum
CREATE TYPE "DietaryPreference" AS ENUM ('none', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'other');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs');

-- CreateTable
CREATE TABLE "user_nutrition_profiles" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "goal" "NutritionGoal" NOT NULL,
    "age" INTEGER NOT NULL,
    "sex" "BiologicalSex" NOT NULL,
    "height_cm" DOUBLE PRECISION NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "activity_level" "ActivityLevel" NOT NULL,
    "dietary_preferences" "DietaryPreference"[],
    "allergens" "Allergen"[],
    "avoided_ingredients" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_nutrition_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_nutrition_profiles_user_id_key" ON "user_nutrition_profiles"("user_id");
