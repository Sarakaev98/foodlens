import type { Ingredient } from '@foodlens/core';
import { detect } from 'tinyld';

// Short food/technical names often have no reliable language n-grams. This is detection, not a translation dictionary.
const ENGLISH = new Set(`tomato tomatoes sugar salt vinegar water milk wheat flour guar gum citric acid vegetable oil sunflower palm coconut cocoa butter
  glucose fructose dextrose maltose sucrose maltodextrin starch modified corn maize rice potato potatoes soy soya lecithin carrageenan
  mono diglycerides emulsifier emulsifiers stabilizer stabilizers stabiliser stabilisers preservative preservatives antioxidant antioxidants
  natural artificial flavor flavour flavors flavours flavoring flavouring flavorings flavourings acidity regulator regulators raising agent agents
  thickener thickeners calcium sodium potassium magnesium chloride carbonate bicarbonate sulfate sulphate sorbate benzoate citrate phosphate
  ascorbic lactic acetic malic tartaric phosphoric sorbic benzoic acids tocopherol tocopherols beta carotene niacin riboflavin thiamine pantothenate
  vitamin vitamins iron zinc folic extract extracts yeast egg eggs white whites yolk yolks cream skimmed skim whole powder powdered dry dried
  protein proteins whey casein caseinate lactose gluten barley oats oat rye bran grain grains wholegrain wholewheat premium refined unrefined
  honey syrup molasses invert juice concentrate concentrated puree spices spice pepper peppers paprika turmeric cumin coriander cinnamon
  parsley rosemary basil oregano onion garlic carrot carrots beef chicken poultry pork fish meat beans peas lentils nuts peanuts hazelnuts almonds
  chocolate vanilla sweetener sweeteners sucralose stevia aspartame acesulfame erythritol xylitol sorbitol maltitol inulin fiber fibre gelatin pectin
  jalapeno jalapenos sea rock iodized iodised cultures live active pasteurized pasteurised skim nonfat solids concentrated rapeseed olive
  and or with of from to the a an less than contains contain may traces for as is added no not total organic cold pressed mechanically separated
  a b c d e f g h i j k l m n o p q r s t u v w x y z tbhq bha bht msg gmo
  xanthan gellan locust carob disodium monosodium glutamate guanylate inosinate diphosphate triphosphate polyphosphate anhydrous
  yogurt yoghurt grade bulgaricus thermophilus acidophilus bifidus bifidum casei lactis lactobacillus streptococcus bifidobacterium
  partially fully hydrogenated oils fats fat saltwater sunflowerseed semolina tapioca chickpea chickpeas dried noodle noodles drinking baking soda aroma enhancer enhancers red black green allspice coloring colorings colouring colourings caramel anti caking texturate manufacturer broth seasoning herbs herb date number shift`.split(/\s+/));

/** Kept verbatim: brackets/nesting, list delimiters, numbers/percentages and E identifiers. */
const PROTECTED = /(?<![\p{L}\p{N}])[eе]\s*[- ]?\s*\d{3,4}[a-z]?(?![\p{L}\p{N}])|\d+(?:[.,]\d+)?(?:\s*%)?|[()[\]{},.;:%/&+—–-]/giu;
const withoutProtected = (text: string) => text.replace(PROTECTED, ' ');
export function isEnglishIngredientText(text: string): boolean {
  const plain = withoutProtected(text);
  const words = plain.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return true;
  if (words.some(word => /[^a-z]/u.test(word))) return false;
  return words.every(word => (ENGLISH.has(word) || (word.endsWith('s') && ENGLISH.has(word.slice(0, -1))))) || detect(plain) === 'en';
}

type Part = { readonly literal: string } | { readonly index: number; readonly before: string; readonly after: string };
export function ingredientTranslationPlan(items: readonly Ingredient[], isEnglish = isEnglishIngredientText) {
  const texts: string[] = [];
  const indexByText = new Map<string, number>();
  const names = items.map(item => {
    if (isEnglish(item.name)) return [{ literal: item.name }] as Part[];
    const parts: Part[] = [];
    let start = 0;
    const append = (value: string) => {
      const text = value.trim();
      if (!text || isEnglish(text)) { parts.push({ literal: value }); return; }
      let index = indexByText.get(text);
      if (index === undefined) { index = texts.length; indexByText.set(text, index); texts.push(text); }
      parts.push({ index, before: value.slice(0, value.indexOf(text)), after: value.slice(value.indexOf(text) + text.length) });
    };
    for (const match of item.name.matchAll(PROTECTED)) {
      append(item.name.slice(start, match.index));
      parts.push({ literal: match[0] }); start = match.index + match[0].length;
    }
    append(item.name.slice(start));
    return parts;
  });
  return { texts, assemble(translations: readonly string[]): readonly Ingredient[] {
    if (translations.length !== texts.length) throw new Error('Translation segment count mismatch');
    // Detect English in list context; isolated technical names are often misidentified.
    if (!isEnglish(translations.join(' '))) throw new Error('Non-English ingredient translation');
    translations.forEach((text, i) => {
      const structuralText = text.replace(/(?<=[a-z])-(?=[a-z])/giu, '');
      const conjunctions = (value: string) => value.toLowerCase().match(/(?<!\p{L})(?:and|or|with|и|или|с|со|ve|veya|ile|et|ou|avec|und|mit|y|con)(?!\p{L})/gu)?.length ?? 0;
      if (typeof text !== 'string' || !text.trim() || /[\u0000-\u001f]/u.test(text) ||
          structuralText.match(PROTECTED) || /[^\p{Script=Latin}\p{M}\p{P}\p{Z}\p{S}\p{N}]/u.test(text) || conjunctions(text) > conjunctions(texts[i]!) ||
          text.length > texts[i]!.length * 5 + 80) throw new Error('Unsafe ingredient translation');
    });
    return items.map((item, i) => ({ ...item, name: names[i]!.map(part => 'literal' in part ? part.literal : part.before + translations[part.index]!.trim() + part.after).join('') }));
  } };
}
