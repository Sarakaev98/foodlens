import type { NutrientKey } from '@foodlens/core';
import type { EstimationProfile } from './nutrition-profiles';
import type { analyzeNutritionIngredients } from './nutrition-ingredient-signals';

type Ranges = Partial<Record<NutrientKey, readonly [number, number]>>;
/** Broad product-family bounds, not label targets. They never repair a measured source value. */
export function nutritionPlausibility(profile: EstimationProfile, signals: ReturnType<typeof analyzeNutritionIngredients>): Ranges {
  const sweetEvidence = signals.strongTopLevelSugar || signals.sugarPosition >= 0;
  const families: Record<string, Ranges> = {
    passata: { proteinG:[0,3], fatG:[0,2], carbsG:[0,12], sugarsG:[0,8], saltG:[0,1.5] },
    ketchup: { proteinG:[0,3], fatG:[0,5], carbsG:[0,40], sugarsG:[0,35], saltG:[0.5,4.5] },
    ketchup_no_sugar: { proteinG:[0,3], fatG:[0,5], carbsG:[0,15], sugarsG:[0,6], saltG:[0.5,4.5] },
    mayonnaise: { proteinG:[0,5], fatG:[40,85], carbsG:[0,12], sugarsG:[0,10], saltG:[0,3] },
    mustard: { proteinG:[0,12], fatG:[0,15], sugarsG:[0,15], saltG:[0.5,5] },
    soy_sauce: { proteinG:[0,15], fatG:[0,1], saltG:[3,5] },
    bbq: { proteinG:[0,4], fatG:[0,5], sugarsG:[0,50], saltG:[0.5,5] },
    yogurt: { fatG:[0,15], carbsG:[0,sweetEvidence?30:10], sugarsG:[0,sweetEvidence?35:8] },
    greek_yogurt: { proteinG:[0,25], fatG:[0,15], sugarsG:[0,sweetEvidence?35:8] },
    sweet_yogurt: { proteinG:[0,15], fatG:[0,15], carbsG:[0,30], sugarsG:[0,25] },
    soda: { proteinG:[0,1], fatG:[0,0.5], sugarsG:[0,18] },
    zero_soda: { proteinG:[0,1], fatG:[0,0.5], sugarsG:[0,1], carbsG:[0,3] },
    ready_meal: { sugarsG:[0,sweetEvidence?65:15], saltG:[0,5], fiberG:[0,20] },
    other: { proteinG:[0,30], fatG:[0,65], sugarsG:[0,50], saltG:[0,5] },
  };
  return families[profile.subtype] ?? families[profile.category] ?? {};
}
