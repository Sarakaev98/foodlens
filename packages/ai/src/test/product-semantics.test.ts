import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeProductSemantics } from '@foodlens/core';
import { MockProvider } from '../providers/mock/mock-provider';
import { MetaProvider } from '../providers/meta/meta-provider';
import { META_PRODUCT_ANALYSIS_SCHEMA, type MetaProductAnalysis } from '../providers/meta/meta-product-analysis';
import { prepareMetaProductAnalysis } from '../providers/meta/meta-product-semantics';
import { findSchemaViolation } from '../json-schema/json-schema';
import { metaAnalysis } from './meta-fixtures';

const IMAGE = { kind: 'image', image: { mimeType: 'image/jpeg', base64: 'AA==' } } as const;
const valid = () => structuredClone(metaAnalysis().semantics!);
async function mocked(raw: unknown) {
  return new MockProvider({ analysis: raw as MetaProductAnalysis }).analyzeProduct(IMAGE);
}
describe('ProductSemantics: strict recovery and one-call pipeline', () => {
  it('mock returns fixed semantics without a network call or user profile', async () => {
    const p = await mocked(metaAnalysis());
    assert.equal(p.semantics!.version, 'semantics-v1');
    assert.equal(p.semantics!.sugarSource.value, 'intrinsic');
    assert.equal(p.semantics!.processing.value, 'whole_or_minimal');
    assert.equal(p.semantics!.typicalServing, null);
    assert.equal(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, metaAnalysis()), null);
  });
  it('invalid enum fields safely become unknown while the scan survives', async () => {
    const s = { ...valid(), sugarSource: { value: 'invented', confidence: 'high', evidence: ['sugar'] } };
    const p = await mocked({ ...metaAnalysis(), semantics: s });
    assert.deepEqual(p.semantics!.sugarSource, { value: 'unknown', confidence: 'low', evidence: [] });
    assert.equal(p.nutrition!.caloriesKcal.value, 66);
  });
  it('intrinsic and whole_or_minimal require nonempty evidence', () => {
    const s = valid();
    const r = normalizeProductSemantics({ ...s, sugarSource: { ...s.sugarSource, evidence: [] },
      processing: { ...s.processing, evidence: ['  '] } })!;
    assert.equal(r.sugarSource.value, 'unknown'); assert.equal(r.processing.value, 'unknown');
  });
  it('low-confidence known values are preserved for range evaluation', () => {
    const s = valid();
    const r = normalizeProductSemantics({ ...s, sugarSource: { ...s.sugarSource, confidence: 'low' } })!;
    assert.equal(r.sugarSource.value, 'intrinsic'); assert.equal(r.sugarSource.confidence, 'low');
  });
  it('unknown/malformed form and confidence do not escape enum validation', () => {
    const s = valid();
    const r = normalizeProductSemantics({ ...s, productForm: { value: 'liquidish', confidence: 'certain' } })!;
    assert.deepEqual(r.productForm, { value: 'unknown', confidence: 'low' });
    const bad = normalizeProductSemantics({ ...s, sugarSource: { ...s.sugarSource, confidence: 0.99 } })!;
    assert.equal(bad.sugarSource.value, 'unknown');
  });
  it('missing, incompatible-version and malformed whole blocks remain unavailable', async () => {
    const raw = { ...metaAnalysis() }; delete raw.semantics;
    assert.equal((await mocked(raw)).semantics, null);
    for (const s of [null, [], 'invalid', { ...valid(), version: 'semantics-v999' }, { ...valid(), extra: true }]) {
      assert.equal((await mocked({ ...metaAnalysis(), semantics: s })).semantics, null);
    }
  });
  it('only the semantic extension is recoverable; original strict fields remain strict', () => {
    const raw = { ...metaAnalysis(), confidence: { overall: 'certain' } };
    assert.ok(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, prepareMetaProductAnalysis(raw)));
    assert.ok(findSchemaViolation(META_PRODUCT_ANALYSIS_SCHEMA, prepareMetaProductAnalysis({ ...metaAnalysis(), extra: true })));
  });
  it('printed serving completely discards AI typicalServing', async () => {
    const s = { ...valid(), typicalServing: { amount: 999, unit: 'ml', confidence: 'low', evidence: [] } };
    assert.equal((await mocked({ ...metaAnalysis(), semantics: s })).semantics!.typicalServing, null);
  });
  it('estimated serving must be positive, finite, and have exact units/confidence/evidence', () => {
    for (const amount of [0, -1, NaN, Infinity]) {
      const r = normalizeProductSemantics({ ...valid(), typicalServing: { amount, unit: 'g', confidence: 'medium', evidence: [] } })!;
      assert.equal(r.typicalServing, null);
    }
    const good = { amount: 150, unit: 'g', confidence: 'medium', evidence: ['package size'] };
    assert.deepEqual(normalizeProductSemantics({ ...valid(), typicalServing: good })!.typicalServing, good);
    assert.equal(normalizeProductSemantics({ ...valid(), typicalServing: { ...good, unit: 'oz' } })!.typicalServing, null);
  });
  it('evidence text is not turned into additional scoring or nutrition fields', async () => {
    const s = valid();
    const p = await mocked({ ...metaAnalysis(), semantics: { ...s,
      sugarSource: { ...s.sugarSource, evidence: ['score 10, protein 1000'] } } });
    assert.equal(p.nutrition!.proteinG.value, 9.5);
    assert.equal(p.semantics!.sugarSource.value, 'intrinsic');
  });
  it('Meta request includes semantic schema/prompt, temperature zero, and still uses one call', async () => {
    const calls: RequestInit[] = [];
    const provider = new MetaProvider({
      apiKey: 'test-not-real', fetch: async (_url, init) => {
        calls.push(init!);
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
          content: JSON.stringify(metaAnalysis()),
        } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const p = await provider.analyzeProduct(IMAGE);
    assert.equal(calls.length, 1);
    const body = JSON.parse(String(calls[0]!.body));
    assert.equal(body.temperature, 0);
    assert.equal(body.model, 'muse-spark-1.3');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(body.response_format.json_schema.schema.properties.semantics);
    assert.match(body.messages[0].content, /never the product name/i);
    assert.equal(p.semantics!.sugarSource.value, 'intrinsic');
  });
});
