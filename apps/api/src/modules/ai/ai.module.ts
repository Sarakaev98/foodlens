import { GoogleNutritionSearch } from '@foodlens/ai';
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { createAIProvider, createGoogleTextAI } from './ai-provider.factory';
import { PRODUCT_TEXT_AI, createProductTextAI } from './product-ai-support.factory';
import { AI_PROVIDER } from './ai.tokens';

@Module({
  providers: [{ provide: PRODUCT_TEXT_AI, useFactory: createProductTextAI, inject: [APP_CONFIG] }, { provide: AI_PROVIDER, useFactory: createAIProvider, inject: [APP_CONFIG] }, { provide: GoogleNutritionSearch, useFactory: createGoogleTextAI, inject: [APP_CONFIG] }],
  exports: [AI_PROVIDER, GoogleNutritionSearch, PRODUCT_TEXT_AI],
})
export class AiModule {}
