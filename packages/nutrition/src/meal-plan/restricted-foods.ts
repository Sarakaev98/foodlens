import type { AllergenCode, DietaryPreference } from '@foodlens/core';

/**
 * Основы слов для детерминированной проверки плана: продукт ищется по началу слова, в тексте с нижним регистром и е вместо ё.
 * Каждая строка — фрагмент регулярного выражения.
 */
const MEAT = ['говядин', 'говяж', 'свинин', 'свин[оа]', 'баранин', 'телятин', 'куриц', 'курин', 'курятин', 'цыпл', 'индейк', 'индюш', 'утк', 'утин', 'гус[ьи]', 'гусин', 'мяс', 'фарш', 'бекон', 'ветчин', 'колбас', 'сосиск', 'сардельк', 'кролик', 'печен[ьи](?![ея])', 'желатин', 'бульон', 'beef', 'pork', 'chicken', 'turkey', 'lamb', 'bacon', 'ham', 'meat', 'duck', 'sausage', 'gelatin', 'broth', 'veal', 'mutton', 'goose', 'venison', 'rabbit', 'steak', 'mince', 'poultry', 'salami', 'pepperoni', 'prosciutto', 'chorizo', 'meatball', 'liver', 'stock(?! ?pot)'];
const FISH = ['рыб', 'лосос', 'семг', 'форел', 'тунец', 'тунц', 'сельд', 'скумбри', 'треск', 'хек', 'минта', 'горбуш', 'кет[ауы]?(?![а-я])', 'судак', 'дорадо', 'сибас', 'анчоус', 'шпрот', 'сардин', 'икр', 'fish', 'salmon', 'tuna', 'cod', 'herring', 'anchov', 'trout', 'mackerel', 'sardine', 'haddock', 'pollock', 'hake', 'tilapia', 'halibut', 'sea bass', 'seabass', 'sea bream', 'perch', 'pike', 'caviar', 'roe(?![a-z])', 'sprat'];
const CRUSTACEANS = ['кревет', 'краб', 'лангуст', 'омар', 'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine', 'scampi'];
const MOLLUSCS = ['миди[иийя]', 'кальмар', 'осьминог', 'устриц', 'гребешк', 'squid', 'mussel', 'oyster', 'clam', 'octopus', 'scallop', 'calamari', 'cuttlefish', 'snail', 'escargot'];
const MILK = ['молок', 'молоч', 'сливк', 'сливоч', 'кефир', 'йогурт', 'творог', 'творож', 'сыр(?:[аеуы]|ом|ный|ная|ное|ные|ник[а-я]*)?(?![а-я])', 'сметан', 'ряженк', 'простокваш', 'скир', 'сывороточ', 'казеин', 'брынз', 'фет[аеуы]?(?![а-я])', 'моцарелл', 'пармезан', 'рикотт', 'маскарпоне', 'гхи', 'milk', 'cream', 'cheese', 'yogurt', 'yoghurt', 'butter', 'whey', 'kefir', 'ghee', 'curd', 'casein', 'skyr', 'quark', 'paneer', 'mozzarella', 'parmesan', 'ricotta', 'feta', 'cheddar', 'mascarpone', 'brie', 'halloumi', 'labneh', 'dairy', 'lactose'];
const EGGS = ['яйц', 'яйк', 'яичн', 'яиц', 'омлет', 'глазунь', 'майонез', 'меренг', 'egg', 'omelet', 'omelette', 'mayonnaise', 'mayo', 'meringue', 'frittata', 'quiche', 'aioli'];
const HONEY = ['мед(?:а|у|ом|е)?(?![а-я])', 'медов', 'honey'];
const GLUTEN = ['пшенич', 'пшениц', 'мук(?:а|и|у|ой)?(?![а-я])', 'хлеб', 'батон', 'лаваш', 'макарон', 'спагетти', 'лапш', 'булгур', 'кускус', 'перлов', 'ячнев', 'ячмен', 'рож(?:ь|ной|ью)(?![а-я])', 'ржан', 'манн(?:ая|ой|ую|ка|ки)(?![а-я])', 'овсян', 'овес', 'овса', 'тортиль', 'сухар', 'панировк', 'печень[ея]', 'пицц', 'блин', 'оладь', 'гранол', 'мюсли', 'сейтан', 'соев[а-я]* соус', 'wheat', 'bread', 'pasta', 'barley', 'rye', 'couscous', 'bulgur', 'noodle', 'seitan', 'oat', 'soy sauce', 'flour', 'spelt', 'semolina', 'farro', 'spaghetti', 'macaroni', 'penne', 'fusilli', 'lasagn', 'tortilla', 'pita', 'lavash', 'bagel', 'croissant', 'cracker', 'crouton', 'breadcrumb', 'pizza', 'pancake', 'muffin', 'granola', 'muesli', 'udon', 'ramen', 'biscuit', 'dumpling'];
const PEANUTS = ['арахис', 'peanut'];
const TREE_NUTS = ['миндал', 'фундук', 'грецк', 'кешью', 'фисташ', 'пекан', 'макадам', 'кедров', 'орех', 'орешк', 'almond', 'walnut', 'hazelnut', 'cashew', 'pistachio', 'pecan', 'nut', 'macadamia', 'praline', 'marzipan'];
const SOY = ['соя', 'сои', 'сою', 'соев', 'тофу', 'эдамаме', 'темпе(?![а-я])', 'мисо', 'soy', 'tofu', 'edamame', 'tempeh', 'miso'];
const CELERY = ['сельдере', 'celery'];
const MUSTARD = ['горчиц', 'горчичн', 'mustard'];
const SESAME = ['кунжут', 'тахин', 'хумус', 'sesame', 'tahini', 'hummus'];
const SULPHITES = ['вин[оа](?![а-я])', 'сухофрукт', 'кураг', 'изюм', 'чернослив', 'wine', 'raisin', 'dried fruit', 'dried apricot', 'prune'];
const LUPIN = ['люпин', 'lupin'];

/** Для состава с упаковки: сухофрукты и вино здесь не признак сульфитов, важно только прямое упоминание. */
const SULPHITES_STATED = ['сульфит', 'диоксид серы', 'sulphite', 'sulfite', 'e22[0-8]'];

export const ALLERGEN_FOODS: Readonly<Record<AllergenCode, readonly string[]>> = {
  gluten: GLUTEN,
  crustaceans: CRUSTACEANS,
  eggs: EGGS,
  fish: FISH,
  peanuts: PEANUTS,
  soy: SOY,
  milk: MILK,
  tree_nuts: TREE_NUTS,
  celery: CELERY,
  mustard: MUSTARD,
  sesame: SESAME,
  sulphites: SULPHITES,
  lupin: LUPIN,
  molluscs: MOLLUSCS,
};

export const LABEL_ALLERGEN_FOODS: Readonly<Record<AllergenCode, readonly string[]>> = { ...ALLERGEN_FOODS,
  // A Russian adjective in lactic acid is not a statement of milk content. Keep every other dairy match.
  milk: MILK.map(term => term === 'молоч' ? 'молоч(?!н[а-я]*[\\s-]+кислот)' : term),
  sulphites: SULPHITES_STATED };

/** Диета без запретов (none) сюда не входят: проверять нечего. */
export const DIET_FOODS: Readonly<Partial<Record<DietaryPreference, readonly string[]>>> = {
  vegan: [...MEAT, ...FISH, ...CRUSTACEANS, ...MOLLUSCS, ...MILK, ...EGGS, ...HONEY],
  vegetarian: [...MEAT, ...FISH, ...CRUSTACEANS, ...MOLLUSCS],
  pescatarian: MEAT,
};

const ALTERNATIVES = 'соев|кокосов|миндальн|овсян|рисов|растительн|ореховы|кешью|гречнев';
const NON_WHEAT = 'рисов|гречнев|кукурузн|миндальн|кокосов|нутов';

/**
 * Безопасные замены: «кокосовое молоко» не молоко, «кабачковая икра» не рыба. Заменяются на группу $1 перед проверкой:
 * определение остаётся, поэтому «соевое молоко» всё ещё соя, а «миндальная мука» всё ещё орехи.
 */
export const SAFE_PHRASES: readonly RegExp[] = [
  new RegExp(`((?:${ALTERNATIVES})[а-я]*)\\s+(?:молок|сливк|йогурт|сыр|творог|кефир)[а-я]*`, 'g'),
  new RegExp(`(?:молок|сливк|йогурт|сыр|творог)[а-я]*\\s+((?:${ALTERNATIVES})[а-я]*)`, 'g'),
  /()(?:овощн|грибн)[а-я]*\s+бульон[а-я]*/g,
  /()бульон[а-я]*\s+(?:овощн|грибн)[а-я]*/g,
  /()(?:кабачков|баклажанн|овощн)[а-я]*\s+икр[а-я]*/g,
  new RegExp(`((?:${NON_WHEAT})[а-я]*)\\s+(?:мук|лапш|хлеб|макарон|хлопь)[а-я]*`, 'g'),
  new RegExp(`(?:мук|лапш|хлопь)[а-я]*\\s+((?:${NON_WHEAT})[а-я]*)`, 'g'),
  /()безглютенов[а-я]*\s+[а-я]+/g,
  /()мускатн[а-я]*\s+орех[а-я]*/g,
  /\b(coconut|soy|almond|oat|rice|plant)[ -](?:milk|cream|yogurt|butter)/g,
  /\b(peanut|almond|cashew|cocoa|shea)[ -]butter/g,
  /()nutmeg/g,
  /()nutritional yeast/g,
  /()eggplants?/g,
  /()butternut/g,
  /\b(soy|bean) curd/g,
  /()(?:vegetable|veggie|mushroom) (?:broth|stock)/g,
  /\b(rice|buckwheat|corn|almond|coconut|chickpea|oat)[ -](?:flour|noodles?|pasta|bread|tortillas?|crackers?)/g,
  /()gluten[- ]free [a-z]+/g,
];
