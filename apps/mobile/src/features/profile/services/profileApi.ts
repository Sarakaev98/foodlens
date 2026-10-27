import type { UserNutritionProfile, UserNutritionProfileInput, ValidationIssue } from '@foodlens/core';
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
      return await apiClient.get<UserNutritionProfile>('/profile');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  async save(input: UserNutritionProfileInput): Promise<UserNutritionProfile> {
    try {
      return await apiClient.put<UserNutritionProfile>('/profile', input);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) throw new ProfileValidationError(readIssues(error.body));
      throw error;
    }
  },
};
