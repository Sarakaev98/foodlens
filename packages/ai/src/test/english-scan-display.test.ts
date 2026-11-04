import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizeMetaProductAnalysis } from '../providers/meta/meta-product-normalizer';
import { prepareGoogleProductAnalysis } from '../providers/google/google-product-analysis';
import { META_PRODUCT_ANALYSIS_SCHEMA } from '../providers/meta/meta-product-analysis';
import { findSchemaViolation } from '../json-schema/json-schema';
import { CONTEXT, metaAnalysis } from './meta-fixtures';

it('extracts English display with the existing analysis, keeping originals, codes and allergens', () => {
  const raw = metaAnalysis({ ingredients: { visible: true, items: [{name:'молоко',percent:20},{name:'эмульгатор (E322)',percent:null}] }, additives:[{e_number:'E322',name:'эмульгатор'}], english:{ingredients:['milk','emulsifier (E322)'],additives:['emulsifier']} });
  const snapshot = structuredClone(raw), p = normalizeMetaProductAnalysis(raw, CONTEXT);
  const original = normalizeMetaProductAnalysis({...raw, english:null}, CONTEXT);
  assert.deepEqual(raw,snapshot);
  assert.deepEqual(p.ingredients,original.ingredients); assert.deepEqual(p.additives,original.additives); assert.deepEqual(p.allergens,original.allergens);
  assert.deepEqual(p.labelTranslations,[{original:'молоко',english:'milk'},{original:'эмульгатор (E322)',english:'emulsifier (E322)'},{original:'эмульгатор',english:'emulsifier'}]);
});
it('legacy responses still validate; unsafe, missing and misaligned translations never overwrite source', () => {
  const raw=metaAnalysis(); delete (raw as {english?:unknown}).english;
  assert.equal(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA,prepareGoogleProductAnalysis(raw)),null);
  for(const names of [[],['milk'],['молоко','cream','cultures'],['milk E999','cream','cultures']]) {
    const p=normalizeMetaProductAnalysis({...raw,english:{ingredients:names,additives:[]}},CONTEXT);
    assert.deepEqual(p.ingredients,normalizeMetaProductAnalysis(raw,CONTEXT).ingredients);
    assert.ok(!p.labelTranslations?.some(pair=>pair.english.includes('E999')||pair.english.includes('молоко')));
  }
});
