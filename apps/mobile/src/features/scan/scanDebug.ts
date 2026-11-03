/** Только в разработке: путь штрихкода от камеры до запроса. Фото и ключей здесь не бывает. */
export function scanDebugLog(event: string, fields: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(event, JSON.stringify(fields));
}
