import { inferred, type Additive, type Allergen, type Detected, type Ingredient, type Product } from '@foodlens/core';
import { detectAllergens } from '@foodlens/nutrition';

/** E-номер в тексте состава: латинская или кириллическая Е, с пробелом или дефисом. */
const E_NUMBER = /(?:^|[^a-zа-яё0-9])[eе]\s?-?\s?(\d{3,4})([a-z]?)(?![0-9])/gi;
/** Явные добавки без номера. */
const ADDITIVE_WORDS = /консервант|краситель|красител[ья]|подсластител|сахарозаменител|усилител[а-я]* вкуса|ароматизатор|эмульгатор|стабилизатор|загустител|разрыхлител|регулятор[а-я]* кислотности|антиокислител|глутамат|аспартам|ацесульфам|сукралоз|сорбат|бензоат|preservative|colou?ring|sweetener|flavou?r enhancer|flavou?ring|emulsifier|stabili[sz]er|thickener|raising agent|acidity regulator|antioxidant/i;
const MAY_CONTAIN = /(?:может|могут) содержать|возможн[а-я]* (?:наличи|присутстви|содержани)|следы|следов|may contain|traces? of/i;
const MAX_NAME = 40;

/** Состав до фразы «может содержать» и после неё. */
function splitMayContain(text: string): { readonly contains: string; readonly mayContain: string } {
  const index = text.search(MAY_CONTAIN);
  return index < 0 ? { contains: text, mayContain: '' } : { contains: text.slice(0, index), mayContain: text.slice(index) };
}

function additivesIn(ingredients: readonly Ingredient[]): readonly Additive[] {
  return ingredients.flatMap((item): Additive[] => {
    const text = splitMayContain(item.name).contains;
    const codes = [...text.matchAll(E_NUMBER)].map((match) => `E${match[1]}${(match[2] ?? '').toLowerCase()}`);
    if (codes.length === 0) return ADDITIVE_WORDS.test(text) ? [{ code: null, name: text.trim() }] : [];
    const rest = text.replace(E_NUMBER, ' ').replace(/[(),:;]/g, ' ').replace(/\s+/g, ' ').trim();
    const name = codes.length === 1 && rest && rest.length <= MAX_NAME ? rest : null;
    return codes.map((code) => ({ code, name }));
  });
}

function mergeAdditives(known: Detected<readonly Additive[]>, ingredients: readonly Ingredient[]): Detected<readonly Additive[]> {
  const seen = new Set((known.value ?? []).flatMap((item) => [item.code, item.name?.toLowerCase()]));
  const fresh = additivesIn(ingredients).filter((item) => {
    const key = item.code ?? item.name!.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (known.value === null) return inferred(fresh);
  return fresh.length > 0 ? { ...known, value: [...known.value, ...fresh] } : known;
}

function mergeAllergens(known: Detected<readonly Allergen[]>, ingredients: readonly Ingredient[]): Detected<readonly Allergen[]> {
  const { contains, mayContain } = splitMayContain(ingredients.map((item) => item.name).join(', '));
  const found: readonly Allergen[] = [
    ...detectAllergens(contains).map((code): Allergen => ({ code, presence: 'contains', provenance: 'inferred' })),
    ...detectAllergens(mayContain).map((code): Allergen => ({ code, presence: 'may_contain', provenance: 'inferred' })),
  ];
  // «Содержит» важнее «может содержать»; то, что уже указано источником, остаётся.
  const byCode = new Map((known.value ?? []).map((item) => [item.code, item]));
  for (const item of found) {
    const existing = byCode.get(item.code);
    if (!existing || (existing.presence === 'may_contain' && item.presence === 'contains')) byCode.set(item.code, item);
  }
  const merged = [...byCode.values()];
  if (known.value === null) return merged.length > 0 ? inferred(merged) : known;
  return { ...known, value: merged };
}

/**
 * Добавки и аллергены из уже подтверждённого состава: только то, что прямо написано в тексте. Без AI и без догадок по категории.
 * Найденное источником сохраняется. Аллергенов не найдено: значение остаётся неизвестным, отсутствие в тексте их не исключает.
 */
export function withIngredientFacts(product: Product): Product {
  const ingredients = product.ingredients.value;
  if (!ingredients || ingredients.length === 0) return product;
  return { ...product, additives: mergeAdditives(product.additives, ingredients), allergens: mergeAllergens(product.allergens, ingredients) };
}
