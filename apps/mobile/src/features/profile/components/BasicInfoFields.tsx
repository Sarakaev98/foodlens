import { BIOLOGICAL_SEXES, PROFILE_LIMITS, type ValidationIssue } from '@foodlens/core';
import { ChipGroup, FormField, NumberInput } from '@/shared/ui';
import { findIssueMessage } from '@/shared/validation';
import { SEX_LABELS } from '../profile.labels';
import type { DraftChange, UserNutritionProfileDraft } from '../types/profile.types';

const SEX_OPTIONS = BIOLOGICAL_SEXES.map((value) => ({ value, label: SEX_LABELS[value] }));

interface BasicInfoFieldsProps {
  readonly draft: UserNutritionProfileDraft;
  readonly onChange: DraftChange;
  readonly issues: readonly ValidationIssue[];
}

export function BasicInfoFields({ draft, onChange, issues }: BasicInfoFieldsProps) {
  const ageError = findIssueMessage(issues, 'age');
  const heightError = findIssueMessage(issues, 'heightCm');
  const weightError = findIssueMessage(issues, 'weightKg');

  return (
    <>
      <FormField label="Age" error={ageError}>
        <NumberInput
          accessibilityLabel="Age"
          value={draft.age}
          onChange={(age) => onChange({ age })}
          unit="years"
          placeholder={`${PROFILE_LIMITS.age.min}–${PROFILE_LIMITS.age.max}`}
          invalid={ageError !== undefined}
        />
      </FormField>
      <FormField label="Sex" hint="Used to calculate your calorie target" error={findIssueMessage(issues, 'sex')}>
        <ChipGroup
          options={SEX_OPTIONS}
          selected={draft.sex ? [draft.sex] : []}
          onToggle={(sex) => onChange({ sex })}
        />
      </FormField>
      <FormField label="Height" error={heightError}>
        <NumberInput
          accessibilityLabel="Height"
          value={draft.heightCm}
          onChange={(heightCm) => onChange({ heightCm })}
          unit="cm"
          placeholder="170"
          invalid={heightError !== undefined}
        />
      </FormField>
      <FormField label="Weight" error={weightError}>
        <NumberInput
          accessibilityLabel="Weight"
          value={draft.weightKg}
          onChange={(weightKg) => onChange({ weightKg })}
          unit="kg"
          placeholder="70"
          invalid={weightError !== undefined}
        />
      </FormField>
    </>
  );
}
