import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { GoogleNutritionSearch } from '@foodlens/ai';
import type { Product } from '@foodlens/core';
import { ingredientTranslationPlan } from './ingredients-display-text';

type Display = NonNullable<Product['ingredientsDisplay']>;
type Translator = Pick<GoogleNutritionSearch, 'translateIngredients'>;
const SUCCESS_TTL = 24 * 60 * 60 * 1000;
const FAILURE_TTL = 30 * 1000;
const CACHE_SIZE = 256;

/** Presentation-only decorator, called after all nutrition/scoring work. No original source field is modified. */
@Injectable()
export class IngredientsDisplayService {
  private readonly cache = new Map<string, { display: Display; expires: number }>();
  private readonly pending = new Map<string, Promise<Display>>();
  constructor(@Inject(GoogleNutritionSearch) private readonly translator: Translator) {}

  async decorate(product: Product): Promise<Product> {
    const items = product.ingredients.value;
    if (!items?.length) return product;
    let sourceHash = '';
    try {
      sourceHash = createHash('sha256').update('ingredients-en-v1:' + JSON.stringify(items.map(item => [item.name, item.percent]))).digest('hex');
      if (product.ingredientsDisplay?.sourceHash === sourceHash) return product;
      const cached = this.cache.get(sourceHash);
      if (cached && cached.expires > Date.now()) return { ...product, ingredientsDisplay: cached.display };
      let work = this.pending.get(sourceHash);
      if (!work) {
        work = this.translate(items, sourceHash, this.translator).finally(() => { this.pending.delete(sourceHash); });
        this.pending.set(sourceHash, work);
      }
      const display = await work;
      return { ...product, ingredientsDisplay: display };
    } catch {
      return { ...product, ingredientsDisplay: { sourceHash, items, language: 'original', status: 'fallback' } };
    }
  }

  private async translate(items: NonNullable<Product['ingredients']['value']>, sourceHash: string, translator: Translator): Promise<Display> {
    let display: Display;
    try {
      const plan = ingredientTranslationPlan(items);
      const translated = plan.texts.length > 0 ? plan.assemble(await translator.translateIngredients(plan.texts)) : items;
      display = { sourceHash, items: translated, language: 'en', status: plan.texts.length > 0 ? 'translated' : 'unchanged' };
    } catch {
      display = { sourceHash, items, language: 'original', status: 'fallback' };
    }
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(sourceHash, { display, expires: Date.now() + (display.status === 'fallback' ? FAILURE_TTL : SUCCESS_TTL) });
    return display;
  }
}
