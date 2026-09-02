import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// Mirrors OperationalLifecycleService's interval-poll shape: a single
// cross-tenant security-definer sweep (app.close_inactive_conversations, see
// 059), called from commerce_runtime with no per-tenant app.tenant_id
// context needed.
@Injectable()
export class ConversationInactivityService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConversationInactivityService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly database: DatabaseService) {}
  onApplicationBootstrap() {
    void this.advance();
    this.timer = setInterval(() => void this.advance(), 60_000);
    this.timer.unref();
  }
  private async advance() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.database.withRuntimeTransaction((client) =>
        client.query<{ closed: number; warned: number }>(
          'select * from app.close_inactive_conversations()',
        ),
      );
      const closed = result.rows[0]?.closed ?? 0;
      const warned = result.rows[0]?.warned ?? 0;
      if (closed || warned)
        this.logger.log({ event: 'conversations_closed_for_inactivity', closed, warned });
    } catch (error) {
      this.logger.error('Could not close inactive conversations', error);
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
