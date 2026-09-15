import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { LoggroApiClient, LoggroOrderExtra, LoggroOrderLine } from "./loggro-api-client.service";

// Loggro's backend is Mongo-based and `group` must be a real 24-hex-char
// ObjectId shape — found live: a uuidv7() string (36 chars, hyphenated)
// makes Mongo throw a cast error that Loggro's gateway turns into an empty
// HTTP 503 instead of a documented 400, which looked exactly like an
// outage until a Postman test with a real ObjectId-shaped group succeeded.
function randomObjectId(): string {
  return randomBytes(12).toString("hex");
}

type OrderContext = {
  connectionId: string;
  homeDeliveryTableId: string | null;
  currency: string;
  customerNotes: string | null;
  lines: {
    lineId: string;
    description: string;
    quantity: number;
    unitPriceMinor: number;
    externalProductId: string | null;
    modifierNotes: string[];
    modifierExtras: LoggroOrderExtra[];
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
  async pushOrder(tenantId: string, commercialRequestId: string): Promise<{ externalOrderId: string }> {
    const context = await this.loadContext(tenantId, commercialRequestId);
    if (!context.homeDeliveryTableId)
      throw new Error(
        "Loggro home-delivery table is not configured for this tenant — set it in POS settings before enabling loggro_pos",
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
    const orders: LoggroOrderLine[] = context.lines.map((line) => ({
      product: line.externalProductId!,
      quantity: line.quantity,
      unit_price: Math.round(line.unitPriceMinor / 100),
      notes: [
        `Pedido #${reference}`,
        ...(context.customerNotes ? [context.customerNotes] : []),
        ...line.modifierNotes,
      ],
      ...(line.modifierExtras.length > 0 ? { productsExtra: line.modifierExtras } : {}),
    }));
    const created = await this.apiClient.createOrder(tenantId, context.connectionId, {
      table: context.homeDeliveryTableId,
      group: randomObjectId(),
      groupName: `WhatsApp - Pedido ${reference}`,
      orders,
    });
    const externalOrderId = created[0]?._id;
    if (!externalOrderId) throw new Error("Loggro did not return a created order id");
    await this.db.withTenantTransaction(tenantId, (client) =>
      client.query(
        `update app.commercial_requests set pos_sync_status='synced',pos_external_order_id=$2,pos_synced_at=now(),pos_last_error_code=null where id=$1`,
        [commercialRequestId, externalOrderId],
      ),
    );
    return { externalOrderId };
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
      const connection = await client.query<{ id: string; home_delivery_table_id: string | null }>(
        `select id,home_delivery_table_id from app.pos_connections where tenant_id=$1 and provider='loggro_restobar' and status in ('connected','error')`,
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
        homeDeliveryTableId: connection.rows[0].home_delivery_table_id,
        currency: request.rows[0].currency,
        customerNotes: request.rows[0].customer_notes,
        lines: lines.rows.map((row) => ({
          lineId: row.id,
          description: row.description_snapshot,
          quantity: Number(row.quantity),
          unitPriceMinor: Number(row.unit_price_minor_snapshot),
          externalProductId: row.external_product_id,
          modifierNotes: modifiers.notes.get(row.id) ?? [],
          modifierExtras: modifiers.extras.get(row.id) ?? [],
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
  // 086_loggro_modifier_mappings.sql) now goes out as its own
  // productsExtra entry with the real price, exactly the field Loggro's
  // API has for this (see developer.loggro.com/reference/crearpedidos).
  // A modifier with no mapping yet keeps the old notes-only fallback —
  // visible to staff, still not separately priced — same as today, so
  // nothing about a real order is ever silently dropped while a tenant is
  // still filling in its modifier mappings.
  private async loadModifiers(
    client: PoolClient,
    commercialRequestId: string,
    connectionId: string,
  ): Promise<{ notes: Map<string, string[]>; extras: Map<string, LoggroOrderExtra[]> }> {
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
    const extras = new Map<string, LoggroOrderExtra[]>();
    for (const row of modifiers.rows) {
      if (row.external_product_id) {
        const lineExtras = extras.get(row.request_line_id) ?? [];
        lineExtras.push({
          product: row.external_product_id,
          quantity: Number(row.quantity),
          price: Math.round(Number(row.unit_price_delta_minor_snapshot) / 100),
        });
        extras.set(row.request_line_id, lineExtras);
      } else {
        const lineNotes = notes.get(row.request_line_id) ?? [];
        lineNotes.push(row.description_snapshot);
        notes.set(row.request_line_id, lineNotes);
      }
    }
    return { notes, extras };
  }
}
