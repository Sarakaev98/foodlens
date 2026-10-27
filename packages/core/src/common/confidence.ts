import type { Brand } from './brand';

/** Уверенность в диапазоне [0, 1]. Создаётся только через toConfidence(). */
export type Confidence = Brand<number, 'Confidence'>;

export function toConfidence(value: number): Confidence {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Confidence must be within [0, 1], got ${value}`);
  }
  return value as Confidence;
}
