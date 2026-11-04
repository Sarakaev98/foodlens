import { isEnglishIngredientText } from './ingredients-display-text';

/** Exact food terms in the confirmed source text; never modifies stored ingredients. */
export function productIngredientFactsText(text: string): string {
  const terms: Readonly<Record<string, string>> = { shakar: 'sugar', sut: 'milk', laktoza: 'lactose' };
  return text.replace(/(?<![\p{L}\p{N}])(shakar|sut|laktoza)(?![\p{L}\p{N}])/giu, word => terms[word.toLowerCase()]!);
}

/** tinyld can misclassify short Uzbek Latin food names as English. */
export function isEnglishProductIngredientText(text: string): boolean {
  if (/(?<!\p{L})(?:shakar|sut|laktoza|kakao\s+yog['’ʻʼ‘]i)(?!\p{L})/iu.test(text)) return false;
  return isEnglishIngredientText(text);
}
