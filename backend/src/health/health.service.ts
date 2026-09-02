import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DatabaseService } from '../database/database.service';
import { CommerceEventsWorker } from '../commerce-events/commerce-events.worker';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly database: DatabaseService,
    private readonly outboxPublisher: OutboxPublisherService,
    private readonly commerceWorker: CommerceEventsWorker,
    config: ConfigService,
  ) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 56379),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    });
    this.redis.on('error', () => undefined);
  }

  async readiness(): Promise<{
    status: 'ready';
    checks: {
      postgres: 'up';
      redis: 'up';
      outboxPublisher: 'up' | 'disabled';
      commerceWorker: 'up' | 'disabled';
    };
  }> {
    await this.database.ping();
    if (this.redis.status === 'wait') await this.redis.connect();
    if (await this.redis.ping() !== 'PONG') throw new Error('Redis did not respond with PONG');
    const [outboxPublisher, commerceWorker] = await Promise.all([
      this.outboxPublisher.readiness(),
      this.commerceWorker.readiness(),
    ]);
    return {
      status: 'ready',
      checks: { postgres: 'up', redis: 'up', outboxPublisher, commerceWorker },
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
