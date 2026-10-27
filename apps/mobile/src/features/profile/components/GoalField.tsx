import { NUTRITION_GOALS, type ValidationIssue } from '@foodlens/core';
import { ChoiceList, FormField } from '@/shared/ui';
import { findIssueMessage } from '@/shared/validation';
import { GOAL_LABELS } from '../profile.labels';
import type { DraftChange, UserNutritionProfileDraft } from '../types/profile.types';

const OPTIONS = NUTRITION_GOALS.map((value) => ({ value, label: GOAL_LABELS[value] }));

interface GoalFieldProps {
  readonly draft: UserNutritionProfileDraft;
  readonly onChange: DraftChange;
  readonly issues: readonly ValidationIssue[];
}

export function GoalField({ draft, onChange, issues }: GoalFieldProps) {
  return (
    <FormField label="Цель" error={findIssueMessage(issues, 'goal')}>
      <ChoiceList options={OPTIONS} value={draft.goal} onChange={(goal) => onChange({ goal })} />
    </FormField>
  );
}
