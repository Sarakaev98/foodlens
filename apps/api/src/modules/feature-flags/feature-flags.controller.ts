import { Controller, Get } from '@nestjs/common';
import type { FeatureFlags } from '@foodlens/core';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Get()
  getAll(): FeatureFlags {
    return this.featureFlags.getAll();
  }
}
