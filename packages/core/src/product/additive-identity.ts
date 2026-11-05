import type { Additive } from './additive';

/** Exact, unambiguous aliases only. Functional categories and mixtures are not substances. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  E270: ['lactic acid', 'молочная кислота'],
  E160a: ['carotene', 'carotenes', 'каротин', 'каротины'],
  E330: ['citric acid', 'лимонная кислота'],
  E322: ['lecithin', 'lecithins', 'лецитин', 'лецитины', 'soy lecithin', 'соевый лецитин'],
  E202: ['potassium sorbate', 'сорбат калия'],
};
const BY_NAME = new Map(Object.entries(ALIASES).flatMap(([code, names]) => names.map(name => [name, code] as const)));
const FUNCTION = /^(?:регулятор кислотности|эмульгатор|консервант|краситель|acidity regulator|emulsifier|preservative|colou?r(?:ing|ant)?)[ :]+/u;
const nameKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').trim().replace(/[.]$/, '').replace(/\s+/g, ' ');
const codeKey = (code: string) => {
  const match = code.trim().match(/^[eе]\s*[-‑–]?\s*(\d{3,4})([a-z]?)(\([ivx]+\))?$/iu);
  return match ? `E${match[1]}${match[2]!.toLowerCase()}${(match[3] ?? '').toLowerCase()}` : code;
};
const identity = (item: Additive) => item.code !== null ? `code:${codeKey(item.code)}` :
  BY_NAME.has(nameKey(item.name ?? '').replace(FUNCTION, '')) ? `code:${BY_NAME.get(nameKey(item.name ?? '').replace(FUNCTION, ''))}` : `name:${nameKey(item.name ?? '')}`;
const mentions = (item: Additive): NonNullable<Additive['sourceMentions']> => item.sourceMentions ?? [{code:item.code,name:item.name,...(item.provenance ? {provenance:item.provenance} : {})}];

/** Preserve order and original source mentions. Never invent an E-code from a name alone. */
export function canonicalizeAdditives(items: readonly Additive[]): readonly Additive[] {
  const byIdentity = new Map<string, Additive>();
  for (const item of items) {
    const key = identity(item), previous = byIdentity.get(key);
    const code = item.code === null ? null : codeKey(item.code);
    const normalized = code === item.code ? item : {...item,code,sourceMentions:mentions(item)};
    if (!previous) { byIdentity.set(key, normalized); continue; }
    const originals = [...new Map([...mentions(previous),...mentions(item)].map(mention => [JSON.stringify(mention),mention])).values()];
    // Prefer the explicit code and its provenance; keep the original name when available.
    const coded = previous.code !== null ? previous : normalized;
    const merged: Additive = {...previous,code:previous.code ?? normalized.code,name:previous.name ?? item.name,
      ...(coded.provenance ? {provenance:coded.provenance} : {}),
      ...(originals.length > 1 || previous.sourceMentions ? {sourceMentions:originals} : {}),
    };
    byIdentity.set(key, JSON.stringify(merged) === JSON.stringify(previous) ? previous : merged);
  }
  const result = [...byIdentity.values()];
  return result.length === items.length && result.every((item,i) => item === items[i]) ? items : result;
}
