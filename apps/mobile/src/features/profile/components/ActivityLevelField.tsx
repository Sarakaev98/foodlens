import { ACTIVITY_LEVELS, type ValidationIssue } from '@foodlens/core';
import { ChoiceList, FormField } from '@/shared/ui';
import { findIssueMessage } from '@/shared/validation';
import { ACTIVITY_LEVEL_LABELS } from '../profile.labels';
import type { DraftChange, UserNutritionProfileDraft } from '../types/profile.types';

const OPTIONS = ACTIVITY_LEVELS.map((value) => ({ value, ...ACTIVITY_LEVEL_LABELS[value] }));

interface ActivityLevelFieldProps {
  readonly draft: UserNutritionProfileDraft;
  readonly onChange: DraftChange;
  readonly issues: readonly ValidationIssue[];
}

export function ActivityLevelField({ draft, onChange, issues }: ActivityLevelFieldProps) {
  return (
    <FormField label="Activity" error={findIssueMessage(issues, 'activityLevel')}>
      <ChoiceList
        options={OPTIONS}
        value={draft.activityLevel}
        onChange={(activityLevel) => onChange({ activityLevel })}
      />
    </FormField>
  );
}
