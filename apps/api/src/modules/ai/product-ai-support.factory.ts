import { FireworksProductTextAI, FireworksProductGoalMatch, GoogleNutritionSearch } from '@foodlens/ai';
import type { AppConfig } from '../../config/app-config';
import { createGoalMatchAIProvider, nestLogger } from './ai-provider.factory';

export const PRODUCT_TEXT_AI=Symbol('PRODUCT_TEXT_AI');
export const PRODUCT_GOAL_MATCH=Symbol('PRODUCT_GOAL_MATCH');
export const PRODUCT_INGREDIENTS_DISPLAY=Symbol('PRODUCT_INGREDIENTS_DISPLAY');
export function createProductTextAI(config:AppConfig):GoogleNutritionSearch{
 if(config.scanAi?.provider==='fireworks'){
  if(config.productLookup.webSearch==='gemini')throw new Error('Fireworks cannot use Google Search Grounding. Configure Tavily search to retain web discovery.');
  return new FireworksProductTextAI({apiKey:config.scanAi.fireworksApiKey,logger:nestLogger('FireworksProductText')});
 }
 return new GoogleNutritionSearch({...config.goalMatchAi.google,logger:nestLogger('GoogleNutritionText')});
}
export function createProductGoalMatchAI(config:AppConfig){
 return config.scanAi?.provider==='fireworks'&&config.goalMatchAi.mode==='google'
  ?new FireworksProductGoalMatch({apiKey:config.scanAi.fireworksApiKey,logger:nestLogger('FireworksProductGoalMatch')})
  :createGoalMatchAIProvider(config);
}
