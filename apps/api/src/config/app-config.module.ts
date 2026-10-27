import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './app-config';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class AppConfigModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
