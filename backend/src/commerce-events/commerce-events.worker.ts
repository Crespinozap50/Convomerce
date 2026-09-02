import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { MessageReceivedEvent } from './commerce-event.types';
import { MessageReceivedConsumer } from './message-received.consumer';
import { SendRequestedConsumer, SendRequestedEvent } from './send-requested.consumer';
import { GoogleCalendarService } from '../scheduling/google-calendar.service';

@Injectable()
export class CommerceEventsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CommerceEventsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly consumer: MessageReceivedConsumer,
    private readonly sendRequested: SendRequestedConsumer,
    private readonly config: ConfigService,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('COMMERCE_WORKER_ENABLED', 'true') !== 'true') return;

    this.worker = new Worker(
      'commerce-events',
      (job) => this.process(job),
      {
        connection: {
          host: this.config.get<string>('REDIS_HOST', 'localhost'),
          port: this.config.get<number>('REDIS_PORT', 56379),
          maxRetriesPerRequest: null,
        },
        concurrency: this.config.get<number>('COMMERCE_WORKER_CONCURRENCY', 5),
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id ?? 'unknown'} failed`, error);
      const attempts = job?.opts.attempts ?? 1;
      if (job?.name === 'message.send_requested' && job.attemptsMade >= attempts) {
        const data = job.data as SendRequestedEvent;
        void this.sendRequested.markFailed(data,error).catch(markError =>
          this.logger.error(`Could not mark message ${data.messageId} as failed`,markError));
      }
    });
  }

  private async process(job: Job): Promise<{ duplicate: boolean }> {
    if (job.name.startsWith('appointment.')) {
      const data=job.data as Partial<{tenantId:string;appointmentId:string}>;
      if(!data.tenantId||!data.appointmentId)throw new UnrecoverableError(`Incomplete ${job.name} event`);
      const action=job.name.slice('appointment.'.length);
      if(!['confirmed','rescheduled','cancelled'].includes(action))throw new UnrecoverableError(`Unsupported event type: ${job.name}`);
      await this.googleCalendar.syncAppointment(data.tenantId,data.appointmentId,action as 'confirmed'|'rescheduled'|'cancelled');
      return { duplicate: false };
    }
    if (job.name !== 'message.received') {
      if (job.name === 'message.send_requested') {
        const data = job.data as Partial<{
          eventId: string;
          tenantId: string;
          messageId: string;
        }>;
        if (!data.eventId || !data.tenantId || !data.messageId) {
          throw new UnrecoverableError('Incomplete message.send_requested event');
        }
        return this.sendRequested.consume(data as {
          eventId: string;
          tenantId: string;
          messageId: string;
        });
      }
      throw new UnrecoverableError(`Unsupported event type: ${job.name}`);
    }
    const data = job.data as Partial<MessageReceivedEvent>;
    if (!data.eventId || !data.tenantId || !data.messageId || !data.conversationId) {
      throw new UnrecoverableError('Incomplete message.received event');
    }
    return this.consumer.consume(data as MessageReceivedEvent);
  }

  async readiness(): Promise<'up' | 'disabled'> {
    if (this.config.get<string>('COMMERCE_WORKER_ENABLED', 'true') !== 'true') return 'disabled';
    if (!this.worker) throw new Error('Commerce worker was not started');
    await this.worker.waitUntilReady();
    return 'up';
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
