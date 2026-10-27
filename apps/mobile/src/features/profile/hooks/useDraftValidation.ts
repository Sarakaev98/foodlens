import { useMemo, useState } from 'react';
import {
  validateUserNutritionProfileFields,
  type UserNutritionProfileField,
  type ValidationIssue,
} from '@foodlens/core';
import type { UserNutritionProfileDraft } from '../types/profile.types';

/**
 * Проверка черновика теми же правилами, что и на backend.
 * Ошибки показываются только после первой попытки отправки и дальше обновляются на лету.
 */
export function useDraftValidation(draft: UserNutritionProfileDraft, fields: readonly UserNutritionProfileField[]) {
  const [attempted, setAttempted] = useState(false);
  const issues = useMemo(() => validateUserNutritionProfileFields(draft, fields), [draft, fields]);

  return {
    issues: attempted ? issues : ([] as readonly ValidationIssue[]),
    /** Помечает попытку отправки и возвращает true, если поля корректны. */
    attempt: (): boolean => {
      setAttempted(true);
      return issues.length === 0;
    },
  };
}
