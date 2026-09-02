import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { DatabaseService } from '../database/database.service';

export interface OperationalSnapshot {
  outboxPending: number;
  outboxExpiredLeases: number;
  bullmqFailed: number;
}

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly contentType: string;
  private readonly registry = new Registry();
  private readonly webhookRequests: Counter;
  private readonly httpDuration: Histogram;
  private readonly outboxPending: Gauge;
  private readonly outboxExpiredLeases: Gauge;
  private readonly bullmqFailed: Gauge;
  private readonly queue: Queue;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.contentType = this.registry.contentType;
    this.webhookRequests = new Counter({
      name: 'commerce_webhook_requests_total',
      help: 'Webhook requests grouped by safe outcome',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'commerce_http_request_duration_seconds',
      help: 'HTTP duration without query strings or business identifiers',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({
      name: 'commerce_outbox_pending', help: 'Outbox events ready to publish', registers: [this.registry],
    });
    this.outboxExpiredLeases = new Gauge({
      name: 'commerce_outbox_expired_leases', help: 'Outbox events with expired leases', registers: [this.registry],
    });
    this.bullmqFailed = new Gauge({
      name: 'commerce_bullmq_failed_jobs', help: 'Trabajos fallidos retenidos en BullMQ', registers: [this.registry],
    });
    this.queue = new Queue('commerce-events', {
      connection: {
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: config.get<number>('REDIS_PORT', 56379),
        maxRetriesPerRequest: null,
      },
    });
  }

  recordWebhook(result: 'accepted' | 'rejected_signature' | 'rejected_payload'): void {
    this.webhookRequests.inc({ result });
  }

  observeHttp(method: string, path: string, status: number, durationMs: number): void {
    this.httpDuration.observe({ method, path, status: String(status) }, durationMs / 1000);
  }

  async snapshot(): Promise<OperationalSnapshot> {
    const [outbox, counts] = await Promise.all([
      this.database.outboxMetrics(),
      this.queue.getJobCounts('failed'),
    ]);
    const snapshot = {
      outboxPending: outbox.pending,
      outboxExpiredLeases: outbox.expiredLeases,
      bullmqFailed: counts.failed,
    };
    this.outboxPending.set(snapshot.outboxPending);
    this.outboxExpiredLeases.set(snapshot.outboxExpiredLeases);
    this.bullmqFailed.set(snapshot.bullmqFailed);
    return snapshot;
  }

  async prometheus(): Promise<string> {
    await this.snapshot();
    return this.registry.metrics();
  }

  thresholds(snapshot: OperationalSnapshot) {
    const thresholds = {
      outboxPending: this.config.get<number>('OUTBOX_PENDING_WARNING', 100),
      outboxExpiredLeases: this.config.get<number>('OUTBOX_EXPIRED_LEASE_WARNING', 1),
      bullmqFailed: this.config.get<number>('BULLMQ_FAILED_WARNING', 1),
    };
    return {
      status: Object.entries(snapshot).some(([key, value]) =>
        value >= thresholds[key as keyof typeof thresholds]) ? 'warning' : 'ok',
      values: snapshot,
      thresholds,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
