import { useState } from 'react';
import type { UserNutritionProfile, UserNutritionProfileField, ValidationIssue } from '@foodlens/core';
import { formatValidationIssue } from '@/shared/validation';
import { PROFILE_FIELD_LABELS } from '../profile.labels';
import { completeDraft } from '../profileDraft';
import { ProfileValidationError } from '../services/profileApi';
import { useProfile } from '../state/ProfileProvider';
import type { UserNutritionProfileDraft } from '../types/profile.types';

function describeIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => `${PROFILE_FIELD_LABELS[issue.field as UserNutritionProfileField] ?? issue.field}: ${formatValidationIssue(issue)}`)
    .join('\n');
}

/** Сохранение черновика профиля с состоянием загрузки и ошибкой для UI. */
export function useSaveProfile() {
  const { save } = useProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDraft = async (draft: UserNutritionProfileDraft): Promise<UserNutritionProfile | null> => {
    const completed = completeDraft(draft);
    if (!completed.ok) {
      setError(describeIssues(completed.issues));
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      return await save(completed.value);
    } catch (cause) {
      setError(
        cause instanceof ProfileValidationError
          ? describeIssues(cause.issues)
          : 'Не удалось сохранить. Проверьте подключение к серверу.',
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  return { saveDraft, saving, error };
}
