import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { createGoalMatchAIProvider } from '../ai/ai-provider.factory';
import { GoalMatchService } from './goal-match.service';

/** GOAL_MATCH_AI выбирает провайдера второго AI-вызова; при off сервис выключен и скан работает как раньше. */
@Module({
  providers: [{
    provide: GoalMatchService,
    useFactory: (config: AppConfig) => new GoalMatchService(createGoalMatchAIProvider(config)),
    inject: [APP_CONFIG],
  }],
  exports: [GoalMatchService],
})
export class GoalMatchModule {}
