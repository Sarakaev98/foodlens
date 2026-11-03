import type { GoalMatchAiInput, GoalMatchAiOutput } from '@foodlens/core';
import type { GoalMatchEvaluator } from '../../goal-match-provider';
import { SILENT_AI_LOGGER, type AILogger } from '../../ai-logger';
import { AIProviderError, type AIProviderErrorCode } from '../../errors';
import { findSchemaViolation } from '../../json-schema/json-schema';
import { GOAL_MATCH_RUBRIC_PROMPT } from '../../goal-match/goal-match-prompt';
import { GOAL_MATCH_OUTPUT_SCHEMA, vertexGoalMatchResponseSchema } from '../../goal-match/goal-match-output-schema';
import { logGeminiUsage } from './gemini-usage';

export const GOOGLE_GOAL_MATCH_MODEL = 'gemini-3.5-flash-lite';
export const GOOGLE_GOAL_MATCH_TIMEOUT_MS = 7500;
export interface GoogleGoalMatchProviderConfig {
  readonly apiKey?: string;
  readonly project?: string;
  readonly location?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  /** Receives only numeric gemini_usage counts. */
  readonly logger?: AILogger;
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const safeMessage = (code: AIProviderErrorCode) =>
  ({
    not_configured: 'Google Goal Match is not configured',
    authentication_failed: 'Google Goal Match authentication failed',
    rate_limited: 'Google Goal Match quota or rate limit exceeded',
    bad_request: 'Google Goal Match request rejected',
    timeout: 'Google Goal Match request timed out',
    invalid_response: 'Google Goal Match returned an invalid response',
    refused: 'Google Goal Match response was blocked',
  })[code as string] ?? 'Google Goal Match is unavailable';

/** Backend-only, text-only evaluator. No image-analysis methods and no fallback model. */
export class GoogleGoalMatchProvider implements GoalMatchEvaluator {
  readonly name = 'google';
  readonly model: string;
  readonly project: string;
  readonly location: string;
  readonly #apiKey: string;
  readonly #transport: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #logger: AILogger;

  constructor(config: GoogleGoalMatchProviderConfig) {
    this.#apiKey = config.apiKey?.trim() ?? '';
    this.project = config.project?.trim() ?? '';
    this.location = config.location?.trim() || 'global';
    this.model = config.model?.trim() || GOOGLE_GOAL_MATCH_MODEL;
    this.#transport = config.fetch ?? globalThis.fetch;
    this.#timeoutMs = config.timeoutMs ?? GOOGLE_GOAL_MATCH_TIMEOUT_MS;
    this.#logger = config.logger ?? SILENT_AI_LOGGER;
  }

  async evaluateGoalMatch(input: GoalMatchAiInput): Promise<GoalMatchAiOutput> {
    if (
      !this.#apiKey ||
      !this.project ||
      !/^[a-zA-Z0-9-]+$/u.test(this.project) ||
      !/^[a-zA-Z0-9-]+$/u.test(this.location) ||
      !/^[a-zA-Z0-9._-]+$/u.test(this.model) ||
      !Number.isFinite(this.#timeoutMs) ||
      this.#timeoutMs <= 0
    ) {
      throw new AIProviderError(this.name, 'not_configured', safeMessage('not_configured'));
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AIProviderError(this.name, 'timeout', safeMessage('timeout')));
      }, this.#timeoutMs);
    });
    try {
      return await Promise.race([this.request(input, controller.signal), timeout]);
    } catch (error) {
      // Rebuild known errors and omit causes/bodies: upstream diagnostics may contain credentials.
      const code = error instanceof AIProviderError ? error.code : controller.signal.aborted ? 'timeout' : 'unavailable';
      throw new AIProviderError(this.name, code, safeMessage(code), error instanceof AIProviderError ? { httpStatus: error.httpStatus } : undefined);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async request(input: GoalMatchAiInput, signal: AbortSignal): Promise<GoalMatchAiOutput> {
    const url =
      'https://aiplatform.googleapis.com/v1/projects/' +
      encodeURIComponent(this.project) +
      '/locations/' +
      encodeURIComponent(this.location) +
      '/publishers/google/models/' +
      encodeURIComponent(this.model) +
      ':generateContent';
    const response = await this.#transport(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: GOAL_MATCH_RUBRIC_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          ...(this.model.startsWith('gemini-3.5-flash-lite')
            ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } }
            : { temperature: 0, thinkingConfig: { thinkingBudget: 0 } }),
          responseMimeType: 'application/json',
          responseSchema: vertexGoalMatchResponseSchema(),
          maxOutputTokens: 2048,
        },
      }),
    });
    if (!response.ok) {
      const status = response.status;
      const code: AIProviderErrorCode =
        status === 401 || status === 403 ? 'authentication_failed' : status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'bad_request';
      await response.body?.cancel().catch(() => undefined);
      throw new AIProviderError(this.name, code, safeMessage(code), { httpStatus: status });
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new AIProviderError(this.name, 'invalid_response', safeMessage('invalid_response'));
    }
    logGeminiUsage(this.#logger, 'goal_match', this.model, envelope);
    const candidate = record(envelope) && Array.isArray(envelope.candidates) ? envelope.candidates[0] : null;
    if (!record(candidate) || candidate.finishReason !== 'STOP') {
      const code = candidate && record(candidate) && ['SAFETY', 'PROHIBITED_CONTENT'].includes(String(candidate.finishReason)) ? 'refused' : 'invalid_response';
      throw new AIProviderError(this.name, code, safeMessage(code));
    }
    const content = record(candidate.content) ? candidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .filter((p) => record(p) && typeof p.text === 'string' && p.thought !== true)
      .map((p) => (p as Record<string, unknown>).text)
      .join('');
    let output: unknown;
    try {
      output = JSON.parse(text);
    } catch {
      throw new AIProviderError(this.name, 'invalid_response', safeMessage('invalid_response'));
    }
    if (findSchemaViolation(GOAL_MATCH_OUTPUT_SCHEMA, output) !== null)
      throw new AIProviderError(this.name, 'invalid_response', safeMessage('invalid_response'));
    // Every return is still validated semantically by GoalMatchService before cache/reconciliation.
    return output as GoalMatchAiOutput;
  }
}
