import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, FormScreen, typography } from '@/shared/ui';
import { ActivityLevelField } from '../components/ActivityLevelField';
import { BasicInfoFields } from '../components/BasicInfoFields';
import { FoodPreferencesFields } from '../components/FoodPreferencesFields';
import { GoalField } from '../components/GoalField';
import { useDraftValidation } from '../hooks/useDraftValidation';
import { useSaveProfile } from '../hooks/useSaveProfile';
import { ALL_PROFILE_FIELDS, draftFromProfile } from '../profileDraft';
import { useProfile } from '../state/ProfileProvider';
import type { UserNutritionProfileDraft } from '../types/profile.types';

export function ProfileEditScreen() {
  const state = useProfile();
  const profile = state.status === 'ready' ? state.profile : null;
  if (!profile) return null;
  return <ProfileEditForm initialDraft={draftFromProfile(profile)} />;
}

function ProfileEditForm({ initialDraft }: { readonly initialDraft: UserNutritionProfileDraft }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const { issues, attempt } = useDraftValidation(draft, ALL_PROFILE_FIELDS);
  const { saveDraft, saving, error } = useSaveProfile();
  const update = (patch: UserNutritionProfileDraft) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    if (!attempt()) return;
    const saved = await saveDraft(draft);
    if (saved) router.back();
  };

  return (
    <FormScreen
      safeTop={false}
      footer={
        <>
          {error ? <Text style={typography.error}>{error}</Text> : null}
          <Button label="Сохранить" onPress={submit} loading={saving} />
        </>
      }
    >
      <GoalField draft={draft} onChange={update} issues={issues} />
      <BasicInfoFields draft={draft} onChange={update} issues={issues} />
      <ActivityLevelField draft={draft} onChange={update} issues={issues} />
      <FoodPreferencesFields draft={draft} onChange={update} issues={issues} />
    </FormScreen>
  );
}
