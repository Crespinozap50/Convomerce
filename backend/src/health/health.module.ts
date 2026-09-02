import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { CommerceEventsModule } from '../commerce-events/commerce-events.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [CommerceEventsModule, OutboxModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
