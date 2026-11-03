import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { NutritionTargetsController } from './nutrition-targets.controller';
import { NutritionTargetsService } from './nutrition-targets.service';

@Module({
  imports: [ProfileModule],
  controllers: [NutritionTargetsController],
  providers: [NutritionTargetsService],
  exports: [NutritionTargetsService],
})
export class NutritionTargetsModule {}
