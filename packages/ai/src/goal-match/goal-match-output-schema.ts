import { GOAL_MATCH_AI_BANDS, GOAL_MATCH_AI_DIMENSIONS, GOAL_MATCH_AI_DIMENSION_VALUES,
  GOAL_MATCH_AI_FACTOR_CODES, GOAL_MATCH_AI_WARNINGS } from '@foodlens/core';
import { objectSchema, enumSchema, type JsonSchema } from '../json-schema/json-schema';

/** Same GoalMatchAiOutput contract for every evaluator; semantic checks remain in scoring. */
export const GOAL_MATCH_OUTPUT_SCHEMA: JsonSchema = objectSchema({
  version: enumSchema(['goal-match-ai-v1']),
  band: enumSchema(GOAL_MATCH_AI_BANDS),
  score: { type:'number', description:'0–10, steps of 0.5, consistent with band' },
  confidence: enumSchema(['high','medium','low']),
  dimensions: objectSchema(Object.fromEntries(GOAL_MATCH_AI_DIMENSIONS.map(k=>[k,enumSchema(GOAL_MATCH_AI_DIMENSION_VALUES)]))),
  factors: { type:'array',items:objectSchema({
    code:enumSchema(GOAL_MATCH_AI_FACTOR_CODES), direction:enumSchema(['positive','negative']),
    impact:enumSchema(['high','medium','low']), facts:{type:'array',items:{type:'string'}},
    text:{type:'string',description:'English, at most 90 characters; only supported facts'},
  }) },
  summary:{type:'string',description:'One English sentence, at most 140 characters'},
  warnings:{type:'array',items:enumSchema(GOAL_MATCH_AI_WARNINGS)},
});

/** Vertex responseSchema supports a subset; do not send unsupported additionalProperties. */
export function vertexGoalMatchResponseSchema(): Record<string,unknown> {
  function convert(schema:JsonSchema,path=''):Record<string,unknown>{
    if('anyOf' in schema)return {anyOf:schema.anyOf.map(s=>convert(s,path))};
    const out:Record<string,unknown>={type:schema.type.toUpperCase()};
    if('description' in schema)out.description=schema.description;
    if(schema.type==='string' && schema.enum)out.enum=schema.enum;
    if(schema.type==='object'){
      out.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,convert(v,path?path+'.'+k:k)]));
      out.required=schema.required;out.propertyOrdering=Object.keys(schema.properties);
    }
    if(schema.type==='array'){
      out.items=convert(schema.items,path+'[]');
      if(path==='factors'){out.minItems=1;out.maxItems=4;}
      if(path==='factors[].facts'){out.minItems=1;out.maxItems=3;}
    }
    if(path==='score'){out.minimum=0;out.maximum=10;}
    return out;
  }
  return convert(GOAL_MATCH_OUTPUT_SCHEMA);
}
