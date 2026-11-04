import type { Product } from '@foodlens/core';
import { withIngredientFacts } from './ingredient-facts';
import { IngredientsDisplayService } from './ingredients-display.service';
import { isEnglishProductIngredientText, productIngredientFactsText } from './product-ingredient-text';

/** Product-only lexical support; keep source text, provenance and existing allergen merge rules. */
export function withProductIngredientFacts(product: Product): Product {
  const original = withIngredientFacts(product);
  if (!product.ingredients.value) return original;
  const names = product.ingredients.value.map(item => ({ ...item, name: productIngredientFactsText(item.name) }));
  const resolved = withIngredientFacts({ ...original, ingredients: { ...product.ingredients, value: names } });
  return { ...original, allergens: resolved.allergens };
}

/** Label retains its existing language detection and translation behavior. */
export class ProductIngredientsDisplayService extends IngredientsDisplayService {
  protected override isEnglishIngredientText(text: string): boolean { return isEnglishProductIngredientText(text); }
}
