import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({ connectionString, max: 10 });
    // An idle pool client that hits a network-level error (connection reset,
    // terminated by admin, etc.) emits 'error' on the Pool itself. Without a
    // listener, Node treats it as an unhandled event and crashes the whole
    // process instead of just discarding that one connection.
    this.pool.on('error', (error) =>
      this.logger.error('Idle Postgres client error', error),
    );
  }

  async withTenantTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role commerce_runtime');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveWhatsAppChannel(phoneNumberId: string): Promise<{
    tenantId: string;
    channelId: string;
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role commerce_runtime');
      const result = await client.query<{ tenant_id: string; channel_id: string }>(
        'select tenant_id, channel_id from app.resolve_whatsapp_channel($1)',
        [phoneNumberId],
      );
      await client.query('commit');
      if (result.rowCount === 0) return null;
      return { tenantId: result.rows[0].tenant_id, channelId: result.rows[0].channel_id };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async resolveAuthenticatedUser(issuer: string, subject: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role commerce_runtime');
      const result = await client.query<{ user_id: string | null }>(
        'select app.resolve_authenticated_user($1,$2) as user_id',
        [issuer, subject],
      );
      await client.query('commit');
      return result.rows[0]?.user_id ?? null;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async withRuntimeTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role commerce_runtime');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async outboxMetrics(): Promise<{ pending: number; expiredLeases: number }> {
    return this.withOutboxTransaction(async (client) => {
      const result = await client.query<{ pending: string; expired_leases: string }>(
        `select
           count(*) filter (where status = 'pending' and available_at <= now()) as pending,
           count(*) filter (
             where status = 'publishing' and lease_expires_at < now()
           ) as expired_leases
         from app.outbox_events`,
      );
      return {
        pending: Number(result.rows[0].pending),
        expiredLeases: Number(result.rows[0].expired_leases),
      };
    });
  }

  async withOutboxTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role commerce_outbox');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
