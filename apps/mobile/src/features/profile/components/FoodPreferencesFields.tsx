import {
  ALLERGEN_CODES,
  DIETARY_PREFERENCES,
  PROFILE_LIMITS,
  type AllergenCode,
  normalizeDietaryPreferences,
  type ValidationIssue,
} from '@foodlens/core';
import { ChipGroup, ChoiceList, FormField, TagInput } from '@/shared/ui';
import { findIssueMessage } from '@/shared/validation';
import { ALLERGEN_LABELS, DIETARY_PREFERENCE_LABELS } from '../profile.labels';
import type { DraftChange, UserNutritionProfileDraft } from '../types/profile.types';

const DIET_OPTIONS = DIETARY_PREFERENCES.map((value) => ({ value, label: DIETARY_PREFERENCE_LABELS[value] }));
const ALLERGEN_OPTIONS = ALLERGEN_CODES.map((value) => ({ value, label: ALLERGEN_LABELS[value] }));

function toggle<T>(current: readonly T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

interface FoodPreferencesFieldsProps {
  readonly draft: UserNutritionProfileDraft;
  readonly onChange: DraftChange;
  readonly issues: readonly ValidationIssue[];
}

export function FoodPreferencesFields({ draft, onChange, issues }: FoodPreferencesFieldsProps) {
  const [dietaryPreference] = normalizeDietaryPreferences(draft.dietaryPreferences);
  const allergens = draft.allergens ?? [];

  return (
    <>
      <FormField label="Тип питания" error={findIssueMessage(issues, 'dietaryPreferences')}>
        <ChoiceList
          options={DIET_OPTIONS}
          value={dietaryPreference}
          onChange={(value) => onChange({ dietaryPreferences: [value] })}
        />
      </FormField>
      <FormField label="Аллергены" hint="Отметьте, если есть" error={findIssueMessage(issues, 'allergens')}>
        <ChipGroup
          options={ALLERGEN_OPTIONS}
          selected={allergens}
          onToggle={(value: AllergenCode) => onChange({ allergens: toggle(allergens, value) })}
        />
      </FormField>
      <FormField
        label="Не хочу в составе"
        hint="Ингредиенты, которых вы избегаете"
        error={findIssueMessage(issues, 'avoidedIngredients')}
      >
        <TagInput
          accessibilityLabel="Ингредиент, которого вы избегаете"
          values={draft.avoidedIngredients ?? []}
          onChange={(avoidedIngredients) => onChange({ avoidedIngredients })}
          placeholder="Например, кинза"
          maxLength={PROFILE_LIMITS.avoidedIngredients.maxLength}
        />
      </FormField>
    </>
  );
}
