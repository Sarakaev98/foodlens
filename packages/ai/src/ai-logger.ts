/**
 * Логгер, который провайдер получает снаружи (в API это Nest Logger).
 * В поля передаются только технические данные: никаких ключей, заголовков и изображений.
 */
export interface AILogger {
  log(message: string, fields: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields: Readonly<Record<string, unknown>>): void;
}

export const SILENT_AI_LOGGER: AILogger = { log: () => undefined, warn: () => undefined };
