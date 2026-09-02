import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { hashSessionToken } from './session-cookie';
import { badRequest, unauthorized } from '../observability/http-errors';

interface LoginRecord {
  user_id: string;
  password_hash: string;
  must_change_password: boolean;
  locked_until: Date | null;
}

interface SessionRecord {
  user_id: string;
  session_id: string;
  expires_at: Date;
  must_change_password: boolean;
}

export interface UserContext {
  userId: string;
  email: string;
  displayName: string;
  uiLanguage: 'en' | 'es';
  mustChangePassword: boolean;
  platformRole: 'owner' | 'operator' | null;
  memberships: Array<{ tenantId: string; role: 'owner' | 'admin' | 'operator' | 'viewer' }>;
}

// Valid Argon2id hash used to equalize cost when the email does not exist.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$NgJmJmX9A2dcOTxG8Uc7rg$LxWgIujor6bP10Anph87TTwh4GI3i3PsqEtLpp3u1jo';

@Injectable()
export class LocalAuthService {
  private readonly sessionTtlHours: number;

  constructor(private readonly database: DatabaseService, config: ConfigService) {
    this.sessionTtlHours = config.get<number>('SESSION_TTL_HOURS') ?? 8;
  }

  async login(email: string, password: string, sourceIp: string | null, userAgent: string): Promise<{
    token: string; expiresAt: Date; mustChangePassword: boolean;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<LoginRecord>('select * from app.get_local_login($1)', [normalizedEmail]);
      return result.rows[0];
    });
    const locked = record?.locked_until && record.locked_until > new Date();
    const valid = await argon2.verify(record?.password_hash ?? DUMMY_HASH, password).catch(() => false);
    const succeeded = Boolean(record && !locked && valid);
    await this.database.withRuntimeTransaction(async (client) => {
      await client.query('select app.record_local_login($1,$2,$3,$4,$5,$6)', [
        uuidv7(), normalizedEmail, record?.user_id ?? null, succeeded, sourceIp, userAgent,
      ]);
    });
    if (!succeeded || !record) throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    return this.database.withRuntimeTransaction(async (client) => {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1000);
      await client.query('select app.create_local_session($1,$2,$3,$4)', [
        uuidv7(), record.user_id, hashSessionToken(token), expiresAt,
      ]);
      return { token, expiresAt, mustChangePassword: record.must_change_password };
    });
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    return this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<SessionRecord>(
        'select * from app.resolve_local_session($1)', [hashSessionToken(token)],
      );
      return result.rows[0] ?? null;
    });
  }

  async logout(token: string): Promise<void> {
    await this.database.withRuntimeTransaction(async (client) => {
      await client.query('select app.revoke_local_session($1)', [hashSessionToken(token)]);
    });
  }

  async userContext(userId: string): Promise<UserContext | null> {
    return this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<{ context: UserContext | null }>(
        'select app.get_local_user_context($1) as context', [userId],
      );
      return result.rows[0]?.context ?? null;
    });
  }

  async changePassword(
    userId: string, sessionId: string, currentPassword: string, newPassword: string,
  ): Promise<void> {
    const context = await this.userContext(userId);
    if (!context) throw unauthorized('AUTH_SESSION_INVALID', 'Invalid session');
    const record = await this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<LoginRecord>(
        'select * from app.get_local_login($1)', [context.email],
      );
      return result.rows[0];
    });
    const currentValid = record && await argon2.verify(record.password_hash, currentPassword).catch(() => false);
    if (!currentValid || !record) throw unauthorized('AUTH_CURRENT_PASSWORD_INVALID', 'Invalid current password');
    if (currentPassword === newPassword) {
      throw badRequest('AUTH_PASSWORD_REUSED', 'The new password must be different');
    }
    const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const changed = await this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<{ changed: boolean }>(
        'select app.change_local_password($1,$2,$3,$4) as changed',
        [userId, sessionId, record.password_hash, newHash],
      );
      return result.rows[0]?.changed ?? false;
    });
    if (!changed) throw unauthorized('AUTH_PASSWORD_CHANGED', 'The password changed during the operation');
  }

  async updateInterfaceLocale(userId: string, sessionId: string, locale: 'en' | 'es'): Promise<void> {
    const updated = await this.database.withRuntimeTransaction(async (client) => {
      const result = await client.query<{ updated: boolean }>(
        'select app.update_user_interface_locale($1,$2,$3) as updated', [userId, sessionId, locale],
      );
      return result.rows[0]?.updated ?? false;
    });
    if (!updated) throw unauthorized('AUTH_SESSION_INVALID', 'Invalid session');
  }
}
