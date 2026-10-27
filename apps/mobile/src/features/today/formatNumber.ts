/** 2490 → "2 490". Без Intl, чтобы одинаково работало на всех движках JS. */
export function formatInteger(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
