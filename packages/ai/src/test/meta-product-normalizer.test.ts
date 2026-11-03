import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { META_PRODUCT_ANALYSIS_SCHEMA } from '../providers/meta/meta-product-analysis';
import { normalizeENumber, normalizeMetaProductAnalysis, ProductNotRecognizedError } from '../providers/meta/meta-product-normalizer';
import { findSchemaViolation } from '../json-schema/json-schema';
import { CONTEXT, metaAnalysis } from './meta-fixtures';

const normalize = (overrides: Parameters<typeof metaAnalysis>[0] = {}) =>
  normalizeMetaProductAnalysis(metaAnalysis(overrides), CONTEXT);

describe('normalizeMetaProductAnalysis', () => {
  it('1. превращает корректный ответ в Product', () => {
    const product = normalize();
    assert.equal(product.id, 'scan_test');
    assert.deepEqual(product.name, { value: 'Греческий йогурт 2%', provenance: 'observed' });
    assert.deepEqual(product.brand, { value: 'Epica', provenance: 'observed' });
    assert.deepEqual(product.category, { value: 'yogurt', provenance: 'inferred' });
    assert.equal(product.nutrition?.caloriesKcal.value, 66);
    assert.equal(product.nutrition?.proteinG.value, 9.5);
    assert.deepEqual(product.ingredients.value?.map((i) => i.name), ['молоко нормализованное', 'сливки', 'закваска']);
    assert.equal(product.ingredients.value?.[1]?.percent, 5);
    assert.deepEqual(product.source, {
      type: 'meta_vision',
      provider: 'meta',
      analyzedAt: CONTEXT.analyzedAt,
      analysisVersion: 'meta-product-analysis-v2',
    });
    assert.ok(!JSON.stringify(product).includes('muse'), 'название модели не попадает в Product');
  });

  it('2. этикетки нет: nutrition = null, даже если модель вернула числа', () => {
    const product = normalize({ nutrition_table: { visible: false, energy_kcal: 250, protein_g: 10 } });
    assert.equal(product.nutrition, null);
    assert.equal(product.confidence.nutrition, null);
  });

  it('3. этикетка частично: отсутствующее остаётся not_detected, а не 0', () => {
    const product = normalize({ nutrition_table: { fat_g: null, saturated_fat_g: null, sugars_g: null } });
    const nutrition = product.nutrition!;
    assert.deepEqual(nutrition.fatG, { value: null, provenance: 'not_detected' });
    assert.deepEqual(nutrition.sugarsG, { value: null, provenance: 'not_detected' });
    assert.deepEqual(nutrition.fiberG, { value: null, provenance: 'not_detected' });
    assert.deepEqual(nutrition.proteinG, { value: 9.5, provenance: 'observed' });
    assert.equal(product.confidence.nutrition, 'medium');
  });

  it('3b. неправдоподобные значения отбрасываются, соль и натрий не путаются', () => {
    const product = normalize({ nutrition_table: { protein_g: 140, salt_g: null, sodium: { amount: 0.4, unit: 'g' } } });
    const nutrition = product.nutrition!;
    assert.equal(nutrition.proteinG.value, null);
    assert.deepEqual(nutrition.sodiumMg, { value: 400, provenance: 'observed' });
    assert.deepEqual(nutrition.saltG, { value: 1, provenance: 'inferred' });
  });

  it('3c. только кДж: ккал выводятся и помечаются inferred', () => {
    const product = normalize({ nutrition_table: { energy_kcal: null, energy_kj: 1046 } });
    assert.deepEqual(product.nutrition?.caloriesKcal, { value: 250, provenance: 'inferred' });
  });

  it('4. неизвестная категория становится other', () => {
    assert.deepEqual(normalize({ identity: { category: { value: 'Frozen Dessert', evidence: 'visual_inference' } } }).category, {
      value: 'other',
      provenance: 'inferred',
    });
    assert.equal(normalize({ identity: { category: { value: 'ready meal', evidence: 'visible_text' } } }).category.value, 'ready_meal');
    assert.equal(normalize({ identity: { category: { value: null, evidence: 'not_visible' } } }).category.value, null);
  });

  it('5. уверенность ограничивается качеством фото и полнотой данных', () => {
    assert.deepEqual(normalize().confidence, { overall: 'high', identity: 'high', nutrition: 'high', ingredients: 'high' });

    const blurry = normalize({ image: { quality: 'partially_readable' } }).confidence;
    assert.deepEqual(blurry, { overall: 'medium', identity: 'medium', nutrition: 'medium', ingredients: 'medium' });

    const noName = normalize({ identity: { name: { value: null, evidence: 'not_visible' } } }).confidence;
    assert.equal(noName.identity, 'low');
    assert.equal(noName.overall, 'low');

    const unknownBasis = normalize({ nutrition_table: { basis: 'not_stated' } }).confidence;
    assert.equal(unknownBasis.nutrition, 'medium');
    assert.equal(normalize({ nutrition_table: { basis: 'not_stated' } }).nutrition?.basis, 'unknown');

    const modelUnsure = normalize({ confidence: { overall: 'low' } }).confidence;
    assert.equal(modelUnsure.overall, 'low');
  });

  it('6. состава нет: ingredients, additives и выведенные аллергены не детектируются', () => {
    const product = normalize({
      ingredients: { visible: false, items: [{ name: 'сахар', percent: null }] },
      allergens: { statement_visible: false, items: [{ allergen: 'milk', presence: 'contains', evidence: 'derived_from_ingredient' }] },
      additives: [{ e_number: 'E330', name: null }],
    });
    assert.deepEqual(product.ingredients, { value: null, provenance: 'not_detected' });
    assert.deepEqual(product.allergens, { value: null, provenance: 'not_detected' });
    assert.deepEqual(product.additives, { value: null, provenance: 'not_detected' });
    assert.equal(product.confidence.ingredients, null);
  });

  it('7. аллергены: неизвестные отбрасываются, дубли сливаются, contains важнее may_contain', () => {
    const product = normalize({
      allergens: {
        statement_visible: true,
        items: [
          { allergen: 'milk', presence: 'may_contain', evidence: 'allergen_statement' },
          { allergen: 'milk', presence: 'contains', evidence: 'derived_from_ingredient' },
          { allergen: 'nuts', presence: 'contains', evidence: 'allergen_statement' },
          { allergen: 'soy', presence: 'may_contain', evidence: 'allergen_statement' },
        ],
      },
    });
    assert.deepEqual(product.allergens.value, [
      { code: 'milk', presence: 'contains', provenance: 'inferred' },
      { code: 'soy', presence: 'may_contain', provenance: 'observed' },
    ]);
    assert.deepEqual(normalize({ allergens: { statement_visible: true, items: [] } }).allergens, { value: [], provenance: 'observed' });
  });

  it('8. добавки: E-коды приводятся к единому виду, дубли и пустые убираются', () => {
    const product = normalize({
      additives: [
        { e_number: 'e 330', name: 'лимонная кислота' },
        { e_number: 'E-330', name: null },
        { e_number: 'е150D', name: 'сахарный колер' },
        { e_number: null, name: 'пектин' },
        { e_number: 'not a code', name: null },
        { e_number: null, name: ' ' },
      ],
    });
    assert.deepEqual(product.additives.value, [
      { code: 'E330', name: 'лимонная кислота' },
      { code: 'E150d', name: 'сахарный колер' },
      { code: null, name: 'пектин' },
    ]);
    assert.equal(normalizeENumber('E160a(ii)'), 'E160a(ii)');
    assert.equal(normalizeENumber('12'), null);
  });

  it('9. основа пищевой ценности сохраняется и задаёт границы', () => {
    assert.equal(normalize({ nutrition_table: { basis: 'per_100ml' } }).nutrition?.basis, 'per_100ml');
    const serving = normalize({ nutrition_table: { basis: 'per_serving', energy_kcal: 1200, protein_g: 140 } }).nutrition!;
    assert.equal(serving.basis, 'per_serving');
    assert.equal(serving.caloriesKcal.value, 1200, 'на порцию больше 900 ккал допустимо');
    assert.equal(serving.proteinG.value, 140, 'на порцию больше 100 г допустимо');
    assert.deepEqual(serving.servingSize, { value: { amount: 130, unit: 'g' }, provenance: 'observed' });
  });

  it('10. не продукт или ничего не прочитано: ProductNotRecognizedError', () => {
    assert.throws(() => normalize({ image: { is_food_product: false } }), ProductNotRecognizedError);
    assert.throws(
      () =>
        normalize({
          identity: { name: { value: null, evidence: 'not_visible' }, brand: { value: null, evidence: 'not_visible' } },
          nutrition_table: { visible: false },
          ingredients: { visible: false, items: [] },
          allergens: { statement_visible: false, items: [] },
        }),
      ProductNotRecognizedError,
    );
  });
});

describe('META_PRODUCT_ANALYSIS_SCHEMA', () => {
  it('10b. корректный ответ проходит проверку схемы, искажённый нет', () => {
    assert.equal(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, metaAnalysis()), null);
    const broken = { ...metaAnalysis(), extra: true };
    assert.match(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, broken) ?? '', /unexpected property/);
    const wrongType = metaAnalysis({ nutrition_table: { protein_g: '9.5' as unknown as number } });
    assert.match(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, wrongType) ?? '', /protein_g/);
    const { confidence: _omit, ...missing } = metaAnalysis();
    assert.match(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, missing) ?? '', /confidence: missing/);
  });

  it('схема соблюдает правила strict mode: у каждого объекта все поля required и additionalProperties false', () => {
    const visit = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === 'object') {
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort());
      }
      assert.ok(!('oneOf' in schema) && !('allOf' in schema));
      Object.values(schema).forEach((child) => (Array.isArray(child) ? child.forEach(visit) : visit(child)));
    };
    visit(META_PRODUCT_ANALYSIS_SCHEMA);
    assert.equal((META_PRODUCT_ANALYSIS_SCHEMA as { type?: string }).type, 'object');
  });
});
