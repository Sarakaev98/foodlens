export type MissingNutrient = 'protein' | 'sugars' | 'saturatedFat' | 'salt';

const NAMES: Readonly<Record<MissingNutrient, string>> = {
  protein: 'белке',
  sugars: 'сахарах',
  saturatedFat: 'насыщенных жирах',
  salt: 'соли',
};

/**
 * Текст карточки «Соответствие цели», когда Goal Match нельзя посчитать надёжно.
 * «…о сахарах и насыщенных жирах.» Пустой список не передаётся: текст без полей не имеет смысла.
 */
export function missingNutrientsMessage(nutrients: readonly MissingNutrient[]): string {
  const names = nutrients.map((nutrient) => NAMES[nutrient]);
  const fields = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
  return `Для персональной оценки не хватает данных о ${fields}.`;
}
