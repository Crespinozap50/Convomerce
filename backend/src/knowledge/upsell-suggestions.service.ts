import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { forbidden, notFound } from "../observability/http-errors";

export type UpsellSuggestion = {
  targetVariantId: string;
  productName: string;
  variantName: string;
  priceMinor: string;
  currency: string;
  active: boolean;
  available: boolean;
  offeredWith: { variantId: string; name: string }[];
};

// Sugerencias al pedir ("¿Te agrego Agua fresca?"): lectura y control desde el
// panel. Una "sugerencia" es el PRODUCTO que se ofrece (target) y agrupa todas
// las reglas product_recommendations que lo ofrecen — apagarla apaga todas.
@Injectable()
export class UpsellSuggestionsService {
  constructor(private readonly db: DatabaseService) {}

  get(tenantId: string, userId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const config = await client.query<{ upsell_enabled: boolean }>(
        `select upsell_enabled from app.bot_configurations where tenant_id=$1`,
        [tenantId],
      );
      const rows = await client.query<{
        target_variant_id: string;
        product_name: string;
        variant_name: string;
        price_minor: string;
        currency: string;
        active: boolean;
        available: boolean;
        source_variant_id: string;
        source_name: string;
      }>(
        `select r.target_variant_id::text,ti.name product_name,tv.name variant_name,tv.price_minor::text,tv.currency,
                (r.status='active') active,
                (tv.status='active' and tv.availability_status='available' and ti.status='active') available,
                r.source_variant_id::text,
                si.name||case when sv.name is not null and sv.name<>'Unidad' then ' ('||sv.name||')' else '' end source_name
           from app.product_recommendations r
           join app.item_variants tv on tv.tenant_id=r.tenant_id and tv.id=r.target_variant_id
           join app.catalog_items ti on ti.tenant_id=tv.tenant_id and ti.id=tv.catalog_item_id
           join app.item_variants sv on sv.tenant_id=r.tenant_id and sv.id=r.source_variant_id
           join app.catalog_items si on si.tenant_id=sv.tenant_id and si.id=sv.catalog_item_id
          where r.tenant_id=$1
          order by ti.name,si.name,sv.name`,
        [tenantId],
      );
      const byTarget = new Map<string, UpsellSuggestion>();
      for (const row of rows.rows) {
        const existing = byTarget.get(row.target_variant_id);
        if (existing) {
          existing.active = existing.active || row.active;
          existing.offeredWith.push({ variantId: row.source_variant_id, name: row.source_name });
          continue;
        }
        byTarget.set(row.target_variant_id, {
          targetVariantId: row.target_variant_id,
          productName: row.product_name,
          variantName: row.variant_name,
          priceMinor: row.price_minor,
          currency: row.currency,
          active: row.active,
          available: row.available,
          offeredWith: [{ variantId: row.source_variant_id, name: row.source_name }],
        });
      }
      return {
        enabled: config.rows[0]?.upsell_enabled ?? true,
        suggestions: [...byTarget.values()],
      };
    });
  }

  setEnabled(tenantId: string, userId: string, enabled: boolean) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await this.guard(async () =>
        client.query("select app.set_upsell_enabled($1,$2)", [userId, enabled]),
      );
      return { saved: true, enabled };
    });
  }

  setTarget(tenantId: string, userId: string, targetVariantId: string, enabled: boolean) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const result = await this.guard(async () =>
        client.query<{ changed: number }>("select app.set_upsell_target($1,$2,$3) changed", [
          userId,
          targetVariantId,
          enabled,
        ]),
      );
      if (!result.rows[0]?.changed) throw notFound("SUGGESTION_NOT_FOUND", "Suggestion not found");
      return { saved: true, targetVariantId, active: enabled };
    });
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: string }).code === "42501")
        throw forbidden("SUGGESTIONS_FORBIDDEN", "Actor cannot manage suggestions");
      throw error;
    }
  }
}
