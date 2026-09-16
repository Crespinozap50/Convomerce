import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import { CredentialEncryptionService } from "../secrets/credential-encryption.service";
import { badRequest, forbidden } from "../observability/http-errors";
import { LoggroApiClient, LoggroTable } from "./loggro-api-client.service";

export type LoggroConnectionView = {
  connected: boolean;
  status: string;
  secretConfigured: boolean;
  tableNamePattern: string | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
};

@Injectable()
export class LoggroConnectionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly credentials: CredentialEncryptionService,
    private readonly apiClient: LoggroApiClient,
  ) {}

  async status(tenantId: string, userId: string): Promise<LoggroConnectionView> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await this.assertManage(client, userId);
      const result = await client.query<{
        status: string;
        secret_reference: string | null;
        table_name_pattern: string | null;
        last_synced_at: Date | null;
        last_error_code: string | null;
      }>(
        `select status,secret_reference,table_name_pattern,last_synced_at,last_error_code
           from app.pos_connections where tenant_id=$1 and provider='loggro_restobar'`,
        [tenantId],
      );
      const row = result.rows[0];
      return {
        connected: row?.status === "connected",
        status: row?.status ?? "disconnected",
        secretConfigured: Boolean(row?.secret_reference),
        tableNamePattern: row?.table_name_pattern ?? null,
        lastSyncedAt: row?.last_synced_at ?? null,
        lastErrorCode: row?.last_error_code ?? null,
      };
    });
  }

  // password omitted keeps the already-stored (already-encrypted) secret —
  // same convention as ChannelConnectionsService.connect(), so re-saving
  // the connection to change something else never requires re-pasting the
  // password. Validates against the real Loggro login endpoint immediately
  // (outside any open DB transaction, same reasoning as
  // google-calendar.service.ts — never hold a transaction across an
  // external HTTP call).
  async connect(
    tenantId: string,
    userId: string,
    input: { email: string; password?: string },
  ): Promise<{ connectionId: string }> {
    const connectionId = await this.db.withTenantTransaction(tenantId, async (client) => {
      await this.assertManage(client, userId);
      const existing = await client.query<{ id: string; secret_reference: string | null }>(
        `select id,secret_reference from app.pos_connections where tenant_id=$1 and provider='loggro_restobar'`,
        [tenantId],
      );
      const secret = input.password
        ? this.credentials.encrypt(JSON.stringify({ email: input.email, password: input.password }))
        : existing.rows[0]?.secret_reference;
      if (!secret)
        throw badRequest(
          "LOGGRO_CREDENTIALS_REQUIRED",
          "Email and password are required to connect Loggro for the first time",
        );
      const id = existing.rows[0]?.id ?? uuidv7();
      if (existing.rows[0]) {
        await client.query(
          `update app.pos_connections set secret_reference=$2,status='disconnected',last_error_code=null,updated_at=now() where id=$1`,
          [id, secret],
        );
      } else {
        await client.query(
          `insert into app.pos_connections(id,tenant_id,provider,secret_reference,status) values($1,$2,'loggro_restobar',$3,'disconnected')`,
          [id, tenantId, secret],
        );
      }
      return id;
    });
    await this.apiClient.login(tenantId, connectionId);
    return { connectionId };
  }

  // D-194 (docs/decisions.md): the tenant no longer points at one fixed
  // table — it keeps a pool of real tables sharing a name prefix (e.g.
  // "Bot Convomerce 1", "Bot Convomerce 2", ...), and
  // LoggroOrderSyncService.resolveAvailableTable() re-resolves the actual
  // matching tables from the live account on every push, so a table added
  // later with the same prefix is picked up automatically — nothing here
  // stores table ids.
  async setTableNamePattern(
    tenantId: string,
    userId: string,
    pattern: string,
  ): Promise<{ tableNamePattern: string }> {
    await this.db.withTenantTransaction(tenantId, async (client) => {
      await this.assertManage(client, userId);
      const result = await client.query(
        `update app.pos_connections set table_name_pattern=$2,updated_at=now() where tenant_id=$1 and provider='loggro_restobar'`,
        [tenantId, pattern],
      );
      if (result.rowCount === 0)
        throw badRequest("LOGGRO_NOT_CONNECTED", "Connect Loggro before configuring its table pool");
    });
    // Found live testing this exact panel: a NestJS controller method
    // returning void sends a 200 with an EMPTY body — the frontend's
    // shared api() helper always calls response.json() on a non-204 ok
    // response, so an empty body throws "Unexpected end of JSON input" even
    // though the write itself already succeeded. Every write endpoint in
    // this module must return a real JSON body for that reason.
    return { tableNamePattern: pattern };
  }

  // Lists real tables from the live Loggro account so an admin can pick
  // the isHomeDelivery one by hand — never assumed automatically, since
  // whether that flag is already configured on the tenant's real account
  // is confirmed per-tenant, not guessed from the API shape alone.
  async listTables(tenantId: string, userId: string): Promise<LoggroTable[]> {
    const connectionId = await this.db.withTenantTransaction(tenantId, async (client) => {
      await this.assertManage(client, userId);
      const result = await client.query<{ id: string }>(
        `select id from app.pos_connections where tenant_id=$1 and provider='loggro_restobar' and status='connected'`,
        [tenantId],
      );
      if (!result.rows[0]) throw badRequest("LOGGRO_NOT_CONNECTED", "Connect Loggro first");
      return result.rows[0].id;
    });
    return this.apiClient.getTables(tenantId, connectionId);
  }

  private async assertManage(client: PoolClient, userId: string): Promise<void> {
    const result = await client.query<{ allowed: boolean }>(
      `select app.can_manage_channel_connections($1) allowed`,
      [userId],
    );
    if (!result.rows[0]?.allowed)
      throw forbidden("LOGGRO_FORBIDDEN", "Actor cannot manage POS connections");
  }
}
