import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, createPrismaClient } from '@zenops/db';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(databaseUrl: string) {
    this.client = createPrismaClient(databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
