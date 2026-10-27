import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabaseClient, type DatabaseClient } from '@foodlens/database';
import type { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/app-config.module';
import { DATABASE_CLIENT } from './database.tokens';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: (config: AppConfig): DatabaseClient => createDatabaseClient({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [DATABASE_CLIENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
  }
}
