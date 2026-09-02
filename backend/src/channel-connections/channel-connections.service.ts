import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { forbidden, unprocessable, badRequest, conflict } from '../observability/http-errors';
import { SECRET_PROVIDER, SecretProvider } from '../secrets/secret-provider';
import { CredentialEncryptionService } from '../secrets/credential-encryption.service';

export interface ConnectMetaChannelCommand {
  tenantId: string;
  actorUserId: string;
  channelId: string;
  phoneNumberId: string;
  wabaId: string;
  providerAppId?: string;
  // Plain-text WhatsApp access token pasted by the admin. Omit to keep the
  // token already on file (e.g. when only Phone Number ID/WABA ID change) —
  // connect() resolves that case by reusing the currently stored, already
  // encrypted value, so the admin never has to re-paste it on every edit.
  accessToken?: string;
}

export interface ChannelConnectionView {
  id: string | null;
  channelId: string;
  provider: string;
  phoneNumberId: string;
  externalAddress: string;
  wabaId: string | null;
  providerAppId: string | null;
  status: string;
  secretConfigured: boolean;
  tokenExpiresAt: Date | null;
  lastValidatedAt: Date | null;
  lastErrorCode: string | null;
  configurationVersion: number;
}

@Injectable()
export class ChannelConnectionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    @Inject(SECRET_PROVIDER) private readonly secrets: SecretProvider,
    private readonly credentials: CredentialEncryptionService,
  ) {}

  async list(tenantId: string, actorUserId: string): Promise<{
    canManage: boolean; webhookPath: string; connections: ChannelConnectionView[];
  }> {
    return this.database.withTenantTransaction(tenantId, async (client) => {
      const access = await client.query<{ can_manage: boolean; is_member: boolean }>(
        `select app.can_manage_channel_connections($1) as can_manage,
                exists (select 1 from app.tenant_users
                         where tenant_id = app.current_tenant_id() and user_id = $1
                           and status = 'active') as is_member`,
        [actorUserId],
      );
      const canManage = access.rows[0]?.can_manage === true;
      if (!canManage && !access.rows[0]?.is_member) {
        throw forbidden('CHANNEL_CONNECTIONS_FORBIDDEN', 'Actor is not authorized to view connections');
      }
      const result = await client.query<{
        id: string | null; channel_id: string; phone_number_id: string; external_address: string;
        external_business_account_id: string | null; provider_app_id: string | null;
        status: string; secret_reference: string; token_expires_at: Date | null;
        last_validated_at: Date | null; last_error_code: string | null; configuration_version: number;
      }>(
        `select connection.id, channel.id as channel_id,
                channel.external_account_id as phone_number_id, channel.external_address,
                connection.external_business_account_id, connection.provider_app_id,
                coalesce(connection.status, 'pending') as status, channel.secret_reference,
                connection.token_expires_at, connection.last_validated_at,
                connection.last_error_code, coalesce(connection.configuration_version, 1) as configuration_version
           from app.channels channel
           left join app.channel_connections connection
             on connection.tenant_id = channel.tenant_id and connection.channel_id = channel.id
          where channel.provider = 'whatsapp_cloud'
          order by channel.created_at`,
      );
      return {
        canManage,
        webhookPath: '/v1/webhooks/whatsapp',
        connections: result.rows.map((row) => ({
          id: row.id, channelId: row.channel_id, provider: 'meta_whatsapp',
          phoneNumberId: row.phone_number_id, externalAddress: row.external_address,
          wabaId: row.external_business_account_id, providerAppId: row.provider_app_id,
          status: row.status, secretConfigured: Boolean(row.secret_reference),
          tokenExpiresAt: row.token_expires_at, lastValidatedAt: row.last_validated_at,
          lastErrorCode: row.last_error_code, configurationVersion: row.configuration_version,
        })),
      };
    });
  }

  async connect(command: ConnectMetaChannelCommand): Promise<{ connectionId: string }> {
    return this.database.withTenantTransaction(command.tenantId, async (client) => {
      const encryptedSecret = command.accessToken
        ? this.credentials.encrypt(command.accessToken)
        : await this.existingSecret(client, command.channelId);
      if (!encryptedSecret) {
        throw badRequest(
          'CHANNEL_ACCESS_TOKEN_REQUIRED',
          'An access token is required to connect this channel for the first time',
        );
      }
      try {
        const result = await client.query<{ connection_id: string }>(
          `select app.configure_channel_connection($1,$2,$3,$4,$5,$6,$7,$8) as connection_id`,
          [command.actorUserId, uuidv7(), command.channelId, command.phoneNumberId,
            command.wabaId, command.providerAppId ?? null, encryptedSecret, uuidv7()],
        );
        return { connectionId: result.rows[0].connection_id };
      } catch (error) {
        // channels_provider_external_account_uidx is global (provider,
        // external_account_id), not per-tenant — a Phone Number ID already
        // configured for another business hits this instead of the
        // per-tenant checks in configure_channel_connection().
        if (isPgCode(error, '23505')) {
          throw conflict(
            'CHANNEL_PHONE_NUMBER_ID_IN_USE',
            'This Phone Number ID is already connected to another business on the platform',
          );
        }
        throw error;
      }
    });
  }

  // The stored value is already encrypted — reused as-is, never decrypted
  // and re-encrypted, so this never needs to touch the plaintext token.
  private async existingSecret(client: PoolClient, channelId: string): Promise<string | null> {
    const result = await client.query<{ secret_reference: string | null }>(
      `select secret_reference from app.channels where id = $1`,
      [channelId],
    );
    return result.rows[0]?.secret_reference ?? null;
  }

  async validate(tenantId: string, actorUserId: string, connectionId: string): Promise<{ connected: true }> {
    const connection = await this.database.withTenantTransaction(tenantId, async (client) => {
      const authorized = await client.query<{ allowed: boolean }>(
        'select app.can_manage_channel_connections($1) as allowed', [actorUserId],
      );
      if (!authorized.rows[0]?.allowed) {
        throw forbidden('CHANNEL_CONNECTIONS_FORBIDDEN', 'Actor is not authorized to validate connections');
      }
      const result = await client.query<{ phone_number_id: string; secret_reference: string }>(
        `select channel.external_account_id as phone_number_id, connection.secret_reference
           from app.channel_connections connection join app.channels channel
             on channel.tenant_id = connection.tenant_id and channel.id = connection.channel_id
          where connection.id = $1`, [connectionId],
      );
      if (!result.rows[0]) throw unprocessable('CHANNEL_CONNECTION_NOT_FOUND', 'Connection was not found');
      return result.rows[0];
    });

    let errorCode: string | null = null;
    try {
      const token = this.secrets.resolve(connection.secret_reference);
      const version = this.config.get<string>('WHATSAPP_GRAPH_API_VERSION', 'v26.0');
      const response = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(connection.phone_number_id)}?fields=id,display_phone_number,verified_name`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) errorCode = `META_HTTP_${response.status}`;
    } catch (error) {
      errorCode = error instanceof Error && error.message.includes('authorized token')
        ? 'SECRET_NOT_AVAILABLE' : 'META_UNAVAILABLE';
    }
    await this.database.withTenantTransaction(tenantId, async (client) => {
      await client.query('select app.record_channel_connection_validation($1,$2,$3,$4)',
        [actorUserId, connectionId, errorCode === null, errorCode]);
    });
    if (errorCode) throw unprocessable('CHANNEL_CONNECTION_TEST_FAILED', `Connection validation failed: ${errorCode}`);
    return { connected: true };
  }

  async disconnect(tenantId: string, actorUserId: string, connectionId: string): Promise<boolean> {
    return this.database.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ disconnected: boolean }>(
        'select app.disconnect_channel_connection($1,$2,$3) as disconnected',
        [actorUserId, connectionId, uuidv7()],
      );
      return result.rows[0].disconnected;
    });
  }
}

function isPgCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code;
}
