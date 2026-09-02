import { Module } from '@nestjs/common';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({ providers: [OutboxPublisherService], exports: [OutboxPublisherService] })
export class OutboxModule {}
