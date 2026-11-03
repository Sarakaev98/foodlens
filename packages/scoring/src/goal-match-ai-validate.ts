import {
  GOAL_MATCH_AI_BANDS, GOAL_MATCH_AI_DIMENSIONS, GOAL_MATCH_AI_DIMENSION_VALUES,
  GOAL_MATCH_AI_FACTOR_CODES, GOAL_MATCH_AI_WARNINGS,
  type GoalMatchAiInput, type GoalMatchAiOutput, type GoalMatchAiFactor, type GoalMatchAiFactorCode,
} from '@foodlens/core';

type ObjectValue = Record<string, unknown>;
const object = (x: unknown): x is ObjectValue => !!x && typeof x === 'object' && !Array.isArray(x);
const oneOf = (x: unknown, choices: readonly string[]): x is string => typeof x === 'string' && choices.includes(x);
const keys = (x: ObjectValue, names: readonly string[]) => Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const bands = { excellent_fit: [9,10], good_fit: [7,8.9], mixed_fit: [5,6.9], poor_fit: [3,4.9], very_poor_fit: [0,2.9] } as const;
const weight = { high: 3, medium: 2, low: 1 } as const;
export type GoalMatchAiValidation = { readonly valid: true; readonly output: GoalMatchAiOutput;
  readonly removedFactors: number; readonly adjusted: boolean; readonly summaryReplaced: boolean } |
  { readonly valid: false; readonly errors: readonly string[]; readonly fallbackSummary: string };
export function fallbackGoalMatchSummary(factors: readonly GoalMatchAiFactor[]): string {
  return factors.slice(0,2).map(f => f.text.replace(/[.!?]+$/u,'')).join('; ').slice(0,139) + (factors.length ? '.' : '');
}
const numericDependencies: Record<string, readonly string[]> = {
  proteinG: ['proteinG','proteinTargetPct','proteinKcalPct','protein'],
  fiberG: ['fiberG','fiberPer100kcal','fiber'],
  sugarsG: ['sugarsG','freeSugarsG','freeSugarLimitPct','freeSugar'],
  saturatedFatG: ['saturatedFatG','saturatedFatPer100kcal','saturatedFatLimitPct','saturatedFat'],
  saltG: ['saltG','saltLimitPct','salt'],
  fatG: ['fatG'], carbsG: ['carbsG'],
};
/** Resolve only own scalar leaves and ingredient strings; never objects/prototypes. */
export function resolveGoalMatchFact(input: GoalMatchAiInput, path: string): string | number | readonly string[] | null {
  if (!/^(facts\.|product\.per100\.|semantics\.|product\.ingredients(?:\.|$))/u.test(path)) return null;
  const parts = path.split('.');
  if (parts.some(p => !p || ['__proto__','prototype','constructor'].includes(p))) return null;
  for (const missing of input.missing) {
    if (missing.includes('.') && (path === missing || path.startsWith(missing + '.'))) return null;
    const nutrient = missing.split('.').at(-1)!;
    if ((numericDependencies[nutrient] ?? [nutrient]).includes(parts.at(-1)!)) return null;
  }
  let value: unknown = input;
  for (const part of parts) {
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/u.test(part)) return null;
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value,part)) return null;
    value = (value as ObjectValue)[part];
  }
  if (finite(value) || typeof value === 'string') return value;
  if (path === 'product.ingredients' && Array.isArray(value) && value.every(x => typeof x === 'string')) return value;
  return null;
}
const medical = /диабет|гипертони|холестерин|лечит|лечени|лечебн|профилактик|снижа[а-яё]*\s+риск|детокс|сжига[а-яё]*\s+жир|рекомендую при|дозиров|\d\s*(?:мг|мкг|таблет|капсул)|врач|излеч|исцеля/iu;
const normalize = (s: string) => s.toLowerCase().replace(/ё/gu,'е');
export function ingredientSignals(input: GoalMatchAiInput) {
  const ingredients = input.product.ingredientsStatus === 'observed' && !input.missing.includes('product.ingredients')
    ? input.product.ingredients?.map(normalize) ?? [] : [];
  const joined = ingredients.join(' ');
  return {
    sweeteners: /сукралоз|аспартам|ацесульфам|стевиол|эритрит|мальтит|сорбит|ксилит|(?:^|[^a-zа-яё0-9])[eе]\s*9(?:5\d|6[0-8])(?:[a-z])?(?=$|[^a-zа-яё0-9])/iu.test(joined),
    fried: /масл/iu.test(joined) && /жарен|фритюр|обжарен/iu.test(joined),
    refined: ingredients.slice(0,2).some(x => /мука пшеничная высшего сорта|крахмал|мальтодекстрин/iu.test(x)),
    alcohol: /этилов[а-яё]*\s+спирт|алкогол|этанол/iu.test(joined),
    caffeine: /кофеин/iu.test(joined),
  };
}
const positiveCodes: readonly GoalMatchAiFactorCode[] = ['high_protein','fiber_source','whole_food','intrinsic_sugar','low_sugar','good_fat_profile','low_salt','fits_portion'];
export function factorCodeAllowed(code: GoalMatchAiFactorCode, input: GoalMatchAiInput): boolean {
  const read = (path: string) => resolveGoalMatchFact(input,path);
  const n = (path: string) => { const v=read(path); return typeof v === 'number' ? v : null; };
  const atLeastModerate = (key: string) => ['moderate','high'].includes(String(read('facts.levels.'+key)));
  const sugar = n('product.per100.sugarsG'), fat = n('product.per100.fatG'), sat = n('product.per100.saturatedFatG');
  const salt = n('product.per100.saltG'), daily = n('facts.share.dailyKcalPct');
  const source = read('semantics.sugarSource.value'), processing = read('semantics.processing.value');
  const sourceTrusted = input.semantics.sugarSource.confidence !== 'low';
  const processingTrusted = input.semantics.processing.confidence !== 'low';
  const signals = ingredientSignals(input);
  switch (code) {
    case 'high_protein': return n('product.per100.proteinG') !== null && atLeastModerate('protein');
    case 'fiber_source': return n('product.per100.fiberG') !== null && atLeastModerate('fiber');
    case 'whole_food': return processing === 'whole_or_minimal' && processingTrusted;
    case 'intrinsic_sugar': return source === 'intrinsic' && sourceTrusted && sugar !== null && sugar >= 1;
    case 'low_sugar': return sugar !== null && read('facts.levels.freeSugar') === 'low' && sugar <= (input.semantics.productForm.value === 'beverage' ? 2.5 : 5);
    case 'good_fat_profile': return fat !== null && fat >= 3 && sat !== null && sat / fat <= .25;
    case 'low_salt': return salt !== null && salt <= .3;
    case 'fits_portion': return daily !== null && daily <= 15;
    case 'ultra_processed': return processing === 'ultra_processed' && processingTrusted;
    case 'added_sugar': return sourceTrusted && (source === 'added' || source === 'mixed') && (n('facts.perServing.freeSugarsG') ?? 0) > 0;
    case 'high_sugar': return atLeastModerate('freeSugar');
    case 'high_saturated_fat': return atLeastModerate('saturatedFat');
    case 'high_salt': return atLeastModerate('salt');
    case 'sweeteners': return signals.sweeteners;
    case 'fried_or_refined_oil': return signals.fried;
    case 'refined_starch': return signals.refined;
    case 'low_nutrient_density': return read('facts.levels.protein') === 'low' && read('facts.levels.fiber') !== 'high' &&
      ['freeSugar','saturatedFat','salt'].some(atLeastModerate);
    case 'energy_dense': return daily !== null && daily >= 20;
  }
}
function schema(x: unknown): x is GoalMatchAiOutput {
  if (!object(x) || !keys(x,['version','band','score','confidence','dimensions','factors','summary','warnings'])) return false;
  if (x.version !== 'goal-match-ai-v1' || !oneOf(x.band,GOAL_MATCH_AI_BANDS) || !finite(x.score) || x.score < 0 || x.score > 10 ||
      !Number.isInteger(x.score*2) || !oneOf(x.confidence,['high','medium','low'])) return false;
  if (!object(x.dimensions) || !keys(x.dimensions,GOAL_MATCH_AI_DIMENSIONS) ||
      Object.values(x.dimensions).some(v => !oneOf(v,GOAL_MATCH_AI_DIMENSION_VALUES))) return false;
  if (typeof x.summary !== 'string' || !x.summary.trim() || x.summary.length > 140 || /\n/u.test(x.summary) ||
      !/[а-яё]/iu.test(x.summary) || x.summary.split(/[.!?]+/u).filter(s=>s.trim()).length > 1) return false;
  if (!Array.isArray(x.warnings) || x.warnings.some(w=>!oneOf(w,GOAL_MATCH_AI_WARNINGS)) || new Set(x.warnings).size !== x.warnings.length) return false;
  if (!Array.isArray(x.factors) || x.factors.length < 1 || x.factors.length > 4) return false;
  const seen = new Set<string>();
  for (const f of x.factors) {
    if (!object(f) || !keys(f,['code','direction','impact','facts','text']) || !oneOf(f.code,GOAL_MATCH_AI_FACTOR_CODES) ||
      !oneOf(f.direction,['positive','negative']) || !oneOf(f.impact,['high','medium','low']) ||
      !Array.isArray(f.facts) || f.facts.length < 1 || f.facts.length > 3 || f.facts.some(p=>typeof p !== 'string') ||
      typeof f.text !== 'string' || !f.text.trim() || f.text.length > 90 || !/[а-яё]/iu.test(f.text) || seen.has(f.code)) return false;
    seen.add(f.code);
  }
  const factors = x.factors as unknown as GoalMatchAiFactor[];
  return factors.every((f,i) => !i || weight[factors[i-1]!.impact] >= weight[f.impact]);
}
function dimensionsConsistent(x: GoalMatchAiOutput, input: GoalMatchAiInput): boolean {
  const values = Object.values(x.dimensions), strongNegative = values.filter(v=>v==='strong_negative').length;
  const negative = values.filter(v=>v==='negative' || v==='strong_negative').length;
  const positive = values.filter(v=>v==='positive' || v==='strong_positive').length;
  const [min,max] = bands[x.band];
  if (x.score < min || x.score > max) return false;
  switch (x.band) {
    case 'excellent_fit': return negative === 0 && positive >= 2 && values.includes('strong_positive');
    case 'good_fit': return strongNegative === 0 && negative <= 1;
    case 'mixed_fit': return strongNegative <= 1;
    case 'poor_fit': return strongNegative === 2 || strongNegative === 1 &&
      (x.dimensions.processing === 'negative' || x.dimensions.processing === 'strong_negative');
    case 'very_poor_fit': {
      const p = input.product.per100;
      const sugarEnergy = input.semantics.sugarSource.value === 'intrinsic' || input.semantics.sugarSource.value === 'none' ? 0
        : p.sugarsG * 4 * (input.semantics.sugarSource.value === 'mixed' ? .5 : 1);
      return strongNegative >= 3 || p.kcal > 0 && (sugarEnergy / p.kcal >= .5 || p.saturatedFatG * 9 / p.kcal >= .5);
    }
  }
}
function supportedText(text: string, refs: readonly string[], codes: readonly GoalMatchAiFactorCode[], input: GoalMatchAiInput): boolean {
  if (medical.test(text)) return false;
  const t = normalize(text);
  const missingWords: Record<string,RegExp> = { proteinG: /бел[окк]/iu, fiberG: /клетчат/iu, sugarsG: /сахар/iu,
    saturatedFatG: /насыщенн/iu, saltG: /сол[ьиь]|натри/iu, fatG: /жир/iu, carbsG: /углевод/iu };
  if (input.missing.some(k => missingWords[k]?.test(t))) return false;
  const numbers: number[] = [];
  let hasPer100Value = false;
  for (const path of refs) {
    const value = resolveGoalMatchFact(input,path);
    if (typeof value === 'number') {
      numbers.push(value);
      if (path.startsWith('product.per100.')) hasPer100Value = true;
    }
    else for (const str of typeof value === 'string' ? [value] : value ?? []) {
      for (const m of str.matchAll(/\d+(?:[.,]\d+)?/gu)) numbers.push(Number(m[0].replace(',','.')));
    }
  }
  // Only the numeric token inside a referenced per-100 basis is exempt, never every "100".
  const basisOffsets = new Set<number>();
  if (hasPer100Value) {
    for (const basis of text.matchAll(/(?:^|[^\p{L}\p{N}_])на\s+(100)\s*(?:мл|г)(?=$|[^\p{L}\p{N}_])/giu)) {
      basisOffsets.add(basis.index! + basis[0].indexOf(basis[1]!));
    }
  }
  for (const m of text.matchAll(/[-+]?\d+(?:[.,]\d+)?/gu)) {
    if (m[0] === '100' && basisOffsets.has(m.index!)) continue;
    const number = Number(m[0].replace(',','.'));
    const percent = /^\s*(?:%|процент)/iu.test(text.slice(m.index!+m[0].length));
    if (!numbers.some(n=>Math.abs(number - n) < 1e-7 || percent && number === Math.round(n))) return false;
  }
  if (/без\s+(?:добавленного\s+)?сахар/iu.test(t)) {
    if (/без\s+добавленного\s+сахар/iu.test(t)) {
      if (!codes.includes('intrinsic_sugar') || input.semantics.sugarSource.confidence === 'low') return false;
    } else if (!codes.includes('low_sugar') || input.product.per100.sugarsG !== 0) return false;
  }
  if (/без\s+(?:пищевых\s+)?добавок/iu.test(t) && (!codes.includes('whole_food') ||
    input.product.ingredientsStatus !== 'observed' || input.product.additives === null || input.product.additives.length !== 0 ||
    input.missing.includes('product.additives'))) return false;
  if (/натуральн/iu.test(t) && !codes.includes('whole_food')) return false;
  return true;
}
export function validateGoalMatchAiOutput(raw: unknown, input: GoalMatchAiInput): GoalMatchAiValidation {
  let parsed: unknown = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { return { valid:false, errors:['invalid_json'], fallbackSummary:'' }; } }
  if (!schema(parsed)) return { valid:false, errors:['schema'], fallbackSummary:'' };
  if (!dimensionsConsistent(parsed,input)) return { valid:false, errors:['band_dimensions'], fallbackSummary:'' };
  const valid: GoalMatchAiFactor[] = [], errors: string[] = [];
  let removedHigh = false;
  for (const f of parsed.factors) {
    const validFactor = (positiveCodes.includes(f.code) ? 'positive' : 'negative') === f.direction &&
      factorCodeAllowed(f.code,input) && f.facts.every(p=>resolveGoalMatchFact(input,p)!==null) &&
      supportedText(f.text,f.facts,[f.code],input);
    if (validFactor) valid.push(f);
    else { errors.push('factor:'+f.code); removedHigh ||= f.impact === 'high'; }
  }
  const fallbackSummary = fallbackGoalMatchSummary(valid);
  if (removedHigh || errors.length > 1 || !valid.length) return { valid:false, errors, fallbackSummary };
  const refs = valid.flatMap(f=>f.facts), codes = valid.map(f=>f.code);
  // Summary errors invalidate the response (section 9); expose a safe template for callers.
  if (!supportedText(parsed.summary,refs,codes,input)) return { valid:false, errors:[...errors,'summary'], fallbackSummary };
  const signals = ingredientSignals(input);
  const warningAllowed = (w: string) => w === 'fiber_unknown' ? input.missing.includes('fiberG')
    : w === 'serving_estimated' ? input.product.serving.source === 'ai'
    : w === 'ingredients_missing' ? input.product.ingredientsStatus !== 'observed'
    : w === 'sweeteners' ? signals.sweeteners : w === 'contains_alcohol' ? signals.alcohol : signals.caffeine;
  if (!parsed.warnings.every(warningAllowed)) return { valid:false, errors:['warning_precondition'], fallbackSummary };
  return { valid:true, output:{...parsed,factors:valid}, removedFactors:errors.length, adjusted:errors.length > 0, summaryReplaced:false };
}
