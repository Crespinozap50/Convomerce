import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { hashSessionToken } from '../auth/session-cookie';
import { conflict, forbidden, unauthorized } from '../observability/http-errors';

export type TenantRole = 'owner' | 'admin' | 'operator' | 'viewer';

@Injectable()
export class TenantUsersService {
  private readonly exposeToken: boolean;

  constructor(private readonly database: DatabaseService, config: ConfigService) {
    this.exposeToken = config.get<string>('NODE_ENV') !== 'production';
  }

  async list(tenantId: string, actorUserId: string) {
    return this.database.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{
        membership_id: string; user_id: string; email: string;
        display_name: string; role: TenantRole; status: string;
      }>('select * from app.list_tenant_users($1)', [actorUserId]);
      return result.rows.map((row) => ({
        membershipId: row.membership_id, userId: row.user_id, email: row.email,
        displayName: row.display_name, role: row.role, status: row.status,
      }));
    }).catch((error: unknown) => {
      if (isPgCode(error, '42501')) throw forbidden('TENANT_USERS_FORBIDDEN', 'You cannot manage users for this tenant');
      throw error;
    });
  }

  async invite(tenantId: string, actorUserId: string, email: string, role: TenantRole) {
    const token = randomBytes(32).toString('base64url');
    const invitationId = uuidv7();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    try {
      await this.database.withTenantTransaction(tenantId, async (client) => {
        await client.query(
          'select app.create_tenant_user_invitation($1,$2,$3,$4,$5,$6,$7)',
          [invitationId, actorUserId, email, role, hashSessionToken(token), expiresAt, uuidv7()],
        );
      });
    } catch (error) {
      if (isPgCode(error, '42501')) throw forbidden('TENANT_USERS_FORBIDDEN', 'You cannot invite users to this tenant');
      if (isPgCode(error, '23505')) throw conflict('TENANT_INVITATION_DUPLICATE', 'An invitation or membership already exists for this email');
      throw error;
    }
    return { invitationId, expiresAt, invitationToken: this.exposeToken ? token : undefined };
  }

  async accept(token: string, displayName: string, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      return await this.database.withRuntimeTransaction(async (client) => {
        const result = await client.query<{ user_id: string; tenant_id: string }>(
          'select * from app.accept_tenant_user_invitation($1,$2,$3,$4,$5,$6)',
          [hashSessionToken(token), uuidv7(), uuidv7(), displayName, passwordHash, uuidv7()],
        );
        return { userId: result.rows[0].user_id, tenantId: result.rows[0].tenant_id, accepted: true };
      });
    } catch (error) {
      if (isPgCode(error, '28000')) throw unauthorized('TENANT_INVITATION_INVALID', 'Invalid or expired invitation');
      if (isPgCode(error, '23505')) throw conflict('TENANT_INVITATION_ACCEPTED', 'The invitation has already been accepted');
      throw error;
    }
  }

  async updateMembership(
    tenantId: string, actorUserId: string, membershipId: string,
    role: TenantRole, status: 'active' | 'disabled',
  ) {
    try {
      return await this.database.withTenantTransaction(tenantId, async (client) => {
        const result = await client.query<{ updated: boolean }>(
          'select app.update_tenant_membership($1,$2,$3,$4,$5) as updated',
          [actorUserId, membershipId, role, status, uuidv7()],
        );
        return { updated: result.rows[0].updated };
      });
    } catch (error) {
      if (isPgCode(error, '42501')) throw forbidden('TENANT_USERS_FORBIDDEN', 'You cannot manage this user');
      if (isPgCode(error, '23514')) throw conflict('TENANT_LAST_OWNER', 'The last active owner cannot be modified');
      throw error;
    }
  }

  async revokeInvitation(tenantId: string, actorUserId: string, invitationId: string) {
    return this.database.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ revoked: boolean }>(
        'select app.revoke_tenant_user_invitation($1,$2,$3) as revoked',
        [actorUserId, invitationId, uuidv7()],
      );
      return { revoked: result.rows[0].revoked };
    }).catch((error: unknown) => {
      if (isPgCode(error, '42501')) throw forbidden('TENANT_USERS_FORBIDDEN', 'You cannot revoke this invitation');
      throw error;
    });
  }
}

function isPgCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
