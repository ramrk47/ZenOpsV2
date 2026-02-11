import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './common/health.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { DomainController } from './domain/domain.controller.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { PrismaService } from './db/prisma.service.js';
import { RequestContextService } from './db/request-context.service.js';
import { DomainService } from './domain/domain.service.js';
import { ReportQueueService } from './queue/report-queue.service.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';

@Module({
  controllers: [HealthController, AuthController, DomainController],
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService(process.env.DATABASE_URL_API ?? process.env.DATABASE_URL ?? '')
    },
    {
      provide: ReportQueueService,
      useFactory: () =>
        new ReportQueueService(
          process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          process.env.DISABLE_QUEUE === 'true'
        )
    },
    {
      provide: 'JWT_SECRET_VALUE',
      useFactory: () => process.env.JWT_SECRET ?? 'dev-secret'
    },
    RequestContextService,
    DomainService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
