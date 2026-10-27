import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import { createAIProvider } from './ai-provider.factory';
import { AI_PROVIDER } from './ai.tokens';

@Module({
  providers: [{ provide: AI_PROVIDER, useFactory: createAIProvider, inject: [APP_CONFIG] }],
  exports: [AI_PROVIDER],
})
export class AiModule {}
