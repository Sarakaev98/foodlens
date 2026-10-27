import { Inject, Injectable } from '@nestjs/common';
import type { FeatureFlag, FeatureFlags } from '@foodlens/core';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  getAll(): FeatureFlags {
    return this.config.featureFlags;
  }

  isEnabled(flag: FeatureFlag): boolean {
    return this.config.featureFlags[flag];
  }
}
