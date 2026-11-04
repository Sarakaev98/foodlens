export type MissingNutrient = 'protein' | 'sugars' | 'saturatedFat' | 'salt';

const NAMES: Readonly<Record<MissingNutrient, string>> = {
  protein: 'protein',
  sugars: 'sugars',
  saturatedFat: 'saturated fat',
  salt: 'salt',
};

/**
 * Текст карточки «Goal Match», когда Goal Match нельзя посчитать надёжно.
 * «…on sugars and saturated fat…» Пустой список не передаётся: текст без полей не имеет смысла.
 */
export function missingNutrientsMessage(nutrients: readonly MissingNutrient[]): string {
  const names = nutrients.map((nutrient) => NAMES[nutrient]);
  const fields = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Not enough data on ${fields} for a personal rating.`;
}
