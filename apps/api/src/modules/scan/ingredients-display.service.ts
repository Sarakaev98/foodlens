import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { GoogleNutritionSearch } from '@foodlens/ai';
import type { Additive, Product } from '@foodlens/core';
import { ingredientTranslationPlan, isEnglishIngredientText } from './ingredients-display-text';

type Display = NonNullable<Product['ingredientsDisplay']>;
type Translator = Pick<GoogleNutritionSearch, 'translateIngredients'>;
type Ingredients = NonNullable<Product['ingredients']['value']>;
/** Everything the UI shows from one translation call: ingredients, product name and additive names. */
interface DisplayParts { readonly ingredients: Display | null; readonly name?: string; readonly additives?: readonly Additive[] }
const SUCCESS_TTL = 24 * 60 * 60 * 1000;
const FAILURE_TTL = 30 * 1000;
const CACHE_SIZE = 256;

/** A letter outside the Latin script: the English UI cannot show this text as is. */
const NON_LATIN = /(?=\p{L})\P{Script=Latin}/u;
const needsTranslation = (text: string | null | undefined): text is string => !!text && NON_LATIN.test(text);
/** A name or additive translation must be one short Latin-script phrase. */
const safeLabel = (translation: string | undefined, source: string): translation is string =>
  typeof translation === 'string' && !!translation.trim() && !NON_LATIN.test(translation) &&
  !/[\u0000-\u001f]/u.test(translation) && translation.length <= source.length * 3 + 40;

/** Presentation-only decorator, called after all nutrition/scoring work. No original source field is modified. */
@Injectable()
export class IngredientsDisplayService {
  private readonly cache = new Map<string, { parts: DisplayParts; expires: number }>();
  private readonly pending = new Map<string, Promise<DisplayParts>>();
  constructor(@Inject(GoogleNutritionSearch) private readonly translator: Translator) {}

  protected isEnglishIngredientText(text: string): boolean { return isEnglishIngredientText(text); }

  async decorate(product: Product): Promise<Product> {
    const items = product.ingredients.value?.length ? product.ingredients.value : null;
    const name = needsTranslation(product.name.value) ? product.name.value : null;
    const additives = product.additives.value?.some((additive) => needsTranslation(additive.name)) ? product.additives.value : null;
    if (!items && !name && !additives) return product;
    let sourceHash = '';
    try {
      sourceHash = items ? createHash('sha256').update('ingredients-en-v1:' + JSON.stringify(items.map(item => [item.name, item.percent]))).digest('hex') : '';
      const decorated = (!items || product.ingredientsDisplay?.sourceHash === sourceHash) &&
        (!name || product.nameDisplay !== undefined) && (!additives || product.additivesDisplay !== undefined);
      if (decorated) return product;
      const key = createHash('sha256').update('display-en-v1:' + JSON.stringify([sourceHash, name, additives?.map(a => a.name) ?? null])).digest('hex');
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) return withParts(product, cached.parts);
      let work = this.pending.get(key);
      if (!work) {
        work = this.translate(items, name, additives, sourceHash, key).finally(() => { this.pending.delete(key); });
        this.pending.set(key, work);
      }
      return withParts(product, await work);
    } catch {
      return items ? { ...product, ingredientsDisplay: { sourceHash, items, language: 'original', status: 'fallback' } } : product;
    }
  }

  private async translate(items: Ingredients | null, name: string | null, additives: readonly Additive[] | null,
    sourceHash: string, key: string): Promise<DisplayParts> {
    const plan = items ? ingredientTranslationPlan(items, text => this.isEnglishIngredientText(text)) : null;
    const labels = [...(name ? [name] : []), ...(additives ?? []).map(a => a.name).filter(needsTranslation)];
    const uniqueLabels = [...new Set(labels)];
    const ingredientTexts = plan?.texts ?? [];
    let parts: DisplayParts;
    let failed = false;
    try {
      const texts = [...ingredientTexts, ...uniqueLabels];
      const translated = texts.length > 0 ? await this.translator.translateIngredients(texts) : [];
      if (translated.length !== texts.length) throw new Error('Translation segment count mismatch');
      let ingredients: Display | null = null;
      if (items && plan) {
        try {
          const shown = ingredientTexts.length > 0 ? plan.assemble(translated.slice(0, ingredientTexts.length)) : items;
          ingredients = { sourceHash, items: shown, language: 'en', status: ingredientTexts.length > 0 ? 'translated' : 'unchanged' };
        } catch {
          ingredients = { sourceHash, items, language: 'original', status: 'fallback' };
          failed = true;
        }
      }
      const byLabel = new Map(uniqueLabels.map((label, i) => [label, translated[ingredientTexts.length + i]]));
      const label = (source: string) => { const value = byLabel.get(source); return safeLabel(value, source) ? value.trim() : undefined; };
      const shownName = name ? label(name) : undefined;
      // Without a safe translation an E-number alone is clearer than foreign text; a name-only additive keeps its original.
      const shownAdditives = additives?.map(a => {
        if (!needsTranslation(a.name)) return a;
        const shown = label(a.name);
        if (!shown) failed = true;
        return { ...a, name: shown ?? (a.code ? null : a.name) };
      });
      parts = { ingredients, ...(shownName ? { name: shownName } : {}), ...(shownAdditives ? { additives: shownAdditives } : {}) };
      if (name && !shownName) failed = true;
    } catch {
      parts = { ingredients: items ? { sourceHash, items, language: 'original', status: 'fallback' } : null };
      failed = true;
    }
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { parts, expires: Date.now() + (failed ? FAILURE_TTL : SUCCESS_TTL) });
    return parts;
  }
}

function withParts(product: Product, parts: DisplayParts): Product {
  return {
    ...product,
    ...(parts.ingredients ? { ingredientsDisplay: parts.ingredients } : {}),
    ...(parts.name !== undefined ? { nameDisplay: parts.name } : {}),
    ...(parts.additives !== undefined ? { additivesDisplay: parts.additives } : {}),
  };
}
