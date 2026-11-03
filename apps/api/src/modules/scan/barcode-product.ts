import { randomUUID } from 'node:crypto';
import { lowestConfidence, NOT_DETECTED, PRODUCT_SEMANTICS_VERSION, type Barcode, type Product, type ProductId, type ProductSemantics } from '@foodlens/core';
import type { LookupStep } from '../product-lookup/multi-source-product-lookup';

/** Без анализа фото и состава о продукте неизвестно, откуда сахар и насколько он обработан. typicalServing всегда пуст. */
const UNKNOWN_SEMANTICS: ProductSemantics = {
  version: PRODUCT_SEMANTICS_VERSION,
  sugarSource: { value: 'unknown', confidence: 'low', evidence: [] },
  processing: { value: 'unknown', confidence: 'low', evidence: [] },
  productForm: { value: 'unknown', confidence: 'low' },
  typicalServing: null,
};

const ADDED_SUGAR = /сахар|сироп|глюкоз|фруктоз|декстроз|мальтоз|паток|мед\b|мёд|sugar|syrup|glucose|fructose|dextrose|maltose|sucrose|molasses|honey/i;
const ULTRA_PROCESSED = /эмульгатор|лецитин|ароматизатор|усилител|стабилизатор|краситель|консервант|загустител|подсластител|модифицирован|гидрогенизирован|сироп|\be\s?-?\d{3}|emulsifier|lecithin|flavou?r|stabili[sz]er|colou?r|preservative|thickener|sweetener|modified|hydrogenated|syrup/i;
const MINIMAL_INGREDIENTS = 2;
const NOVA_PROCESSING = ['whole_or_minimal', 'processed', 'processed', 'ultra_processed'] as const;

/**
 * Источник сахара и обработка по составу из источника штрихкода: те же признаки, что Goal Match получает с упаковки.
 * Только прямые слова состава, уверенность не выше medium. Без состава признаки остаются неизвестными.
 */
export function semanticsFromIngredients(product: Product): ProductSemantics {
  const ingredients = product.ingredients.value;
  if (!ingredients || ingredients.length === 0) return UNKNOWN_SEMANTICS;
  const text = ingredients.map((item) => item.name).join(', ');
  const sugars = product.nutrition?.sugarsG.value ?? null;
  const sugarSource = sugars === 0 ? 'none' : ADDED_SUGAR.test(text) ? 'added' : 'intrinsic';
  const processing = ULTRA_PROCESSED.test(text) ? 'ultra_processed' : ingredients.length <= MINIMAL_INGREDIENTS ? 'whole_or_minimal' : 'processed';
  return { ...UNKNOWN_SEMANTICS,
    sugarSource: { value: sugarSource, confidence: 'medium', evidence: ['ingredients'] },
    processing: { value: processing, confidence: 'medium', evidence: ['ingredients'] } };
}

/** Продукт для Product Score и Goal Match: состав только для показа в расчёты не идёт, в том числе через признаки продукта. */
export function forScoring(product: Product): Product {
  if (!product.fieldEvidence?.some((item) => item.field === 'ingredients' && item.ingredientsOnly)) return product;
  return { ...product, ingredients: NOT_DETECTED, confidence: { ...product.confidence, ingredients: null } };
}

/** Пустая основа barcode-first скана: всё, что в ней появится, придёт из источников по штрихкоду. */
export function emptyBarcodeProduct(barcode: string): Product {
  return {
    id: randomUUID() as ProductId, name: NOT_DETECTED, brand: NOT_DETECTED, category: NOT_DETECTED, nutrition: null, semantics: UNKNOWN_SEMANTICS,
    ingredients: NOT_DETECTED, allergens: NOT_DETECTED, additives: NOT_DETECTED,
    confidence: { overall: 'low', identity: 'low', nutrition: null, ingredients: null },
    source: { type: 'barcode', barcode: barcode as Barcode, provider: 'product_lookup' },
  };
}

/** Данные найдены по штрихкоду: он подтверждает, какой это продукт. Уверенность в значениях не растёт. */
export function confirmBarcodeIdentity(product: Product, steps: readonly LookupStep[]): Product {
  if (!steps.some((step) => step.status === 'hit')) return product;
  const { nutrition } = product.confidence;
  const semantics = semanticsFromIngredients(forScoring(product));
  const nova = steps.flatMap((step) => (step.result?.nova ? [step.result.nova] : []))[0];
  // Группа NOVA из базы дополняет признаки, только если состава нет.
  const processing = semantics.processing.value === 'unknown' && nova ? { value: NOVA_PROCESSING[nova - 1]!, confidence: 'medium' as const, evidence: ['nova_group'] } : semantics.processing;
  return { ...product, semantics: { ...semantics, processing }, confidence: { ...product.confidence, identity: 'high', overall: nutrition ? lowestConfidence('high', nutrition) : 'low' } };
}
