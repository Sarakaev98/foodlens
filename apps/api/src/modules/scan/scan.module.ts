import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

@Module({
  imports: [AiModule],
  controllers: [ScanController],
  providers: [ScanService],
})
export class ScanModule {}
