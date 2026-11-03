import type { AnalyzeMealPhotoInput } from '../../ai-provider.types';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { MEAL_PHOTO_OUTPUT_SCHEMA, vertexMealPhotoResponseSchema, type MealPhotoAiOutput } from '../../meal-photo/meal-photo-output-schema';
import { MEAL_PHOTO_SYSTEM_PROMPT, MEAL_PHOTO_USER_PROMPT } from '../../meal-photo/meal-photo-prompt';
import { logGeminiUsage } from './gemini-usage';

/** Одно фото и короткий ответ: обычно 5–15 с, запас на медленную сеть. */
export const GOOGLE_MEAL_PHOTO_TIMEOUT_MS = 45000;

export interface GoogleMealPhotoProviderConfig {
  readonly apiKey: string;
  readonly project: string;
  readonly location: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: AILogger;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const failure = (code: AIProviderErrorCode, httpStatus?: number) => new AIProviderError('google', code, `Google meal photo: ${code}`, { httpStatus });

/** Один запрос generateContent: фото + короткий prompt + JSON-схема. Повторов нет. */
export class GoogleMealPhotoProvider {
  private readonly logger: AILogger;
  private readonly transport: typeof globalThis.fetch;

  constructor(private readonly config: GoogleMealPhotoProviderConfig) {
    this.logger = config.logger ?? SILENT_AI_LOGGER;
    this.transport = config.fetch ?? globalThis.fetch;
  }

  async analyze({ image, requestId }: AnalyzeMealPhotoInput): Promise<MealPhotoAiOutput> {
    const { apiKey, project, location, model } = this.config;
    if (!image.base64) throw failure('unsupported_input');
    if (!apiKey || !project) throw failure('not_configured');
    const url = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const signal = AbortSignal.timeout(this.config.timeoutMs ?? GOOGLE_MEAL_PHOTO_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await this.transport(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: MEAL_PHOTO_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: MEAL_PHOTO_USER_PROMPT }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] }],
          generationConfig: {
            ...(model.startsWith('gemini-3.5-flash-lite')
              ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } }
              : { temperature: 0, thinkingConfig: { thinkingBudget: 0 } }),
            responseMimeType: 'application/json',
            responseSchema: vertexMealPhotoResponseSchema(),
            maxOutputTokens: 1024,
          },
        }),
      });
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel().catch(() => undefined);
        throw failure(
          status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request',
          status,
        );
      }
      const envelope: unknown = await response.json().catch(() => null);
      logGeminiUsage(this.logger, 'meal_photo', model, envelope, 1);
      const output = parseOutput(envelope);
      this.logger.log('google request', {
        provider: 'google',
        model,
        requestType: 'meal_photo',
        requestId: requestId ?? null,
        success: true,
        latencyMs: Date.now() - started,
      });
      return output;
    } catch (error) {
      // Тексты внешних ошибок наружу не уходят: в них могут быть данные запроса.
      const code = error instanceof AIProviderError ? error.code : signal.aborted ? 'timeout' : 'unavailable';
      const httpStatus = error instanceof AIProviderError ? error.httpStatus : undefined;
      this.logger.warn('google request', {
        provider: 'google',
        model,
        requestType: 'meal_photo',
        requestId: requestId ?? null,
        success: false,
        latencyMs: Date.now() - started,
        code,
        httpStatus,
      });
      throw error instanceof AIProviderError ? error : failure(code);
    }
  }
}

function parseOutput(envelope: unknown): MealPhotoAiOutput {
  const candidate = record(envelope) && Array.isArray(envelope.candidates) ? envelope.candidates[0] : null;
  if (!record(candidate) || candidate.finishReason !== 'STOP') throw failure('invalid_response');
  const content = record(candidate.content) ? candidate.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter((part) => record(part) && typeof part.text === 'string' && part.thought !== true)
    .map((part) => (part as { text: string }).text)
    .join('');
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw failure('invalid_response');
  }
  if (findSchemaViolation(MEAL_PHOTO_OUTPUT_SCHEMA, output) !== null) throw failure('invalid_response');
  return output as MealPhotoAiOutput;
}
