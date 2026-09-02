import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { SecretsModule } from './secrets/secrets.module';
import { InboundMessagesModule } from './inbound-messages/inbound-messages.module';
import { OutboxModule } from './outbox/outbox.module';
import { CommerceEventsModule } from './commerce-events/commerce-events.module';
import { WhatsAppWebhookModule } from './whatsapp-webhook/whatsapp-webhook.module';
import { OutboundMessagesModule } from './outbound-messages/outbound-messages.module';
import { DeliveryStatusesModule } from './delivery-statuses/delivery-statuses.module';
import { validateEnvironment } from './config/environment.validation';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './observability/correlation.middleware';
import { HttpErrorFilter } from './observability/http-error.filter';
import { RequestLoggingInterceptor } from './observability/request-logging.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { PublicInfoModule } from './public-info/public-info.module';
import { ChannelConnectionsModule } from './channel-connections/channel-connections.module';
import { AuthModule } from './auth/auth.module';
import { TenantUsersModule } from './tenant-users/tenant-users.module';
import { PlatformTenantsModule } from './platform-tenants/platform-tenants.module';
import { BotConfigModule } from './bot-config/bot-config.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CommercialRequestsModule } from './commercial-requests/commercial-requests.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { OperationalRequirementsModule } from './operational-requirements/operational-requirements.module';
import { ModifierGroupsModule } from './modifier-groups/modifier-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    SecretsModule,
    InboundMessagesModule,
    OutboxModule,
    CommerceEventsModule,
    WhatsAppWebhookModule,
    OutboundMessagesModule,
    DeliveryStatusesModule,
    HealthModule,
    MetricsModule,
    PublicInfoModule,
    AuthModule,
    TenantUsersModule,
    ChannelConnectionsModule,
    PlatformTenantsModule,
    BotConfigModule,
    KnowledgeModule,
    ConversationsModule,
    CommercialRequestsModule,
    SchedulingModule,
    OperationalRequirementsModule,
    ModifierGroupsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
