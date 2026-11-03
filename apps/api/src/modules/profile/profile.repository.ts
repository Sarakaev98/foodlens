import { Inject, Injectable } from '@nestjs/common';
import { normalizeDietaryPreferences, type UserNutritionProfile, type UserNutritionProfileInput } from '@foodlens/core';
import type { DatabaseClient } from '@foodlens/database';
import { DATABASE_CLIENT } from '../database/database.tokens';
import { toUserNutritionProfile } from './user-nutrition-profile.mapper';

/** Хранение профилей. Единственное место модуля, которое знает о Prisma. */
@Injectable()
export class ProfileRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<UserNutritionProfile | null> {
    const row = await this.db.userNutritionProfile.findUnique({ where: { userId } });
    return row ? toUserNutritionProfile(row) : null;
  }

  async upsertByUserId(userId: string, input: UserNutritionProfileInput): Promise<UserNutritionProfile> {
    const data = {
      goal: input.goal,
      age: input.age,
      sex: input.sex,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      activityLevel: input.activityLevel,
      dietaryPreferences: normalizeDietaryPreferences(input.dietaryPreferences),
      allergens: [...input.allergens],
      avoidedIngredients: [...input.avoidedIngredients],
    };
    const row = await this.db.userNutritionProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toUserNutritionProfile(row);
  }
}
