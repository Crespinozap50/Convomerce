import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';

interface ClaimedEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly queue: Queue;
  private timer?: NodeJS.Timeout;
  private publishing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.queue = new Queue('commerce-events', {
      connection: {
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: config.get<number>('REDIS_PORT', 56379),
        maxRetriesPerRequest: null,
      },
    });
  }

  onApplicationBootstrap(): void {
    if (this.config.get<string>('OUTBOX_PUBLISHER_ENABLED', 'true') !== 'true') return;
    const interval = this.config.get<number>('OUTBOX_POLL_INTERVAL_MS', 1000);
    this.timer = setInterval(() => void this.publishBatch(), interval);
    this.timer.unref();
  }

  async publishBatch(): Promise<number> {
    if (this.publishing) return 0;
    this.publishing = true;
    try {
      const events = await this.claimBatch();
      let published = 0;
      for (const event of events) {
        try {
          await this.queue.add(event.event_type, {
            eventId: event.id,
            tenantId: event.tenant_id,
            ...event.payload,
          }, {
            jobId: event.id,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: false,
          });
          await this.markPublished(event.id);
          published += 1;
        } catch (error) {
          await this.releaseClaim(event.id);
          this.logger.error(`No se pudo publicar outbox ${event.id}`, error);
        }
      }
      return published;
    } finally {
      this.publishing = false;
    }
  }

  async readiness(): Promise<'up' | 'disabled'> {
    if (this.config.get<string>('OUTBOX_PUBLISHER_ENABLED', 'true') !== 'true') return 'disabled';
    if (!this.timer) throw new Error('Outbox publisher was not started');
    await this.queue.waitUntilReady();
    return 'up';
  }

  private claimBatch(): Promise<ClaimedEvent[]> {
    const batchSize = this.config.get<number>('OUTBOX_BATCH_SIZE', 20);
    return this.database.withOutboxTransaction(async (client) => {
      const result = await client.query<ClaimedEvent>(
        `with candidates as (
           select id from app.outbox_events
           where (status = 'pending' or (status = 'publishing' and lease_expires_at < now()))
             and available_at <= now()
           order by available_at, created_at
           for update skip locked
           limit $1
         )
         update app.outbox_events event
         set status = 'publishing', lease_expires_at = now() + interval '30 seconds',
             attempt_count = attempt_count + 1
         from candidates
         where event.id = candidates.id
         returning event.id, event.tenant_id, event.event_type, event.payload`,
        [batchSize],
      );
      return result.rows;
    });
  }

  private async markPublished(id: string): Promise<void> {
    await this.database.withOutboxTransaction(async (client) => {
      await client.query(
        `update app.outbox_events
         set status = 'published', published_at = now(), lease_expires_at = null
         where id = $1 and status = 'publishing'`,
        [id],
      );
    });
  }

  private async releaseClaim(id: string): Promise<void> {
    await this.database.withOutboxTransaction(async (client) => {
      await client.query(
        `update app.outbox_events
         set status = 'pending', lease_expires_at = null, last_error_code = 'bullmq_publish_failed'
         where id = $1 and status = 'publishing'`,
        [id],
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue.close();
  }
}
