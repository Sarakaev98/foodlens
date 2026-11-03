import { analyzeNutritionIngredients } from './nutrition-ingredient-signals';
import type { ConfidenceLevel, NutrientKey, Product, ProductCategory } from '@foodlens/core';

/** Per 100 g/ml MVP priors, not measurements. sugarShare and saturatedShare are shares of carbs and fat. */
export interface NutritionProfile {
  readonly protein: number; readonly carbs: number; readonly fat: number;
  readonly sugarShare: number; readonly saturatedShare: number; readonly fiber: number; readonly salt: number;
}
/** Plausible per-100 maxima for the subtype. Estimates are clamped to them; a source value above them is only flagged. */
export type NutritionLimits = Partial<Record<Exclude<NutrientKey, 'sodiumMg'>, number>>;

const profile = (protein: number, carbs: number, fat: number, sugarShare: number, saturatedShare: number, fiber: number, salt: number): NutritionProfile =>
  ({ protein, carbs, fat, sugarShare, saturatedShare, fiber, salt });

/** One prior per core category. Subtypes below refine the broad ones (sauce, beverage, dairy, ready_meal, cereal…). */
export const CATEGORY_PROFILES: Readonly<Record<ProductCategory, NutritionProfile>> = {
  water: profile(0, 0, 0, 0, 0, 0, 0.01), beverage: profile(0, 10, 0, 0.9, 0, 0, 0.03), juice: profile(0.5, 11, 0.2, 0.9, 0.1, 0.2, 0.01),
  dairy: profile(4, 5, 3, 0.8, 0.65, 0, 0.1), yogurt: profile(4, 6, 3, 0.8, 0.65, 0, 0.1), cheese: profile(22, 2, 26, 0.5, 0.65, 0, 1.7),
  meat: profile(20, 1, 8, 0.05, 0.3, 0, 0.25), fish: profile(20, 1, 8, 0.05, 0.25, 0, 0.25), nuts: profile(18, 18, 52, 0.15, 0.15, 8, 0.02),
  snack: profile(6, 55, 30, 0.05, 0.2, 3, 1.3), chocolate: profile(6, 55, 32, 0.8, 0.6, 3, 0.2), sweets: profile(3, 75, 8, 0.8, 0.45, 0.5, 0.2),
  bakery: profile(6, 60, 20, 0.45, 0.45, 2, 0.5), bread: profile(8, 45, 4, 0.08, 0.2, 4, 1.1), cereal: profile(10, 65, 6, 0.12, 0.2, 7, 0.2),
  // An unknown sauce is no longer a mayonnaise/ketchup blend (2/12/15 g, 191 kcal): a moderate condiment prior.
  sauce: profile(1.5, 12, 5, 0.4, 0.2, 1, 1.5), ready_meal: profile(8, 25, 8, 0.06, 0.3, 3, 1.1), protein_product: profile(25, 15, 6, 0.2, 0.3, 2, 0.4),
  fruit: profile(1, 12, 0.3, 0.75, 0.1, 2, 0.01), vegetable: profile(2, 6, 0.4, 0.3, 0.1, 2.5, 0.03), other: profile(5, 20, 7, 0.15, 0.3, 2, 0.6),
};

const CATEGORY_LIMITS: Partial<Record<ProductCategory, NutritionLimits>> = {
  water: { caloriesKcal: 5, proteinG: 0.5, carbsG: 1, fatG: 0.5, sugarsG: 1 },
  beverage: { proteinG: 4, fatG: 3 }, juice: { proteinG: 2, fatG: 1 },
  fruit: { fatG: 3, proteinG: 4 }, vegetable: { fatG: 3, caloriesKcal: 120 },
};

/** Unicode-letter boundaries: \b is ASCII-only in JS and never matches around Cyrillic. */
const w = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
/** Lowercase, NFKC, ё → е, punctuation to spaces: "Passata-Rustica" and "passata rustica" read the same. */
export const normalizedName = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();

export interface Subtype {
  readonly name: string;
  readonly category: ProductCategory;
  readonly words: RegExp;
  readonly profile: NutritionProfile;
  readonly limits?: NutritionLimits;
  /** Declared categories this subtype may refine besides its own and "other" (a source often calls passata a vegetable). */
  readonly refines?: readonly ProductCategory[];
}
const subtype = (name: string, category: ProductCategory, words: string, prior: NutritionProfile, limits?: NutritionLimits, refines?: readonly ProductCategory[]): Subtype =>
  ({ name, category, words: w(words), profile: prior, limits, refines });

/**
 * Generic food words, ordered: a compound name takes the first match ("чипсы со вкусом кетчупа" is chips,
 * "томатный сок" is juice, "сырный соус" is a sauce). No brands and no barcodes.
 */
export const SUBTYPES: readonly Subtype[] = [
  subtype('zero_soda', 'beverage', '(?:cola|кола|soda|газировк\\p{L}*|лимонад\\p{L}*|напит\\p{L}*|pepsi|sprite|fanta)(?:\\s+\\p{L}+)*\\s+(?:zero|zero sugar|без сахара|sugar free|diet|light|лайт|max)|(?:zero|diet)\\s+(?:cola|кола|soda)',
    profile(0, 0.2, 0, 0, 0, 0, 0.02), { caloriesKcal: 10, sugarsG: 1, carbsG: 3, fatG: 0.5, proteinG: 0.5 }, ['juice']),
  subtype('soda', 'beverage', 'cola|кола|soda|газировк\\p{L}*|лимонад\\p{L}*|tonic|тоник|energy drink|энергетическ\\p{L}*', profile(0, 10.6, 0, 1, 0, 0, 0.02), { fatG: 0.5, proteinG: 1 }),
  subtype('juice', 'juice', 'juice|сок|соки|сока|нектар\\p{L}*|nectar|smoothie|смузи', CATEGORY_PROFILES.juice, CATEGORY_LIMITS.juice, ['beverage', 'fruit', 'vegetable']),
  subtype('plant_milk', 'dairy', '(?:соев|овсян|миндальн|рисов|горохов)\\p{L}*\\s+(?:молок\\p{L}*|напит\\p{L}*)|(?:oat|soy|soya|almond|rice|plant)\\s+(?:milk|drink)',
    profile(1, 5, 1.5, 0.5, 0.2, 0.5, 0.1), { proteinG: 4, fatG: 4 }, ['beverage']),
  subtype('condensed_milk', 'dairy', 'сгущен\\p{L}*|сгущенка|condensed', profile(7, 55, 8, 0.95, 0.6, 0, 0.3), undefined, ['sweets']),
  subtype('greek_yogurt', 'yogurt', '(?:greek|греческ\\p{L}*|skyr|скир|исландск\\p{L}*)(?:\\s+\\p{L}+)?', profile(9, 4, 3, 0.9, 0.65, 0, 0.1), { sugarsG: 6, carbsG: 8 }, ['dairy']),
  subtype('sweet_yogurt', 'yogurt', 'sweet(?:ened)?\\s+yogh?urt|(?:йогурт\\p{L}*|yogh?urt)\\s+(?:\\p{L}+\\s+)?(?:клубни\\p{L}*|персик\\p{L}*|вишн\\p{L}*|черни\\p{L}*|малин\\p{L}*|ванил\\p{L}*|фрукт\\p{L}*|злак\\p{L}*|strawberry|peach|cherry|vanilla|fruit|berry)',
    profile(3.5, 13, 3, 0.85, 0.65, 0.3, 0.1), undefined, ['dairy']),
  subtype('cookies', 'bakery', 'печенье|печенья|печеньки|cookies?|biscuits?', CATEGORY_PROFILES.bakery, undefined, ['snack']),
  subtype('crackers', 'snack', 'крекер\\p{L}*|crackers?|галет\\p{L}*|сухарик\\p{L}*|гренк\\p{L}*|croutons?', profile(10, 66, 14, 0.08, 0.4, 3, 1.6), { sugarsG: 15 }, ['bakery', 'bread']),
  subtype('crispbread', 'bread', 'хлебц\\p{L}*|crispbread|rice cakes?', profile(10, 70, 3, 0.05, 0.2, 10, 1), undefined, ['snack']),
  subtype('chips', 'snack', 'чипс\\p{L}*|chips|crisps|начос|nachos', CATEGORY_PROFILES.snack, { sugarsG: 10 }),
  subtype('cake', 'bakery', 'торт\\p{L}*|пирожн\\p{L}*|кекс\\p{L}*|маффин\\p{L}*|рулет\\p{L}*|бисквит\\p{L}*|cake|muffin|brownie|swiss roll', profile(5, 52, 20, 0.6, 0.5, 1.5, 0.4)),
  subtype('chocolate', 'chocolate', 'шоколад\\p{L}*|chocolate', CATEGORY_PROFILES.chocolate),
  subtype('candy', 'sweets', 'конфет\\p{L}*|карамел\\p{L}*|мармелад\\p{L}*|зефир\\p{L}*|пастил\\p{L}*|candy|candies|gummy|marshmallow', CATEGORY_PROFILES.sweets),
  subtype('instant_noodles', 'ready_meal', '(?:лапш\\p{L}*|noodles?|рамен|ramen)\\s+(?:\\p{L}+\\s+)*?(?:быстрого приготовления|instant)|instant\\s+(?:dry\\s+)?noodles?|рамен|ramen',
    profile(10, 60, 20, 0.05, 0.45, 3, 3), undefined, ['cereal']),
  subtype('cooked_pasta', 'ready_meal', '(?:cooked|prepared|boiled)\\s+(?:pasta|noodles?|spaghetti)|(?:готов\\p{L}*|варен\\p{L}*|приготовленн\\p{L}*)\\s+(?:макарон\\p{L}*|лапш\\p{L}*|паст\\p{L}*)', profile(5, 25, 2, 0.05, 0.3, 2, 0.6), undefined, ['cereal']),
  subtype('cooked_meal', 'ready_meal', 'casserole|запеканк\\p{L}*|lasagna|лазан\\p{L}*|pizza|пицц\\p{L}*', CATEGORY_PROFILES.ready_meal),
  subtype('pasta', 'cereal', 'макарон\\p{L}*|спагетти|вермишел\\p{L}*|рожки|перья|фузилли|пенне|pasta|spaghetti|penne|fusilli|macaroni|tagliatelle', profile(12, 71, 1.5, 0.05, 0.2, 3, 0.01), { fatG: 5, sugarsG: 5 }, ['ready_meal']),
  subtype('granola', 'cereal', 'гранол\\p{L}*|мюсли|granola|muesli', profile(9, 62, 15, 0.35, 0.3, 7, 0.1), undefined, ['snack']),
  subtype('flakes', 'cereal', 'кукурузн\\p{L}*\\s+хлопь\\p{L}*|corn flakes|cornflakes|сухой завтрак|завтрак сух\\p{L}*|подушечки|breakfast cereal', profile(7, 80, 2, 0.3, 0.3, 3, 1)),
  subtype('oats', 'cereal', 'овсян\\p{L}*|овес|oats?|oatmeal|porridge oats|геркулес', profile(13, 60, 7, 0.02, 0.2, 10, 0.01)),
  subtype('peanut_butter', 'nuts', '(?:арахисов\\p{L}*|ореховая|миндальн\\p{L}*)\\s+паст\\p{L}*|peanut butter|nut butter|almond butter', profile(25, 20, 50, 0.3, 0.2, 6, 0.5), undefined, ['sauce']),
  subtype('ketchup_no_sugar', 'sauce', '(?:ketchup|кетчуп\\p{L}*|ketçap)(?:\\s+\\p{L}+)*?\\s+(?:no sugar(?: added)?|sugar free|zero|без (?:добавления )?сахара|şekersiz)|(?:no sugar(?: added)?|sugar free|zero|без сахара)(?:\\s+\\p{L}+)*?\\s+(?:ketchup|кетчуп\\p{L}*)',
    profile(1.5, 6, 0.3, 0.6, 0.1, 1.5, 2), { proteinG: 3, fatG: 5, sugarsG: 6 }),
  subtype('ketchup', 'sauce', 'ketchup|кетчуп\\p{L}*|ketçap', profile(1, 25, 0.3, 0.8, 0.1, 1, 2.2), { proteinG: 3, fatG: 5 }),
  subtype('mayonnaise', 'sauce', 'mayonnaise|mayo|майонез\\p{L}*', profile(1, 2, 70, 0.5, 0.12, 0, 1.2)),
  subtype('mustard', 'sauce', 'mustard|горчиц\\p{L}*', profile(6, 6, 6, 0.25, 0.1, 3, 3), { fatG: 15 }),
  subtype('bbq', 'sauce', 'bbq|barbecue|barbeque|барбекю', profile(1, 35, 0.5, 0.8, 0.15, 1, 2), { fatG: 5, proteinG: 3 }),
  subtype('soy_sauce', 'sauce', 'soy\\s+sauce|соев\\p{L}*\\s+соус\\p{L}*|teriyaki|терияки', profile(5, 5, 0.1, 0.3, 0.15, 0.5, 5), { fatG: 1 }),
  subtype('tomato_paste', 'sauce', '(?:томатн\\p{L}*|tomato|domates)\\s+(?:паст\\p{L}*|paste|концентрат\\p{L}*|salçası|salcasi)|томат паста',
    profile(4.3, 14, 0.5, 0.85, 0.1, 4, 0.2), { fatG: 2, caloriesKcal: 130, proteinG: 7 }, ['vegetable', 'ready_meal']),
  subtype('passata', 'sauce', 'passata|пассата|(?:томатн\\p{L}*|tomato|tomate|domates)\\s+(?:пюре|puree|purée|püresi|purea)|(?:протерт\\p{L}*|перетерт\\p{L}*|измельченн\\p{L}*|резан\\p{L}*)\\s+(?:томат\\p{L}*|помидор\\p{L}*)|(?:crushed|chopped|strained|sieved)\\s+tomato\\p{L}*|polpa|tomato\\s+passata',
    profile(1.4, 5, 0.2, 0.75, 0.1, 1.5, 0.1), { fatG: 2, caloriesKcal: 60, proteinG: 3, saltG: 1.5 }, ['vegetable', 'ready_meal']),
  subtype('tomato_sauce', 'sauce', '(?:tomato|томатн\\p{L}*)\\s+(?:sauce|соус\\p{L}*)|(?:соус|sauce)\\s+(?:\\p{L}+\\s+)?(?:томатн\\p{L}*|tomato)|pasta sauce|marinara|болоньез\\p{L}*|bolognese|napoli',
    profile(1.5, 7, 2, 0.6, 0.15, 1.5, 0.8), { fatG: 10 }),
  // Any other sauce: keeps "сырный соус" or "соус с грибами" out of cheese or vegetables.
  subtype('sauce', 'sauce', 'соус\\p{L}*|sauce|dressing|заправк\\p{L}*', CATEGORY_PROFILES.sauce),
  subtype('beans', 'vegetable', 'фасол\\p{L}*|нут|чечевиц\\p{L}*|горох|горошек|beans?|chickpeas?|lentils?|peas', profile(6, 13, 0.6, 0.15, 0.15, 5, 0.6), { fatG: 6 }, ['ready_meal']),
  subtype('tuna', 'fish', 'тунец|тунца|tuna', profile(24, 0, 4, 0, 0.25, 0, 0.9), { carbsG: 3, sugarsG: 1 }),
  subtype('sausage', 'meat', 'колбас\\p{L}*|сосиск\\p{L}*|сардельк\\p{L}*|салями|ветчин\\p{L}*|sausages?|salami|ham|frankfurter|wiener', profile(13, 2, 25, 0.3, 0.38, 0, 2.2)),
  subtype('cheese', 'cheese', 'сыр|сыра|сыру|сыром|сыры|сыров|сырн\\p{L}*|cheese|cheddar|mozzarella|моцарелл\\p{L}*|пармезан|parmesan|фета|feta', CATEGORY_PROFILES.cheese),
  subtype('water', 'water', 'water|вода|воды|водой|mineralwasser', CATEGORY_PROFILES.water, CATEGORY_LIMITS.water, ['beverage']),
  subtype('milk', 'dairy', 'молок\\p{L}*|milk|кефир\\p{L}*|kefir|ряженк\\p{L}*|айран', profile(3.2, 4.7, 2.5, 1, 0.65, 0, 0.1), { fatG: 10 }),
  subtype('yogurt', 'yogurt', 'йогурт\\p{L}*|yogh?urt', CATEGORY_PROFILES.yogurt),
];

/** Category-only words for names no subtype matched. */
const CATEGORY_WORDS: readonly [RegExp, ProductCategory][] = [
  [w('хлеб\\p{L}*|батон\\p{L}*|багет\\p{L}*|bread|baguette|toast'), 'bread'],
  [w('булочк\\p{L}*|круассан\\p{L}*|выпечк\\p{L}*|пирог\\p{L}*|вафл\\p{L}*|pastry|croissant|waffles?|bun'), 'bakery'],
  [w('орех\\p{L}*|nuts?|almonds?|миндаль|фундук|кешью|арахис|peanuts?|cashews?'), 'nuts'],
  [w('пюре|лапш\\p{L}*|суп\\p{L}*|noodles?|soup|puree|mashed|каша|плов|ready meal'), 'ready_meal'],
  [w('соус\\p{L}*|sauce|dressing|заправк\\p{L}*'), 'sauce'],
  [w('круп\\p{L}*|хлопья|гречк\\p{L}*|рис|cereal|rice|buckwheat'), 'cereal'],
  [w('напит\\p{L}*|drink|beverage'), 'beverage'],
  [w('сладост\\p{L}*|sweets?'), 'sweets'],
  [w('овощ\\p{L}*|vegetables?|огурц\\p{L}*|томаты|помидор\\p{L}*|кукуруза|sweetcorn|брокколи'), 'vegetable'],
  [w('фрукт\\p{L}*|fruits?|яблок\\p{L}*|apples?|банан\\p{L}*|bananas?'), 'fruit'],
  [w('мяс\\p{L}*|куриц\\p{L}*|говядин\\p{L}*|свинин\\p{L}*|meat|chicken|beef|pork'), 'meat'],
  [w('рыб\\p{L}*|лосос\\p{L}*|fish|salmon|сардин\\p{L}*'), 'fish'],
];

/** Dry instant mixes per 100 g as sold: noodles with seasoning, mash flakes, soup powder. */
export const DRY_MIX_PROFILE = profile(10, 60, 17, 0.06, 0.45, 3, 3);

export interface EstimationProfile {
  readonly category: ProductCategory;
  readonly subtype: string;
  readonly prior: NutritionProfile;
  readonly limits: NutritionLimits;
  /** How the category was chosen: a name subtype, the declared category, name words, or nothing (other). */
  readonly source: 'subtype' | 'declared' | 'name' | 'fallback';
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly string[];
  readonly uncertainty: readonly string[];
}

/**
 * Declared category first, refined by a name subtype only when that subtype belongs to it (or the declared one is "other").
 * With no declared category: subtype → category words → "other".
 */
/** Evidence is collected by meaning/source, never by a nutrition threshold. */
type ProfileContext = Pick<Product, 'name' | 'category'> & Partial<Pick<Product, 'ingredients' | 'fieldEvidence' | 'nutrition' | 'semantics'>>;
const hasWords = (text: string, source: string) => w(source).test(text);
export function nutritionEstimationProfile(product: ProfileContext): EstimationProfile {
  const declared = product.category.value && product.category.value !== 'other' ? product.category.value : null;
  const name = normalizedName(product.name.value ?? '');
  const ingredients = product.fieldEvidence?.some(item => item.field === 'ingredients' && item.ingredientsOnly)
    ? '' : normalizedName((product.ingredients?.value ?? []).map(item => item.name).join(' '));
  const evidence: string[] = [], uncertainty: string[] = [];
  const match = name ? SUBTYPES.find(item => {
    if (!item.words.test(name) || (declared && item.category !== declared && !item.refines?.includes(declared))) return false;
    if (item.name === 'greek_yogurt') return declared === 'yogurt' || declared === 'dairy' || hasWords(name, 'yogh?urt|йогурт\\p{L}*|skyr|скир');
    if (item.name === 'condensed_milk') return hasWords(name, 'milk|молок\\p{L}*|сгущен\\p{L}*');
    return true;
  }) : undefined;
  const category = match?.category ?? declared ?? (name ? CATEGORY_WORDS.find(([words]) => words.test(name))?.[1] : undefined) ?? 'other';
  let subtype = match?.name ?? category;
  let prior = match?.profile ?? CATEGORY_PROFILES[category];
  let limits = { ...CATEGORY_LIMITS[category], ...match?.limits };
  const source = match ? 'subtype' : declared ? 'declared' : category !== 'other' ? 'name' : 'fallback';
  let confidence: ConfidenceLevel = source === 'fallback' ? 'low' : 'medium';
  if (declared) evidence.push('category:declared');
  if (match) evidence.push(`name:food_type:${match.category}`);
  else if (source === 'name') evidence.push(`name:food_family:${category}`);
  if (source === 'fallback') uncertainty.push('unknown_food_type', 'wide_nutrition_uncertainty');

  const signals = analyzeNutritionIngredients(product.fieldEvidence?.some(item => item.field === 'ingredients' && item.ingredientsOnly) ? [] : product.ingredients?.value ?? []);
  // Recipe claims require the food family AND the modifier. Bare "zero"/a number never qualifies.
  if (subtype === 'zero_soda' || subtype === 'ketchup_no_sugar') {
    evidence.push('name:explicit_no_sugar_recipe');
    const explicitClaim = hasWords(name, 'zero|zero sugar|no sugar(?: added)?|no added sugar|sugar free|без сахара|без добавления сахара|şekersiz');
    const earlySugar = (signals.sugarPosition >= 0 && signals.sugarPosition <= 2) || (!explicitClaim && !signals.sweetenerOnly);
    if (earlySugar) {
      const parent = subtype === 'zero_soda' ? 'soda' : 'ketchup';
      const parentProfile = SUBTYPES.find(item => item.name === parent)!;
      subtype = parent; prior = parentProfile.profile; limits = { ...CATEGORY_LIMITS[category], ...parentProfile.limits };
      confidence = 'low'; uncertainty.push('no_sugar_claim_conflicts_with_ingredients');
    } else if (signals.sweetenerOnly) { evidence.push('ingredients:sweetener_without_sugar'); confidence = 'high'; }
  }
  if (subtype === 'sweet_yogurt' && hasWords(name, 'unsweetened|plain|без сахара|без добавления сахара|несладк\\p{L}*')) {
    subtype = 'yogurt'; prior = CATEGORY_PROFILES.yogurt; limits = {};
    confidence = 'low'; uncertainty.push('sweet_recipe_unconfirmed');
  }
  if (subtype === 'sweet_yogurt') {
    evidence.push('name:sweet_or_fruit_variant');
    if (signals.sugarPosition >= 0) { evidence.push('ingredients:added_sugar'); confidence = 'high'; }
  }
  if (subtype === 'protein_product') {
    // This category must be supplied by identity data; known protein alone cannot select it.
    evidence.push('category:protein_product_identity');
  }
  if (subtype === 'mayonnaise' && hasWords(name, 'light|low fat|reduced fat|легк\\p{L}*|лайт')) {
    subtype = 'sauce'; prior = CATEGORY_PROFILES.sauce; limits = {};
    confidence = 'low'; uncertainty.push('reduced_fat_recipe_unconfirmed');
  }

  // A recognised food + an explicit sugar-free claim can refine sugar alone, never all macros.
  const noAddedSugar = hasWords(name, 'no sugar added|no added sugar|без (?:добавления|добавленного) сахара');
  const sugarFree = !noAddedSugar && hasWords(name, 'no sugar|sugar free|без сахара|şekersiz');
  if (source !== 'fallback' && sugarFree && signals.sugarPosition < 0 && subtype !== 'zero_soda' && subtype !== 'ketchup_no_sugar') {
    prior = { ...prior, sugarShare: Math.min(prior.sugarShare, 0.3) };
    evidence.push('sugars:food_identity_and_sugar_free_claim');
  }
  const eligible = subtype === 'ready_meal' || subtype === 'instant_noodles';
  const waterFirst = /^(?:water|вода)(?:\s|$)/u.test(ingredients);
  const cooked = waterFirst || hasWords(name, 'cooked|prepared|ready to eat|варен\\p{L}*|готов\\p{L}*|приготовленн\\p{L}*|запеканк\\p{L}*|casserole|лазан\\p{L}*|lasagna|пицц\\p{L}*|pizza');
  const family = hasWords(name, 'noodles?|лапш\\p{L}*|soup|суп\\p{L}*|пюре|mash|ramen|рамен');
  const dryName = hasWords(name, 'instant|dry|dried|dehydrated|powder|mix|сух(?:ой|ая|ое|ие|ого|их|ую|ом)|быстрого приготовления|порош\\p{L}*|концентрат\\p{L}*');
  const preparation = hasWords(name + ' ' + ingredients, 'add (?:hot |boiling )?water|rehydrat\\p{L}*|залить кипятком|добавить (?:воду|кипяток)|развести водой');
  const seasoning = hasWords(ingredients, 'seasoning|приправа|бульон|broth');
  const dryComponents = seasoning && hasWords(ingredients, 'dried|dehydrated|сушен\\p{L}*|сух\\p{L}*') && hasWords(ingredients, 'noodles?|лапш\\p{L}*|flakes|хлопь\\p{L}*|powder|порош\\p{L}*');
  const dryConfirmed = eligible && !cooked && (family || declared === 'ready_meal') && (dryName || preparation || dryComponents);
  if (eligible && !cooked) {
    if (family) evidence.push('name:meal_family');
    if (dryName) evidence.push('name:dry_preparation_form');
    if (preparation) evidence.push('preparation:rehydration');
    if (dryComponents) evidence.push('ingredients:dry_components_and_seasoning');
    if (dryConfirmed) {
      subtype = subtype === 'instant_noodles' ? 'instant_noodles' : 'dry_mix';
      const macros = subtype === 'instant_noodles' ? prior : DRY_MIX_PROFILE;
      // Dryness does not identify the fat type. Salt needs separate composition/category support.
      const saltInIngredients = hasWords(ingredients, 'salt|соль|соли|солью|tuz');
      const saltSupported = saltInIngredients && seasoning;
      prior = { ...macros, saturatedShare: CATEGORY_PROFILES.ready_meal.saturatedShare,
        salt: saltSupported ? DRY_MIX_PROFILE.salt : subtype === 'instant_noodles' ? 1.5 : CATEGORY_PROFILES.ready_meal.salt };
      evidence.push(saltSupported ? 'salt:seasoning_and_salt_ingredient' : 'salt:parent_prior_no_composition_confirmation');
      confidence = dryComponents || preparation ? 'high' : 'medium';
    } else if (subtype === 'instant_noodles') {
      subtype = 'ready_meal'; prior = CATEGORY_PROFILES.ready_meal;
      confidence = 'low'; uncertainty.push('dry_form_unconfirmed');
    } else if (family) uncertainty.push('dry_or_prepared_form_unknown');
  }
  if (cooked && eligible) {
    subtype = 'ready_meal'; prior = CATEGORY_PROFILES.ready_meal;
    evidence.push(waterFirst ? 'ingredients:water_first_prepared_form' : 'name:prepared_form');
  }
  return { category, subtype, prior, limits, source, confidence, evidence, uncertainty };
}
