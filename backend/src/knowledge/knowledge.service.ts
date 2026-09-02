import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { forbidden, notFound } from "../observability/http-errors";
import { v7 as uuidv7 } from "uuid";

export type ProfileInput = {
  description: string;
  address: string;
  phone: string;
  businessHours: string;
  paymentMethods: string;
  fulfillmentOptions: string;
};
export const capabilityNames = [
  "commercial_offerings",
  "inventory",
  "orders",
  "appointments",
  "delivery",
] as const;
export type CapabilityName = (typeof capabilityNames)[number];
export type OfferingInput = {
  name: string;
  description: string;
  category: string;
  offeringType:
    "product" | "service" | "prepared_product" | "appointment" | "package";
  status: "active" | "inactive";
  durationMinutes: number | null;
  bookingRequired: boolean;
  variantName: string;
  sku: string | null;
  priceMinor: number;
  currency: string;
  availabilityStatus: "available" | "unavailable";
};

@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DatabaseService) {}

  get(tenantId: string, userId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const access = await client.query<{ allowed: boolean }>(
        `select app.can_manage_channel_connections($1) or exists(select 1 from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active') allowed`,
        [userId],
      );
      if (!access.rows[0]?.allowed)
        throw forbidden(
          "KNOWLEDGE_FORBIDDEN",
          "Actor cannot view business knowledge",
        );
      const [
        profile,
        entries,
        offerings,
        variants,
        sources,
        capabilities,
        calendars,
        unresolved,
        responseVariants,
      ] = await Promise.all([
        client.query(
          `select description,address,phone,business_hours,payment_methods,fulfillment_options from app.business_profiles`,
        ),
        client.query(
          `select id,kind,title,content,status,coalesce(keywords,'{}') as keywords from app.knowledge_entries order by title limit 50`,
        ),
        client.query(
          `select id,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required from app.catalog_items where status<>'archived' order by name limit 100`,
        ),
        client.query(
          `select id,catalog_item_id,name,sku,status,price_minor::text,currency,availability_status from app.item_variants order by created_at`,
        ),
        client.query(
          `select id,provider,display_name,status,last_synced_at,last_error_code from app.catalog_sources order by display_name`,
        ),
        client.query(
          `select capability,enabled from app.tenant_capabilities order by capability`,
        ),
        client.query(
          `select id,provider,display_name,status,last_synced_at,last_error_code from app.calendar_sources order by display_name`,
        ),
        client.query(
          `select id,sample_question,context_messages,occurrence_count,status,first_seen_at,last_seen_at from app.unresolved_customer_questions where status='pending' order by occurrence_count desc,last_seen_at desc limit 50`,
        ),
        client.query(
          `select id,scope,template_namespace,template_key,locale,deterministic_body,variant_body,status,source,use_count,last_used_at,created_at,updated_at from app.approved_response_variants where tenant_id=app.current_tenant_id() order by case status when 'candidate' then 0 when 'approved' then 1 else 2 end,updated_at desc limit 100`,
        ),
      ]);
      const value = profile.rows[0] ?? {};
      return {
        profile: {
          description: value.description ?? "",
          address: value.address ?? "",
          phone: value.phone ?? "",
          businessHours: value.business_hours ?? "",
          paymentMethods: value.payment_methods ?? "",
          fulfillmentOptions: value.fulfillment_options ?? "",
        },
        entries: entries.rows,
        products: offerings.rows.map((row) => ({
          ...row,
          sourceProvider: row.source_provider,
          offeringType: row.offering_type,
          durationMinutes: row.duration_minutes,
          bookingRequired: row.booking_required,
          variants: variants.rows
            .filter((variant) => variant.catalog_item_id === row.id)
            .map((variant) => ({
              id: variant.id,
              name: variant.name,
              sku: variant.sku,
              status: variant.status,
              priceMinor: Number(variant.price_minor),
              currency: variant.currency,
              availabilityStatus: variant.availability_status,
            })),
        })),
        sources: sources.rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          displayName: row.display_name,
          status: row.status,
          lastSyncedAt: row.last_synced_at,
          lastErrorCode: row.last_error_code,
        })),
        capabilities: capabilities.rows
          .filter((row) => row.enabled)
          .map((row) => row.capability),
        calendarSources: calendars.rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          displayName: row.display_name,
          status: row.status,
          lastSyncedAt: row.last_synced_at,
          lastErrorCode: row.last_error_code,
        })),
        unresolvedQuestions: unresolved.rows.map((row) => ({
          id: row.id,
          question: row.sample_question,
          contextMessages: row.context_messages ?? [],
          occurrenceCount: row.occurrence_count,
          status: row.status,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
        })),
        responseVariants: responseVariants.rows.map((row) => ({
          id: row.id,
          scope: row.scope,
          templateNamespace: row.template_namespace,
          templateKey: row.template_key,
          locale: row.locale,
          deterministicBody: row.deterministic_body,
          variantBody: row.variant_body,
          status: row.status,
          source: row.source,
          useCount: Number(row.use_count),
          lastUsedAt: row.last_used_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        canManage: await this.canManage(client, userId),
      };
    });
  }

  reviewResponseVariant(
    tenantId: string,
    userId: string,
    variantId: string,
    input: { action: "approve" | "reject"; variantBody: string },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden(
          "KNOWLEDGE_FORBIDDEN",
          "Actor cannot manage learned responses",
        );
      const result = await client.query(
        `update app.approved_response_variants
        set status=$2,variant_body=case when $2='approved' then $3 else variant_body end,updated_at=now()
        where id=$1 and tenant_id=app.current_tenant_id()
        returning id,scope,template_namespace,template_key,locale,deterministic_body,variant_body,status,source,use_count,last_used_at,created_at,updated_at`,
        [
          variantId,
          input.action === "approve" ? "approved" : "rejected",
          input.variantBody,
        ],
      );
      if (!result.rows[0])
        throw notFound(
          "RESPONSE_VARIANT_NOT_FOUND",
          "Learned response was not found",
        );
      const row = result.rows[0];
      return {
        variant: {
          id: row.id,
          scope: row.scope,
          templateNamespace: row.template_namespace,
          templateKey: row.template_key,
          locale: row.locale,
          deterministicBody: row.deterministic_body,
          variantBody: row.variant_body,
          status: row.status,
          source: row.source,
          useCount: Number(row.use_count),
          lastUsedAt: row.last_used_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      };
    });
  }

  save(tenantId: string, userId: string, input: ProfileInput) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await client.query(
        "select app.save_business_profile($1,$2,$3,$4,$5,$6,$7)",
        [
          userId,
          input.description,
          input.address,
          input.phone,
          input.businessHours,
          input.paymentMethods,
          input.fulfillmentOptions,
        ],
      );
      return { saved: true };
    });
  }

  saveCapabilities(
    tenantId: string,
    userId: string,
    enabled: CapabilityName[],
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await client.query("select app.save_tenant_capabilities($1,$2::text[])", [
        userId,
        enabled,
      ]);
      return { saved: true, capabilities: enabled };
    });
  }
  createOffering(tenantId: string, userId: string, input: OfferingInput) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      let catalog = await client.query<{ id: string }>(
        `select id from app.catalogs where status='published' order by published_at desc limit 1`,
      );
      if (!catalog.rows[0]) {
        const id = uuidv7();
        await client.query(
          `insert into app.catalogs(id,tenant_id,name,status,currency,version,published_at) values($1,$2,'Main catalog','published',$3,1,now()) on conflict(tenant_id,name,version) do nothing`,
          [id, tenantId, input.currency],
        );
        catalog = await client.query(
          `select id from app.catalogs where status='published' order by published_at desc limit 1`,
        );
      }
      const itemId = uuidv7(),
        variantId = uuidv7();
      await client.query(
        `insert into app.catalog_items(id,tenant_id,catalog_id,name,description,category,status,offering_type,duration_minutes,booking_required,source_provider) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual')`,
        [
          itemId,
          tenantId,
          catalog.rows[0].id,
          input.name,
          input.description || null,
          input.category || null,
          input.status,
          input.offeringType,
          input.durationMinutes,
          input.bookingRequired,
        ],
      );
      await client.query(
        `insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          variantId,
          tenantId,
          itemId,
          input.sku,
          input.variantName,
          input.status,
          input.priceMinor,
          input.currency,
          input.availabilityStatus,
        ],
      );
      return { offering: await this.readOffering(client, itemId) };
    });
  }
  updateOffering(
    tenantId: string,
    userId: string,
    offeringId: string,
    input: OfferingInput,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      const item = await client.query<{ source_provider: string }>(
        `select source_provider from app.catalog_items where id=$1 and status<>'archived'`,
        [offeringId],
      );
      if (!item.rows[0])
        throw notFound("OFFERING_NOT_FOUND", "Offering was not found");
      if (item.rows[0].source_provider !== "manual")
        throw forbidden(
          "EXTERNAL_OFFERING_READ_ONLY",
          "Externally synchronized offerings must be edited at their source",
        );
      await client.query(
        `update app.catalog_items set name=$2,description=$3,category=$4,status=$5,offering_type=$6,duration_minutes=$7,booking_required=$8,updated_at=now() where id=$1`,
        [
          offeringId,
          input.name,
          input.description || null,
          input.category || null,
          input.status,
          input.offeringType,
          input.durationMinutes,
          input.bookingRequired,
        ],
      );
      const variant = await client.query<{ id: string }>(
        `select id from app.item_variants where catalog_item_id=$1 and status<>'archived' order by created_at limit 1`,
        [offeringId],
      );
      if (variant.rows[0])
        await client.query(
          `update app.item_variants set sku=$2,name=$3,status=$4,price_minor=$5,currency=$6,availability_status=$7,availability_checked_at=now(),updated_at=now() where id=$1`,
          [
            variant.rows[0].id,
            input.sku,
            input.variantName,
            input.status,
            input.priceMinor,
            input.currency,
            input.availabilityStatus,
          ],
        );
      else
        await client.query(
          `insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
          [
            uuidv7(),
            tenantId,
            offeringId,
            input.sku,
            input.variantName,
            input.status,
            input.priceMinor,
            input.currency,
            input.availabilityStatus,
          ],
        );
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  archiveOffering(tenantId: string, userId: string, offeringId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      const result = await client.query(
        `update app.catalog_items set status='archived',updated_at=now() where id=$1 and source_provider='manual' and status<>'archived' returning id`,
        [offeringId],
      );
      if (!result.rows[0])
        throw notFound("OFFERING_NOT_FOUND", "Manual offering was not found");
      await client.query(
        `update app.item_variants set status='archived',updated_at=now() where catalog_item_id=$1 and status<>'archived'`,
        [offeringId],
      );
      return { archived: true };
    });
  }
  review(
    tenantId: string,
    userId: string,
    questionId: string,
    input: { action: "dismiss" | "publish"; title: string; content: string; keywords: string[] },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await client.query(
        "select app.review_unresolved_question($1,$2,$3,$4,$5,$6,$7::text[])",
        [
          userId,
          questionId,
          input.action,
          uuidv7(),
          input.title,
          input.content,
          input.keywords,
        ],
      );
      return { reviewed: true };
    });
  }

  updateEntry(
    tenantId: string,
    userId: string,
    entryId: string,
    input: { title: string; content: string; keywords: string[] },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden(
          "KNOWLEDGE_FORBIDDEN",
          "Actor cannot manage business knowledge",
        );
      const result = await client.query(
        `update app.knowledge_entries set title=$2,content=$3,keywords=$4::text[],version=version+1,updated_at=now() where id=$1 and status='published' returning id,kind,title,content,status,coalesce(keywords,'{}') as keywords`,
        [entryId, input.title, input.content, input.keywords],
      );
      if (!result.rows[0])
        throw notFound(
          "KNOWLEDGE_ENTRY_NOT_FOUND",
          "Published answer was not found",
        );
      return { entry: result.rows[0] };
    });
  }

  archiveEntry(tenantId: string, userId: string, entryId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden(
          "KNOWLEDGE_FORBIDDEN",
          "Actor cannot manage business knowledge",
        );
      const result = await client.query(
        `update app.knowledge_entries set status='archived',version=version+1,updated_at=now() where id=$1 and status='published' returning id`,
        [entryId],
      );
      if (!result.rows[0])
        throw notFound(
          "KNOWLEDGE_ENTRY_NOT_FOUND",
          "Published answer was not found",
        );
      return { archived: true };
    });
  }

  private async canManage(client: PoolClient, userId: string) {
    const result = await client.query(
      "select app.can_manage_channel_connections($1) allowed",
      [userId],
    );
    return result.rows[0]?.allowed === true;
  }
  private async readOffering(client: PoolClient, id: string) {
    const item = (
      await client.query(
        `select id,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required from app.catalog_items where id=$1`,
        [id],
      )
    ).rows[0];
    const variants = (
      await client.query(
        `select id,name,sku,status,price_minor::text,currency,availability_status from app.item_variants where catalog_item_id=$1 order by created_at`,
        [id],
      )
    ).rows;
    return {
      ...item,
      sourceProvider: item.source_provider,
      offeringType: item.offering_type,
      durationMinutes: item.duration_minutes,
      bookingRequired: item.booking_required,
      variants: variants.map((variant: {
        id: string; name: string; sku: string | null; status: string;
        price_minor: string; currency: string; availability_status: string;
      }) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        status: variant.status,
        priceMinor: Number(variant.price_minor),
        currency: variant.currency,
        availabilityStatus: variant.availability_status,
      })),
    };
  }
}
