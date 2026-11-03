import { normalizeDietaryPreferences, type UserNutritionProfile, type UserNutritionProfileInput, type ValidationIssue } from '@foodlens/core';
import { ApiError, apiClient } from '@/shared/api';

/** Сервер отклонил данные профиля. */
export class ProfileValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super('Profile validation failed');
    this.name = 'ProfileValidationError';
  }
}

function readIssues(body: unknown): readonly ValidationIssue[] {
  if (typeof body === 'object' && body !== null && 'issues' in body && Array.isArray(body.issues)) {
    return body.issues as ValidationIssue[];
  }
  return [];
}

export const profileApi = {
  /** null — профиля ещё нет, нужен onboarding. */
  async get(): Promise<UserNutritionProfile | null> {
    try {
      const profile = await apiClient.get<UserNutritionProfile>('/profile');
      return { ...profile, dietaryPreferences: normalizeDietaryPreferences(profile.dietaryPreferences) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  async save(input: UserNutritionProfileInput): Promise<UserNutritionProfile> {
    try {
      const profile = await apiClient.put<UserNutritionProfile>('/profile', { ...input, dietaryPreferences: normalizeDietaryPreferences(input.dietaryPreferences) });
      return { ...profile, dietaryPreferences: normalizeDietaryPreferences(profile.dietaryPreferences) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) throw new ProfileValidationError(readIssues(error.body));
      throw error;
    }
  },
};
