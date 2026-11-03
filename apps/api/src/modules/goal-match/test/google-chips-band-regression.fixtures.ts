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
        "text": "The product is ultra-processed"
      },
      {
        "code": "high_salt",
        "direction": "negative",
        "impact": "medium",
        "facts": [
          "product.per100.saltG",
          "facts.levels.salt"
        ],
        "text": "Moderate to high salt content"
      },
      {
        "code": "fits_portion",
        "direction": "positive",
        "impact": "low",
        "facts": [
          "facts.share.dailyKcalPct"
        ],
        "text": "A serving is 8% of daily calories"
      }
    ],
    "summary": "An ultra-processed product high in fat and salt.",
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
        "text": "Ultra-processed product"
      },
      {
        "code": "high_salt",
        "direction": "negative",
        "impact": "medium",
        "facts": [
          "product.per100.saltG",
          "facts.levels.salt"
        ],
        "text": "Moderate amount of salt (1.4 g per 100 g)"
      },
      {
        "code": "fits_portion",
        "direction": "positive",
        "impact": "low",
        "facts": [
          "facts.share.dailyKcalPct"
        ],
        "text": "A serving is 8% of daily calories"
      }
    ],
    "summary": "The product is ultra-processed, high in fat and moderate in salt.",
    "warnings": []
  }
];
