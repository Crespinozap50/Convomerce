import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CredentialEncryptionService } from "../secrets/credential-encryption.service";
import { badRequest } from "../observability/http-errors";

// Verified against Loggro Restobar's real public API docs
// (developer.loggro.com) this round — not Loggro Enterprise's unrelated
// wholesale/ERP "pedido" endpoint, which shares a similar name but a
// completely different base URL/payload shape.
const LOGGRO_BASE_URL = "https://api.pirpos.com";

export type LoggroProduct = {
  _id: string;
  name: string;
  barcode: string | null;
  isActive: boolean;
};
export type LoggroTable = {
  _id: string;
  name: string;
  isActive: boolean;
  isHomeDelivery: boolean;
};
export type LoggroOrderExtra = {
  product: string;
  quantity: number;
  price: number;
};
export type LoggroOrderLine = {
  product: string;
  quantity: number;
  unit_price: number;
  notes?: string[];
  productsExtra?: LoggroOrderExtra[];
};
export type LoggroOrderPayload = {
  table: string;
  group: string;
  groupName: string;
  orders: LoggroOrderLine[];
};
export type LoggroCreatedOrder = { _id: string; status: string };

@Injectable()
export class LoggroApiClient {
  constructor(
    private readonly db: DatabaseService,
    private readonly credentials: CredentialEncryptionService,
  ) {}

  async login(tenantId: string, connectionId: string): Promise<string> {
    const stored = await this.db.withTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{ secret_reference: string | null }>(
        `select secret_reference from app.pos_connections where id=$1 and provider='loggro_restobar'`,
        [connectionId],
      );
      if (!result.rows[0]?.secret_reference)
        throw badRequest("LOGGRO_NOT_CONNECTED", "Loggro connection has no stored credentials");
      return result.rows[0].secret_reference;
    });
    const { email, password } = JSON.parse(this.credentials.decrypt(stored)) as {
      email: string;
      password: string;
    };
    const response = await fetch(`${LOGGRO_BASE_URL}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      tokenCurrent?: string;
      business?: { _id?: string };
    };
    if (!response.ok || !body.tokenCurrent) {
      await this.recordError(tenantId, connectionId, `LOGIN_HTTP_${response.status}`);
      throw badRequest("LOGGRO_LOGIN_FAILED", `Loggro login failed with HTTP ${response.status}`);
    }
    await this.db.withTenantTransaction(tenantId, (client) =>
      client.query(
        `update app.pos_connections set cached_token=$2,cached_token_obtained_at=now(),external_business_id=coalesce($3,external_business_id),status='connected',last_error_code=null,updated_at=now() where id=$1`,
        [connectionId, body.tokenCurrent, body.business?._id ?? null],
      ),
    );
    return body.tokenCurrent;
  }

  // Confirmed live against the real Santos Tacos account: unlike /tables,
  // /products wraps its payload as {data: [...]}, not a bare array.
  async getProducts(tenantId: string, connectionId: string): Promise<LoggroProduct[]> {
    const body = await this.withAuth<{ data: LoggroProduct[] }>(tenantId, connectionId, (token) =>
      fetch(`${LOGGRO_BASE_URL}/products?pagination=false`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
    );
    return body.data;
  }

  async getTables(tenantId: string, connectionId: string): Promise<LoggroTable[]> {
    return this.withAuth<LoggroTable[]>(tenantId, connectionId, (token) =>
      fetch(`${LOGGRO_BASE_URL}/tables`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }

  async createOrder(
    tenantId: string,
    connectionId: string,
    payload: LoggroOrderPayload,
  ): Promise<LoggroCreatedOrder[]> {
    return this.withAuth<LoggroCreatedOrder[]>(tenantId, connectionId, (token) =>
      fetch(`${LOGGRO_BASE_URL}/orders`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      }),
    );
  }

  // Tries with the cached token first; on a 401 (expired/invalid — Loggro
  // documents no expiry, so this is the only real signal), logs in exactly
  // once more and retries exactly once. A second 401 right after a fresh
  // login is a genuine, surfaced failure, never retried again.
  private async withAuth<T>(
    tenantId: string,
    connectionId: string,
    call: (token: string) => Promise<Response>,
  ): Promise<T> {
    const token = await this.resolveToken(tenantId, connectionId);
    let response = await call(token);
    if (response.status === 401) {
      const fresh = await this.login(tenantId, connectionId);
      response = await call(fresh);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      await this.recordError(tenantId, connectionId, `HTTP_${response.status}`);
      throw badRequest(
        "LOGGRO_API_ERROR",
        `Loggro API call failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
      );
    }
    return response.json() as Promise<T>;
  }

  private async resolveToken(tenantId: string, connectionId: string): Promise<string> {
    const cached = await this.db.withTenantTransaction(tenantId, (client) =>
      client.query<{ cached_token: string | null }>(
        `select cached_token from app.pos_connections where id=$1 and provider='loggro_restobar'`,
        [connectionId],
      ),
    );
    const token = cached.rows[0]?.cached_token;
    return token ?? this.login(tenantId, connectionId);
  }

  private async recordError(tenantId: string, connectionId: string, code: string): Promise<void> {
    await this.db.withTenantTransaction(tenantId, (client) =>
      client.query(
        `update app.pos_connections set status='error',last_error_code=$2,updated_at=now() where id=$1`,
        [connectionId, code],
      ),
    );
  }
}
