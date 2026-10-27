import { Injectable } from '@nestjs/common';
import type { NutritionTargets } from '@foodlens/core';
import { calculateNutritionTargets } from '@foodlens/nutrition';
import { ProfileService } from '../profile/profile.service';

/**
 * Цели всегда считаются из актуального профиля и нигде не хранятся,
 * поэтому изменение профиля сразу отражается в следующем запросе.
 */
@Injectable()
export class NutritionTargetsService {
  constructor(private readonly profiles: ProfileService) {}

  /** Бросает 404 (из ProfileService), если профиля ещё нет. */
  async getForUser(userId: string): Promise<NutritionTargets> {
    const profile = await this.profiles.getProfile(userId);
    return calculateNutritionTargets(profile);
  }
}
