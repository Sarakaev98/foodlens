import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserNutritionProfile, UserNutritionProfileInput } from '@foodlens/core';
import { ProfileRepository } from './profile.repository';

@Injectable()
export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  async getProfile(userId: string): Promise<UserNutritionProfile> {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  /** Создаёт профиль при первом сохранении (onboarding) и обновляет при следующих. */
  saveProfile(userId: string, input: UserNutritionProfileInput): Promise<UserNutritionProfile> {
    return this.profiles.upsertByUserId(userId, input);
  }
}
