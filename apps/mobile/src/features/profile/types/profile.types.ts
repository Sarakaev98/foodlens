import type { UserNutritionProfileInput } from '@foodlens/core';

/** Профиль в процессе заполнения: любые поля могут отсутствовать или быть некорректными. */
export type UserNutritionProfileDraft = { -readonly [K in keyof UserNutritionProfileInput]?: UserNutritionProfileInput[K] };

export type DraftChange = (patch: UserNutritionProfileDraft) => void;
