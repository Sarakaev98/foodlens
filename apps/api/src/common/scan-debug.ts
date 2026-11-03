/** Подробные логи скана: штрихкод и кандидаты веб-поиска. В production только с DEBUG_SCAN=true. */
export function scanDebugEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.DEBUG_SCAN === 'true';
}
