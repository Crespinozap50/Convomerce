import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { LoggroApiClient, LoggroOrderLine } from "./loggro-api-client.service";

// Loggro's backend is Mongo-based and `group` must be a real 24-hex-char
// ObjectId shape — found live: a uuidv7() string (36 chars, hyphenated)
// makes Mongo throw a cast error that Loggro's gateway turns into an empty
// HTTP 503 instead of a documented 400, which looked exactly like an
// outage until a Postman test with a real ObjectId-shaped group succeeded.
function randomObjectId(): string {
  return randomBytes(12).toString("hex");
}

// Trailing number in a table name (e.g. "Bot Convomerce 2" -> 2). Falls
// back to -Infinity for non-numbered names so they sort first/never count
// toward "highest number" when picking the next one to create (D-197).
function tableNumber(name: string): number {
  const match = /(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : -Infinity;
}

// D-188/D-192/D-194 (docs/decisions.md): any order still in one of these
// statuses means the table's tab is open — only Cancelada (and Pagada,
// seen in the real report but not yet exercised live here) are excluded.
const OCCUPIED_STATUSES = ["Espera", "Cocina", "Listo", "Entregado"];

type OrderContext = {
  connectionId: string;
  tableNamePattern: string | null;
  currency: string;
  customerNotes: string | null;
  lines: {
    lineId: string;
    description: string;
    quantity: number;
    unitPriceMinor: number;
    externalProductId: string | null;
    modifierNotes: string[];
    mappedModifiers: { externalProductId: string; quantity: number; unitPriceMinor: number }[];
  }[];
};

@Injectable()
export class LoggroOrderSyncService {
  constructor(
    private readonly db: DatabaseService,
    private readonly apiClient: LoggroApiClient,
  ) {}

  // Called from CommerceEventsWorker on the 'order.confirmed' job — see
  // commercial-flow.service.ts's handleAwaitingConfirmation() for where the
  // outbox event that triggers this gets inserted. Never silently drops a
  // line: an unmapped catalog item or a missing home-delivery table both
  // throw a specific, actionable error instead of guessing.
  async pushOrder(tenantId: string, commercialRequestId: string): Promise<{ externalOrderIds: string[] }> {
    const context = await this.loadContext(tenantId, commercialRequestId);
    if (!context.tableNamePattern)
      throw new Error(
        "Loggro table name pattern is not configured for this tenant — set it in POS settings before enabling loggro_pos",
      );
    const tableId = await this.resolveAvailableTable(
      tenantId,
      context.connectionId,
      context.tableNamePattern,
    );
    const unmapped = context.lines.filter((line) => !line.externalProductId);
    if (unmapped.length > 0)
      throw new Error(
        `Unmapped Loggro products: ${unmapped.map((line) => line.description).join(", ")}`,
      );
    // Same short reference the customer sees in WhatsApp ("Pedido #XXXXXXXX"
    // — see cancelReadyOrderReply() in commercial-flow.service.ts for the
    // same slice(-8) convention). Put on every line's own notes, not just
    // groupName, so staff can match the kitchen ticket back to the WhatsApp
    // order even if the group header isn't visible wherever they're looking.
    const reference = commercialRequestId.slice(-8).toUpperCase();
    // D-192 (docs/decisions.md): a mapped modifier now goes out as its own
    // top-level line in `orders` (same group/table as its parent), never
    // as `productsExtra` — that field triggers a real, confirmed Loggro-
    // side bug in their own "Pedidos" report and (very likely) whatever
    // aggregation drives their table's "Ocupada" indicator. The `notes`
    // ties it back to its parent line for staff, since it's no longer
    // visually nested under it on the ticket.
    const orders: LoggroOrderLine[] = context.lines.flatMap((line) => [
      {
        product: line.externalProductId!,
        quantity: line.quantity,
        unit_price: Math.round(line.unitPriceMinor / 100),
        notes: [
          `Pedido #${reference}`,
          ...(context.customerNotes ? [context.customerNotes] : []),
          ...line.modifierNotes,
        ],
      },
      ...line.mappedModifiers.map((modifier) => ({
        product: modifier.externalProductId,
        quantity: modifier.quantity,
        unit_price: Math.round(modifier.unitPriceMinor / 100),
        notes: [`Pedido #${reference}`, `Adición de: ${line.description}`],
      })),
    ]);
    const created = await this.apiClient.createOrder(tenantId, context.connectionId, {
      table: tableId,
      group: randomObjectId(),
      groupName: `WhatsApp - Pedido ${reference}`,
      orders,
    });
    // D-195 (docs/decisions.md): Loggro creates one independent order
    // document PER ENTRY of `orders[]`, never a single order with several
    // lines — a request with a mapped modifier returns 2+ ids here. Every
    // one is tracked, not just the first: a real orphan (the modifier's own
    // order, never recorded anywhere) was found live and cleaned up by hand
    // before this fix existed.
    const externalOrderIds = created.map((order) => order._id).filter(Boolean);
    if (externalOrderIds.length === 0) throw new Error("Loggro did not return any created order id");
    await this.db.withTenantTransaction(tenantId, (client) =>
      client.query(
        `update app.commercial_requests set pos_sync_status='synced',pos_external_order_id=$2,pos_synced_at=now(),pos_last_error_code=null where id=$1`,
        [commercialRequestId, externalOrderIds],
      ),
    );
    return { externalOrderIds };
  }

  // D-194 (docs/decisions.md): re-resolves the real matching tables on
  // every push (never caches ids) so a table added later with the same
  // prefix is picked up with no code/config change. Picks the lowest
  // free-numbered table for a predictable, staff-legible assignment
  // instead of a random one.
  private async resolveAvailableTable(
    tenantId: string,
    connectionId: string,
    pattern: string,
  ): Promise<string> {
    const normalizedPattern = pattern.trim().toLowerCase();
    const allTables = await this.apiClient.getTables(tenantId, connectionId);
    // D-197 (docs/decisions.md): GET /tables keeps returning a table even
    // after it's deactivated (isActive:false) — only a real (permission-
    // gated) DELETE removes it from this list. Never match a deactivated
    // table, even if its name still fits the pattern.
    const pool = allTables
      .filter((table) => table.isActive && table.name.trim().toLowerCase().startsWith(normalizedPattern))
      .sort((a, b) => tableNumber(a.name) - tableNumber(b.name));
    if (pool.length === 0)
      throw new Error(`No se encontraron mesas en Loggro que coincidan con el patrón "${pattern}"`);
    const occupied = await this.apiClient.getOccupiedTableIds(tenantId, connectionId, OCCUPIED_STATUSES);
    const available = pool.find((table) => !occupied.has(table._id));
    if (available) return available._id;
    // D-197 (docs/decisions.md): pedido explícito — si el pool entero está
    // ocupado, crea la siguiente mesa numerada en vez de fallar el pedido.
    // POST /tables confirmado en vivo (developer.loggro.com/reference/guardarmesa):
    // sin `_id` crea una mesa real nueva. Nunca reutiliza el número de una
    // mesa desactivada (D-197) — siempre el máximo + 1 de las activas.
    const highestNumber = pool.reduce((max, table) => Math.max(max, tableNumber(table.name)), 0);
    const newTableName = `${pattern.trim()} ${highestNumber + 1}`;
    const created = await this.apiClient.createTable(tenantId, connectionId, newTableName);
    return created._id;
  }

  async markFailed(tenantId: string, commercialRequestId: string, error: unknown): Promise<void> {
    const code = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN_ERROR";
    await this.db.withTenantTransaction(tenantId, (client) =>
      client.query(
        `update app.commercial_requests set pos_sync_status='failed',pos_last_error_code=$2,updated_at=now() where id=$1`,
        [commercialRequestId, code],
      ),
    );
  }

  private async loadContext(tenantId: string, commercialRequestId: string): Promise<OrderContext> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      // status IN ('connected','error'), never just 'connected' — found live:
      // a single transient Loggro 5xx flips status to 'error' (recordError()
      // in loggro-api-client.service.ts), and withAuth() already retries a
      // real 401 by relogging in. Gating on status='connected' here made
      // that one blip permanently block every future order for this tenant
      // until an admin manually reconnected — 'disconnected' (never
      // configured) and 'paused' (intentionally off) are the only statuses
      // that should actually block a push attempt.
      const connection = await client.query<{ id: string; table_name_pattern: string | null }>(
        `select id,table_name_pattern from app.pos_connections where tenant_id=$1 and provider='loggro_restobar' and status in ('connected','error')`,
        [tenantId],
      );
      if (!connection.rows[0]) throw new Error("Loggro is not connected for this tenant");
      const request = await client.query<{ currency: string; customer_notes: string | null }>(
        `select currency,customer_notes from app.commercial_requests where id=$1`,
        [commercialRequestId],
      );
      if (!request.rows[0]) throw new Error("Commercial request was not found");
      const lines = await client.query<{
        id: string;
        description_snapshot: string;
        quantity: string;
        unit_price_minor_snapshot: string;
        external_product_id: string | null;
      }>(
        `select line.id,line.description_snapshot,line.quantity::text,line.unit_price_minor_snapshot::text,
                mapping.external_product_id
           from app.request_lines line
           left join app.pos_product_mappings mapping
             on mapping.tenant_id=line.tenant_id and mapping.item_variant_id=line.item_variant_id
                and mapping.pos_connection_id=$2
          where line.commercial_request_id=$1 and line.status='active'
          order by line.created_at`,
        [commercialRequestId, connection.rows[0].id],
      );
      const modifiers = await this.loadModifiers(client, commercialRequestId, connection.rows[0].id);
      return {
        connectionId: connection.rows[0].id,
        tableNamePattern: connection.rows[0].table_name_pattern,
        currency: request.rows[0].currency,
        customerNotes: request.rows[0].customer_notes,
        lines: lines.rows.map((row) => ({
          lineId: row.id,
          description: row.description_snapshot,
          quantity: Number(row.quantity),
          unitPriceMinor: Number(row.unit_price_minor_snapshot),
          externalProductId: row.external_product_id,
          modifierNotes: modifiers.notes.get(row.id) ?? [],
          mappedModifiers: modifiers.mapped.get(row.id) ?? [],
        })),
      };
    });
  }

  // Found live reviewing a real conversation (Santiago, Santos Tacos): a
  // modifier folded into free-text notes only never carried its own price
  // to Loggro — the real order there registered $9.500 (just the parent
  // product) when the customer had actually been charged $12.500
  // ($9.500 + Guacamole's $3.000). A modifier mapped in
  // app.pos_product_mappings (by modifier_option_id, see
  // 086_loggro_modifier_mappings.sql) now goes out with its real price —
  // as its own top-level order line (see pushOrder), not as `productsExtra`
  // (D-192: that field is real-price-correct in Loggro's own order-detail
  // response, but triggers a confirmed rendering bug in their "Pedidos"
  // report and very likely the mesa "Ocupada" indicator too). A modifier
  // with no mapping yet keeps the old notes-only fallback — visible to
  // staff, still not separately priced — same as today, so nothing about a
  // real order is ever silently dropped while a tenant is still filling in
  // its modifier mappings.
  private async loadModifiers(
    client: PoolClient,
    commercialRequestId: string,
    connectionId: string,
  ): Promise<{
    notes: Map<string, string[]>;
    mapped: Map<string, { externalProductId: string; quantity: number; unitPriceMinor: number }[]>;
  }> {
    const modifiers = await client.query<{
      request_line_id: string;
      description_snapshot: string;
      quantity: string;
      unit_price_delta_minor_snapshot: string;
      external_product_id: string | null;
    }>(
      `select modifier.request_line_id,modifier.description_snapshot,modifier.quantity::text,
              modifier.unit_price_delta_minor_snapshot::text,mapping.external_product_id
         from app.request_line_modifiers modifier
         join app.request_lines line on line.tenant_id=modifier.tenant_id and line.id=modifier.request_line_id
         left join app.pos_product_mappings mapping
           on mapping.tenant_id=modifier.tenant_id and mapping.modifier_option_id=modifier.modifier_option_id
              and mapping.pos_connection_id=$2
        where line.commercial_request_id=$1 and line.status='active'
        order by modifier.created_at`,
      [commercialRequestId, connectionId],
    );
    const notes = new Map<string, string[]>();
    const mapped = new Map<string, { externalProductId: string; quantity: number; unitPriceMinor: number }[]>();
    for (const row of modifiers.rows) {
      if (row.external_product_id) {
        const list = mapped.get(row.request_line_id) ?? [];
        list.push({
          externalProductId: row.external_product_id,
          quantity: Number(row.quantity),
          unitPriceMinor: Number(row.unit_price_delta_minor_snapshot),
        });
        mapped.set(row.request_line_id, list);
      } else {
        const lineNotes = notes.get(row.request_line_id) ?? [];
        lineNotes.push(row.description_snapshot);
        notes.set(row.request_line_id, lineNotes);
      }
    }
    return { notes, mapped };
  }
}
