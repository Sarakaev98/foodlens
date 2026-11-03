import type { AILogger } from '../../ai-logger';

export type GeminiRequestType =
  | 'product_analysis'
  | 'goal_match'
  | 'nutrition_search'
  | 'nutrition_extraction'
  | 'ingredients_extraction'
  | 'meal_plan'
  | 'meal_photo';

/** Only numeric token counts from Gemini usageMetadata; null where Google did not report a count. */
export interface GeminiUsage {
  readonly prompt: number | null;
  readonly output: number | null;
  readonly thoughts: number | null;
  readonly cached: number | null;
  readonly total: number | null;
  /** promptTokensDetails by modality (the image of product_analysis, the text of both calls). */
  readonly image: number | null;
  readonly text: number | null;
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
function modality(details: unknown, name: string): number | null {
  if (!Array.isArray(details)) return null;
  let sum: number | null = null;
  for (const d of details)
    if (record(d) && d.modality === name) {
      const n = count(d.tokenCount);
      if (n !== null) sum = (sum ?? 0) + n;
    }
  return sum;
}

/** Reads response.usageMetadata; copies nothing but numbers, so the log can never carry text, images or keys. */
export function extractGeminiUsage(envelope: unknown): GeminiUsage | null {
  const u = record(envelope) ? envelope.usageMetadata : null;
  if (!record(u)) return null;
  return {
    prompt: count(u.promptTokenCount),
    output: count(u.candidatesTokenCount),
    thoughts: count(u.thoughtsTokenCount),
    cached: count(u.cachedContentTokenCount),
    total: count(u.totalTokenCount),
    image: modality(u.promptTokensDetails, 'IMAGE'),
    text: modality(u.promptTokensDetails, 'TEXT'),
  };
}

/**
 * One line per Google call: gemini_usage {"type":...,"model":...,"prompt":N,...}. Logged also for responses later rejected.
 * numberOfImages (product_analysis and meal_photo) comes with retries:0: one scan is one HTTP call, there is no retry.
 */
export function logGeminiUsage(logger: AILogger, type: GeminiRequestType, model: string, envelope: unknown, numberOfImages?: number): void {
  const usage = extractGeminiUsage(envelope);
  const images = numberOfImages === undefined ? {} : { numberOfImages, retries: 0 };
  logger.log('gemini_usage', usage ? { type, model, ...usage, ...images } : { type, model, usage: 'missing', ...images });
}
