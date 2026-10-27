import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export interface DatabaseClientOptions {
  readonly connectionString: string;
}

/** Создаёт Prisma Client для PostgreSQL. Подключение устанавливается при первом запросе. */
export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = PrismaClient;
