import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './common/health.controller.js';
import { MetaController } from './common/meta.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { DomainController } from './domain/domain.controller.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { PrismaService } from './db/prisma.service.js';
import { RequestContextService } from './db/request-context.service.js';
import { DomainService } from './domain/domain.service.js';
import { ReportQueueService } from './queue/report-queue.service.js';
import { RepogenQueueService } from './queue/repogen-queue.service.js';
import { AssignmentSignalsQueueService } from './queue/assignment-signals-queue.service.js';
import { RepogenComputeSnapshotQueueService } from './queue/repogen-compute-queue.service.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { loadLaunchModeConfig } from './common/launch-mode.js';
import { loadEnv } from '@zenops/config';
import { LocalDiskProvider, S3CompatibleProvider } from '@zenops/storage';
import { BillingService } from './billing/billing.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationQueueService } from './notifications/notification-queue.service.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { ControlController } from './control/control.controller.js';
import { BillingControlController } from './billing-control/billing-control.controller.js';
import { ServiceInvoicesController } from './billing-control/service-invoices.controller.js';
import { BillingControlService } from './billing-control/billing-control.service.js';
import { PaymentWebhooksController } from './billing-control/payment-webhooks.controller.js';
import { PaymentsController } from './billing-control/payments.controller.js';
import { RepogenController } from './repogen/repogen.controller.js';
import { RepogenService } from './repogen/repogen.service.js';
import { RepogenSpineController } from './repogen/repogen-spine.controller.js';
import { RepogenSpineService } from './repogen/repogen-spine.service.js';
import { RepogenFactoryService } from './repogen/factory/repogen-factory.service.js';

@Module({
  controllers: [
    HealthController,
    MetaController,
    AuthController,
    DomainController,
    NotificationsController,
    ControlController,
    BillingControlController,
    ServiceInvoicesController,
    PaymentWebhooksController,
    PaymentsController,
    RepogenController,
    RepogenSpineController
  ],
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
      provide: RepogenQueueService,
      useFactory: () =>
        new RepogenQueueService(
          process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          process.env.DISABLE_QUEUE === 'true'
        )
    },
    {
      provide: RepogenComputeSnapshotQueueService,
      useFactory: () =>
        new RepogenComputeSnapshotQueueService(
          process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          process.env.DISABLE_QUEUE === 'true'
        )
    },
    {
      provide: AssignmentSignalsQueueService,
      useFactory: () =>
        new AssignmentSignalsQueueService(
          process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          process.env.DISABLE_QUEUE === 'true'
        )
    },
    {
      provide: 'JWT_SECRET_VALUE',
      useFactory: () => process.env.JWT_SECRET ?? 'dev-secret'
    },
    {
      provide: 'LAUNCH_MODE_CONFIG',
      useFactory: () => loadLaunchModeConfig(process.env)
    },
    {
      provide: 'STUDIO_ADMIN_TOKEN',
      useFactory: () => {
        const value = process.env.STUDIO_ADMIN_TOKEN?.trim();
        return value && value.length > 0 ? value : null;
      }
    },
    {
      provide: 'CONTROL_RATE_LIMIT_RPM',
      useFactory: () => {
        const value = Number.parseInt(process.env.CONTROL_RATE_LIMIT_RPM ?? '180', 10);
        return Number.isFinite(value) ? value : 180;
      }
    },
    {
      provide: 'STORAGE_PROVIDER',
      useFactory: () => {
        const env = loadEnv(process.env);
        if (env.STORAGE_DRIVER === 's3') {
          if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
            throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3');
          }
          return new S3CompatibleProvider({
            bucket: env.S3_BUCKET,
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: ['1', 'true', 'yes', 'on'].includes(env.S3_FORCE_PATH_STYLE.toLowerCase()),
            publicBaseUrl: env.S3_PUBLIC_BASE_URL
          });
        }

        return new LocalDiskProvider({
          rootDir: `${env.ARTIFACTS_DIR}/objects`,
          baseUrl: `http://localhost:${env.API_PORT}/local-storage`
        });
      }
    },
    {
      provide: NotificationQueueService,
      useFactory: () =>
        new NotificationQueueService(
          process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          process.env.DISABLE_QUEUE === 'true'
        )
    },
    RequestContextService,
    BillingService,
    BillingControlService,
    NotificationsService,
    DomainService,
    RepogenService,
    RepogenSpineService,
    RepogenFactoryService,
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
