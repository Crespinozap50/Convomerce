import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// Mirrors ConversationInactivityService's interval-poll shape: a single
// cross-tenant security-definer sweep (app.purge_old_messages, see 065),
// called from commerce_runtime with no per-tenant app.tenant_id context
// needed. Runs hourly rather than every minute — purging is not time-
// sensitive down to the minute the way inactivity closing is.
@Injectable()
export class MessageRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessageRetentionService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly database: DatabaseService) {}
  onApplicationBootstrap() {
    void this.advance();
    this.timer = setInterval(() => void this.advance(), 3_600_000);
    this.timer.unref();
  }
  private async advance() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.database.withRuntimeTransaction((client) =>
        client.query<{ purged: number }>('select * from app.purge_old_messages()'),
      );
      const purged = result.rows[0]?.purged ?? 0;
      if (purged) this.logger.log({ event: 'messages_purged_for_retention', purged });
    } catch (error) {
      this.logger.error('Could not purge old messages', error);
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
