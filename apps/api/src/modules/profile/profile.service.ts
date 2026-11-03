import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserNutritionProfile, UserNutritionProfileInput } from '@foodlens/core';
import { ProfileRepository } from './profile.repository';

@Injectable()
export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  async getProfile(userId: string): Promise<UserNutritionProfile> {
    const profile = await this.findProfile(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  /** null, если пользователь ещё не прошёл onboarding. */
  findProfile(userId: string): Promise<UserNutritionProfile | null> {
    return this.profiles.findByUserId(userId);
  }

  /** Создаёт профиль при первом сохранении (onboarding) и обновляет при следующих. */
  saveProfile(userId: string, input: UserNutritionProfileInput): Promise<UserNutritionProfile> {
    return this.profiles.upsertByUserId(userId, input);
  }
}
