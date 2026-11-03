import type { GoalMatchAiOutput } from '@foodlens/core';

/** Exact two captured Gemini responses before prompt v2; test data only. */
export const CHIPS_PRE_PROMPT_V2_RESPONSES: readonly GoalMatchAiOutput[] = [
  {
    "version": "goal-match-ai-v1",
    "band": "poor_fit",
    "score": 4,
    "confidence": "high",
    "dimensions": {
      "nutrientDensity": "negative",
      "processing": "strong_negative",
      "sugar": "positive",
      "fatQuality": "positive",
      "sodium": "negative",
      "portion": "positive"
    },
    "factors": [
      {
        "code": "ultra_processed",
        "direction": "negative",
        "impact": "high",
        "facts": [
          "semantics.processing.value"
        ],
        "text": "Продукт является ультрапереработанным"
      },
      {
        "code": "high_salt",
        "direction": "negative",
        "impact": "medium",
        "facts": [
          "product.per100.saltG",
          "facts.levels.salt"
        ],
        "text": "Умеренное или повышенное содержание соли"
      },
      {
        "code": "fits_portion",
        "direction": "positive",
        "impact": "low",
        "facts": [
          "facts.share.dailyKcalPct"
        ],
        "text": "Порция составляет 8% от суточных калорий"
      }
    ],
    "summary": "Ультрапереработанный продукт с высоким содержанием жиров и соли.",
    "warnings": []
  },
  {
    "version": "goal-match-ai-v1",
    "band": "poor_fit",
    "score": 4,
    "confidence": "high",
    "dimensions": {
      "nutrientDensity": "negative",
      "processing": "strong_negative",
      "sugar": "neutral",
      "fatQuality": "negative",
      "sodium": "negative",
      "portion": "positive"
    },
    "factors": [
      {
        "code": "ultra_processed",
        "direction": "negative",
        "impact": "high",
        "facts": [
          "semantics.processing.value"
        ],
        "text": "Продукт ультрапереработан"
      },
      {
        "code": "high_salt",
        "direction": "negative",
        "impact": "medium",
        "facts": [
          "product.per100.saltG",
          "facts.levels.salt"
        ],
        "text": "Умеренное количество соли (1.4 г на 100 г)"
      },
      {
        "code": "fits_portion",
        "direction": "positive",
        "impact": "low",
        "facts": [
          "facts.share.dailyKcalPct"
        ],
        "text": "Порция составляет 8% от суточных калорий"
      }
    ],
    "summary": "Продукт является ультрапереработанным с высоким содержанием жиров и умеренным количеством соли.",
    "warnings": []
  }
];
