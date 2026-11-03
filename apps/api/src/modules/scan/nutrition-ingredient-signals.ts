import type { Ingredient, ProductCategory } from '@foodlens/core';

/** Tokens are Unicode letters, not JS ASCII \b boundaries or arbitrary substrings. */
const tokens = (text: string): string[] => text.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').match(/[\p{L}\p{M}]+/gu) ?? [];
const SUGAR = /^(?:сахар(?:а|у|ом)?|сахароза|сироп(?:а|ы|ов)?|глюкоз(?:а|ы)|фруктоз(?:а|ы)|декстроз(?:а|ы)|мальтоз(?:а|ы)|паток(?:а|и)|мед(?:а|у|ом)?|sugars?|sucrose|syrups?|glucose|fructose|dextrose|maltose|molasses|honey|şeker|glukoz|fruktoz)$/u;
const SWEETENER = /^(?:подсластитель|подсластители|подсластителя|подсластителей|сукралоза|сукралозы|стевия|стевии|сахарозаменитель|сахарозаменители|эритрит|эритритол|аспартам|ацесульфам|сахарин|цикламат|мальтит|сорбит|ксилит|sweeteners?|sucralose|stevia|steviol|erythritol|aspartame|acesulfame|saccharin|cyclamate|maltitol|sorbitol|xylitol)$/u;
const SATURATED = /^(?:пальмов(?:ое|ая|ый|ые|ого|ых)|кокосов(?:ое|ая|ый|ые|ого|ых)|сливочн(?:ое|ая|ый|ые|ого|ых)|palm|coconut|butter)$/u;
const UNSATURATED = /^(?:подсолнечн(?:ое|ая|ый|ые|ого|ых)|оливков(?:ое|ая|ый|ые|ого|ых)|рапсов(?:ое|ая|ый|ые|ого|ых)|sunflower|olive|rapeseed|canola)$/u;
const FIBER = /^(?:цельнозернов(?:ая|ое|ой|ые|ую|ого|ых)|отруби|отрубей|бобы|бобов|бобовые|бобовых|чечевица|чечевицы|овсян(?:ая|ые|ое|ой|ого|ых|ую)|овсянка|овес|wholegrain|wholewheat|bran|lentils?|beans?|oats?|oatmeal)$/u;
const SALT = /^(?:соль|соли|солью|salt|tuz|salz)$/u;
const SUGAR_MODIFIERS = new Set(['тростниковый','свекловичный','коричневый','белый','натуральный','цветочный','пчелиный','инвертный','глюкозный','фруктозный','мальтозный','рисовый','кукурузный','кленовый','cane','brown','white','natural','raw','organic','corn','rice','maple','agave']);

interface Component { readonly root: string; readonly children: readonly Component[] }
/** Split only at the current depth; parentheses/square brackets retain component roles. */
function components(text: string): Component[] {
  const parts: string[] = []; let start = 0, depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') depth++;
    else if (text[i] === ')' || text[i] === ']') depth = Math.max(0, depth - 1);
    else if ((text[i] === ',' || text[i] === ';') && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.filter(part => part.trim()).map(part => {
    let root = '', nested = '', level = 0; const children: Component[] = [];
    for (const char of part) {
      if (char === '(' || char === '[') { if (level++ > 0) nested += char; else root += ' '; }
      else if (char === ')' || char === ']') { if (level > 0 && --level === 0) { children.push(...components(nested)); nested = ''; } else if (level > 0) nested += char; }
      else if (level > 0) nested += char; else root += char;
    }
    // Incomplete OCR bracket remains nested; it must never become top-level sugar.
    if (nested) children.push(...components(nested));
    return { root: root.trim(), children };
  });
}
const descendants = (node: Component): Component[] => node.children.flatMap(child => [child, ...descendants(child)]);
const has = (node: Component, pattern: RegExp) => tokens(node.root).some(word => pattern.test(word));

export function analyzeNutritionIngredients(ingredients: readonly Ingredient[]) {
  const roots = ingredients.flatMap(item => components(item.name));
  const all = roots.flatMap(node => [node, ...descendants(node)]);
  const topLevelSugars = roots.flatMap((node, index) => {
    const matchedTokens = tokens(node.root).filter(word => SUGAR.test(word));
    return matchedTokens.length ? [{ index, ingredient: node.root, matchedTokens }] : [];
  });
  const nestedSugars = roots.flatMap((node, componentIndex) => descendants(node).flatMap(child => {
    const matchedTokens = tokens(child.root).filter(word => SUGAR.test(word));
    return matchedTokens.length ? [{ componentIndex, ingredient: child.root, matchedTokens }] : [];
  }));
  const first = roots[0];
  const strongTopLevelSugar = !!first && has(first, SUGAR) && tokens(first.root).every(word => SUGAR.test(word) || SUGAR_MODIFIERS.has(word));
  return { topLevelSugars, nestedSugars, strongTopLevelSugar,
    sugarPosition: topLevelSugars[0]?.index ?? -1,
    saltPosition: roots.findIndex(node => has(node, SALT)),
    hasSaturatedFat: all.some(node => has(node, SATURATED)),
    hasUnsaturatedFat: all.some(node => has(node, UNSATURATED)),
    hasFiber: all.some(node => has(node, FIBER) || /(?:^|\s)whole\s+(?:grain|wheat)(?:\s|$)/u.test(tokens(node.root).join(' '))),
    sweetenerOnly: all.some(node => has(node, SWEETENER)) && topLevelSugars.length === 0 && nestedSugars.length === 0,
  };
}

const SWEET_CATEGORIES: readonly ProductCategory[] = ['chocolate', 'sweets', 'bakery', 'beverage', 'juice', 'dairy', 'yogurt', 'fruit'];
/** A high estimate in other categories needs an explicit primary sugar ingredient, not a nested mention. */
export function estimateSugarShare(category: ProductCategory, prior: number, signals: ReturnType<typeof analyzeNutritionIngredients>, addedSugar: boolean) {
  const sweetCategory = SWEET_CATEGORIES.includes(category);
  const position = signals.sugarPosition;
  const positional = position < 0 ? 0 : position === 0 ? 0.65 : position <= 2 ? 0.45 : 0.2;
  const proposed = Math.max(prior, positional, position < 0 && sweetCategory && addedSugar ? 0.25 : 0);
  const categoryCap = sweetCategory || signals.strongTopLevelSugar ? 1 : Math.max(prior, Math.min(0.2, 2 * prior));
  const share = Math.min(proposed, categoryCap);
  return { share, prior, positional, categoryCap, capped: proposed > categoryCap, sweetCategory, strongTopLevelSugar: signals.strongTopLevelSugar };
}
