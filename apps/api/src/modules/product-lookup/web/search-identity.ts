import { sameWords } from './product-identity';

/** Юридические и описательные слова этикетки: на страницах магазинов их нет. Дополняется здесь. */
const LEGAL_PHRASES: readonly RegExp[] = [
  /(?:мучное\s+)?кондитерское\s+изделие(?:\s+в\s+глазури)?/gi,
  /изделие\s+в\s+глазури/gi,
  /продукт\s+пищевой|пищевой\s+продукт/gi,
  /(?:масса\s+)?нетто[\s:]*\d*[.,]?\d*\s*(?:г|гр|кг|мл|л|g|kg|ml)?/gi,
  /торговая\s+марка|товарный\s+знак/gi,
];
const QUOTED = /«[^«»]*»|"[^"]*"/g;
const BRACKETS = /\([^()]*\)/g;
const EDGE_PUNCTUATION = /^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g;

const tidy = (text: string): string => text.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');

function withoutPhrases(name: string): string {
  return LEGAL_PHRASES.reduce((text, phrase) => text.replace(phrase, ' '), name);
}

/** Убирает скобки и кавычки, которые только повторяют название, в том числе в переводе. Вариант в скобках остаётся. */
function withoutDuplicates(name: string, pattern: RegExp): string {
  return name.replace(pattern, (part) => (sameWords(part, name.replace(part, ' ')) ? ' ' : part));
}

/**
 * Короткое коммерческое имя только для поиска и сверки страниц. Пользователю показывается название из источника.
 * Если очистка съела всё, остаётся исходное название.
 */
export function searchName(name: string | null): string | null {
  if (!name) return name;
  const unquoted = withoutDuplicates(withoutDuplicates(withoutPhrases(name), QUOTED), BRACKETS);
  const short = tidy(withoutDuplicates(unquoted, BRACKETS).replace(/\(\s*\)/g, ' '));
  return short || name;
}
