import { HttpException, Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import { DatabaseService } from "../database/database.service";
import { badRequest, conflict, forbidden, notFound } from "../observability/http-errors";
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
  "pickup",
  "on_site",
  "consultative_recommendations",
  "command_recovery",
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
};
// D-142 (docs/decisions.md): split out of OfferingInput so an offering can
// carry more than one variant — createOffering still takes exactly one of
// these alongside the offering fields (a product is never left with zero
// variants), but createVariant/updateVariant/saveVariantLocalization below
// address a specific variant by id instead of always the first one.
export type VariantInput = {
  name: string;
  sku: string | null;
  priceMinor: number;
  currency: string;
  status: "active" | "inactive";
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
        profileLoc,
        entries,
        entryLoc,
        offerings,
        variants,
        variantLoc,
        offeringLoc,
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
          `select address,business_hours,payment_methods,fulfillment_options from app.business_profile_localizations where locale='en'`,
        ),
        client.query(
          `select id,kind,title,content,status,coalesce(keywords,'{}') as keywords from app.knowledge_entries order by title limit 50`,
        ),
        client.query(
          `select knowledge_entry_id,title,content from app.knowledge_entry_localizations where locale='en'`,
        ),
        client.query(
          // Unlike the other `limit`s in this query (candidate pools for AI
          // ranking, where "top N" is a legitimate cap), this is the
          // tenant's actual inventory — the admin catalog page's search and
          // pagination filter this list client-side, so silently truncating
          // it here hides real products from search with no indication
          // anything was cut (found live: CrediCel's 118 products at the
          // old `limit 100` silently dropped every "iPhone…" row).
          `select id,name,description,category,status,source_provider,offering_type,duration_minutes,booking_required from app.catalog_items where status<>'archived' order by name limit 5000`,
        ),
        client.query(
          `select id,catalog_item_id,name,sku,status,price_minor::text,currency,availability_status from app.item_variants order by created_at`,
        ),
        client.query(
          `select item_variant_id,name from app.item_variant_localizations where locale='en'`,
        ),
        client.query(
          `select catalog_item_id,name,description from app.catalog_item_localizations where locale='en'`,
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
      const profileEn = profileLoc.rows[0];
      const entryLocById = new Map(entryLoc.rows.map((row) => [row.knowledge_entry_id, row]));
      const variantLocById = new Map(variantLoc.rows.map((row) => [row.item_variant_id, row]));
      const offeringLocById = new Map(offeringLoc.rows.map((row) => [row.catalog_item_id, row]));
      return {
        profile: {
          description: value.description ?? "",
          address: value.address ?? "",
          phone: value.phone ?? "",
          businessHours: value.business_hours ?? "",
          paymentMethods: value.payment_methods ?? "",
          fulfillmentOptions: value.fulfillment_options ?? "",
          translations: {
            en: {
              address: profileEn?.address ?? "",
              businessHours: profileEn?.business_hours ?? "",
              paymentMethods: profileEn?.payment_methods ?? "",
              fulfillmentOptions: profileEn?.fulfillment_options ?? "",
            },
          },
        },
        entries: entries.rows.map((row) => ({
          ...row,
          translations: {
            en: {
              title: entryLocById.get(row.id)?.title ?? "",
              content: entryLocById.get(row.id)?.content ?? "",
            },
          },
        })),
        products: offerings.rows.map((row) => ({
          ...row,
          sourceProvider: row.source_provider,
          offeringType: row.offering_type,
          durationMinutes: row.duration_minutes,
          bookingRequired: row.booking_required,
          translations: {
            en: {
              name: offeringLocById.get(row.id)?.name ?? "",
              description: offeringLocById.get(row.id)?.description ?? "",
            },
          },
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
              translations: {
                en: { name: variantLocById.get(variant.id)?.name ?? "" },
              },
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

  // Fase 2: administrable localizations. English is the only supported
  // second language today (SupportedLanguage in localization.ts), so this
  // always targets 'en' — a blank field clears that translation, falling
  // back to the tenant's default-language (Spanish) content at read time
  // (see deterministic-reply.service.ts), never showing nothing.
  saveProfileLocalization(
    tenantId: string,
    userId: string,
    input: { address: string; businessHours: string; paymentMethods: string; fulfillmentOptions: string },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage business knowledge");
      await client.query(
        `insert into app.business_profile_localizations(tenant_id,locale,address,business_hours,payment_methods,fulfillment_options)
         values(app.current_tenant_id(),'en',$1,$2,$3,$4)
         on conflict(tenant_id,locale) do update set
           address=excluded.address,business_hours=excluded.business_hours,
           payment_methods=excluded.payment_methods,fulfillment_options=excluded.fulfillment_options,
           updated_at=now()`,
        [
          input.address || null,
          input.businessHours || null,
          input.paymentMethods || null,
          input.fulfillmentOptions || null,
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
  createOffering(
    tenantId: string,
    userId: string,
    input: OfferingInput,
    variant: VariantInput,
  ) {
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
          [id, tenantId, variant.currency],
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
      try {
        await client.query(
          `insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
          [
            variantId,
            tenantId,
            itemId,
            variant.sku,
            variant.name,
            variant.status,
            variant.priceMinor,
            variant.currency,
            variant.availabilityStatus,
          ],
        );
      } catch (error) {
        if (isPgCode(error, "23505"))
          throw conflict(
            "VARIANT_SKU_IN_USE",
            "This SKU is already used by another variant",
          );
        throw error;
      }
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
      // D-142: no longer touches app.item_variants at all — an offering can
      // have several variants now, so "the first one" isn't a meaningful
      // target here anymore. See createVariant/updateVariant/archiveVariant
      // below, which address a specific variant by id instead.
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
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  saveOfferingLocalization(
    tenantId: string,
    userId: string,
    offeringId: string,
    input: { name: string; description: string },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      await client.query(
        `insert into app.catalog_item_localizations(tenant_id,catalog_item_id,locale,name,description)
         values(app.current_tenant_id(),$1,'en',$2,$3)
         on conflict(tenant_id,catalog_item_id,locale) do update set
           name=excluded.name,description=excluded.description,updated_at=now()`,
        [offeringId, input.name || null, input.description || null],
      );
      // D-142: variant-name translation moved to saveVariantLocalization,
      // addressed by variant id — this used to always translate whichever
      // variant happened to be first, silently ignoring any others.
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
  // D-142: the write-side half of "self-service catalog with real
  // multi-variant support" — the read side (readOffering/get() below)
  // already returned every variant, unbounded; createVariant/updateVariant/
  // archiveVariant are what let the admin panel actually add a second
  // priced option to an existing product instead of requiring raw SQL.
  private async assertManualOffering(client: PoolClient, offeringId: string) {
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
  }
  createVariant(
    tenantId: string,
    userId: string,
    offeringId: string,
    input: VariantInput,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      await this.assertManualOffering(client, offeringId);
      const id = uuidv7();
      try {
        await client.query(
          `insert into app.item_variants(id,tenant_id,catalog_item_id,sku,name,status,price_minor,currency,availability_status,availability_checked_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
          [
            id,
            tenantId,
            offeringId,
            input.sku,
            input.name,
            input.status,
            input.priceMinor,
            input.currency,
            input.availabilityStatus,
          ],
        );
      } catch (error) {
        if (isPgCode(error, "23505"))
          throw conflict(
            "VARIANT_SKU_IN_USE",
            "This SKU is already used by another variant",
          );
        throw error;
      }
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  updateVariant(
    tenantId: string,
    userId: string,
    offeringId: string,
    variantId: string,
    input: VariantInput,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      await this.assertManualOffering(client, offeringId);
      try {
        const result = await client.query<{ id: string }>(
          `update app.item_variants set sku=$3,name=$4,status=$5,price_minor=$6,currency=$7,availability_status=$8,availability_checked_at=now(),updated_at=now()
           where id=$1 and catalog_item_id=$2 and status<>'archived' returning id`,
          [
            variantId,
            offeringId,
            input.sku,
            input.name,
            input.status,
            input.priceMinor,
            input.currency,
            input.availabilityStatus,
          ],
        );
        if (!result.rows[0])
          throw notFound("VARIANT_NOT_FOUND", "Variant was not found");
      } catch (error) {
        if (isPgCode(error, "23505"))
          throw conflict(
            "VARIANT_SKU_IN_USE",
            "This SKU is already used by another variant",
          );
        throw error;
      }
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  archiveVariant(
    tenantId: string,
    userId: string,
    offeringId: string,
    variantId: string,
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      await this.assertManualOffering(client, offeringId);
      // A product must never end up with zero sellable variants without an
      // explicit warning — archiving the last *active* one is refused
      // outright (deactivating one is still always allowed; only the
      // one-way archive is guarded). Counts every other active variant of
      // this same offering, excluding the one about to be archived.
      const remaining = await client.query<{ count: string }>(
        `select count(*) from app.item_variants where catalog_item_id=$1 and status='active' and id<>$2`,
        [offeringId, variantId],
      );
      if (Number(remaining.rows[0].count) === 0)
        throw conflict(
          "OFFERING_LAST_VARIANT",
          "This offering must keep at least one active variant",
        );
      const result = await client.query<{ id: string }>(
        `update app.item_variants set status='archived',updated_at=now() where id=$1 and catalog_item_id=$2 and status<>'archived' returning id`,
        [variantId, offeringId],
      );
      if (!result.rows[0])
        throw notFound("VARIANT_NOT_FOUND", "Variant was not found");
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  saveVariantLocalization(
    tenantId: string,
    userId: string,
    offeringId: string,
    variantId: string,
    input: { name: string },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      const variant = await client.query<{ id: string }>(
        `select id from app.item_variants where id=$1 and catalog_item_id=$2`,
        [variantId, offeringId],
      );
      if (!variant.rows[0])
        throw notFound("VARIANT_NOT_FOUND", "Variant was not found");
      await client.query(
        `insert into app.item_variant_localizations(tenant_id,item_variant_id,locale,name)
         values(app.current_tenant_id(),$1,'en',$2)
         on conflict(tenant_id,item_variant_id,locale) do update set name=excluded.name,updated_at=now()`,
        [variantId, input.name || null],
      );
      return { offering: await this.readOffering(client, offeringId) };
    });
  }
  // CSV import/export: a thin orchestration layer over the offering/variant
  // methods above — every row just becomes a call to one of them, so it
  // inherits their guards (canManage, manual-only, SKU uniqueness, last
  // active variant) for free instead of re-implementing any of it here.
  async exportOfferingsCsv(tenantId: string, userId: string): Promise<string> {
    const { products } = await this.get(tenantId, userId);
    const rows: string[][] = [CSV_COLUMNS];
    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.status === "archived") continue;
        rows.push(buildCsvRow(product, variant));
      }
    }
    return stringifyCsv(rows);
  }
  // Two phases, deliberately not one pass with per-row try/catch: a "create"
  // row (empty id_producto/id_variante) is never safe to retry — if a file
  // stopped partway and the admin just re-uploads the same file to pick up
  // where it left off, every create row that already succeeded would create
  // a duplicate product, since the file still has no id for it. Validating
  // every row's action CAN be performed before performing any of them means
  // a bad file is rejected as a whole, with a complete error list in one
  // shot, and re-uploading after fixing it never duplicates anything because
  // nothing was written the first time.
  async importOfferingsCsv(
    tenantId: string,
    userId: string,
    csvText: string,
  ): Promise<CsvImportOutcome> {
    let records: Record<string, string>[];
    try {
      records = parseCsv(csvText, {
        columns: true,
        trim: true,
        skip_empty_lines: true,
        bom: true,
      });
    } catch {
      throw badRequest("CSV_INVALID", "The file is not a valid CSV");
    }
    if (records.length > 5000)
      throw badRequest("CSV_TOO_LARGE", "The file has more than 5000 rows");
    const parseErrors: { row: number; message: string }[] = [];
    const actionRows: { row: number; action: CsvRowAction }[] = [];
    records.forEach((record, index) => {
      const row = index + 2; // header occupies row 1
      try {
        actionRows.push({ row, action: parseCsvRow(record) });
      } catch (error) {
        parseErrors.push({ row, message: csvRowErrorMessage(error) });
      }
    });
    const dbErrors =
      actionRows.length > 0
        ? await this.validateCsvRows(tenantId, userId, actionRows)
        : [];
    const errors = [...parseErrors, ...dbErrors].sort((a, b) => a.row - b.row);
    if (errors.length > 0)
      return { created: 0, updated: 0, archived: 0, errors };
    const outcome: CsvImportOutcome = {
      created: 0,
      updated: 0,
      archived: 0,
      errors: [],
    };
    for (const { row, action: parsed } of actionRows) {
      // Reaching a caught error here should be rare-to-never — every row
      // already passed validateCsvRows above — kept only as a defensive net
      // against a genuine race (e.g. another session editing the same
      // offering between the validate and execute passes), surfaced as a
      // normal per-row error instead of a silent 500.
      try {
        if (parsed.kind === "delete") {
          if (parsed.variantId)
            await this.archiveVariant(
              tenantId,
              userId,
              parsed.offeringId,
              parsed.variantId,
            );
          else await this.archiveOffering(tenantId, userId, parsed.offeringId);
          outcome.archived++;
          continue;
        }
        if (!parsed.offeringId) {
          const { offering } = await this.createOffering(
            tenantId,
            userId,
            parsed.offering,
            parsed.variant,
          );
          if (parsed.offeringTranslation)
            await this.saveOfferingLocalization(
              tenantId,
              userId,
              offering.id,
              parsed.offeringTranslation,
            );
          // The variant just created can't be told apart from any sibling
          // by id without relying on array-position ordering — translating
          // it is deferred to a follow-up row (once export exposes its real
          // id), same limitation noted in the import help text.
          outcome.created++;
          continue;
        }
        await this.updateOffering(
          tenantId,
          userId,
          parsed.offeringId,
          parsed.offering,
        );
        if (parsed.offeringTranslation)
          await this.saveOfferingLocalization(
            tenantId,
            userId,
            parsed.offeringId,
            parsed.offeringTranslation,
          );
        if (parsed.variantId) {
          await this.updateVariant(
            tenantId,
            userId,
            parsed.offeringId,
            parsed.variantId,
            parsed.variant,
          );
          if (parsed.variantTranslation)
            await this.saveVariantLocalization(
              tenantId,
              userId,
              parsed.offeringId,
              parsed.variantId,
              parsed.variantTranslation,
            );
          outcome.updated++;
        } else {
          await this.createVariant(
            tenantId,
            userId,
            parsed.offeringId,
            parsed.variant,
          );
          outcome.created++;
        }
      } catch (error) {
        outcome.errors.push({ row, message: csvRowErrorMessage(error) });
      }
    }
    return outcome;
  }
  // Read-only pre-flight for every parsed row: everything the real
  // create/update/archive methods would themselves reject, checked here
  // without writing anything, so importOfferingsCsv can refuse a bad file
  // as a whole instead of applying part of it. Deliberately duplicates each
  // guard's condition (manual-only, SKU uniqueness, last active variant)
  // rather than calling the real methods — those methods write on success,
  // which is exactly what this pass must not do.
  private async validateCsvRows(
    tenantId: string,
    userId: string,
    rows: { row: number; action: CsvRowAction }[],
  ): Promise<{ row: number; message: string }[]> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage offerings");
      const errors: { row: number; message: string }[] = [];
      const skuFirstSeenAtRow = new Map<string, number>();
      for (const { row, action } of rows) {
        const offeringId = action.offeringId;
        if (offeringId) {
          const item = await client.query<{ source_provider: string }>(
            `select source_provider from app.catalog_items where id=$1 and status<>'archived'`,
            [offeringId],
          );
          if (!item.rows[0]) {
            errors.push({ row, message: "Offering was not found" });
            continue;
          }
          if (item.rows[0].source_provider !== "manual") {
            errors.push({
              row,
              message:
                "Externally synchronized offerings must be edited at their source",
            });
            continue;
          }
        }
        const variantId = action.variantId;
        if (variantId) {
          const variant = await client.query<{ id: string }>(
            `select id from app.item_variants where id=$1 and catalog_item_id=$2 and status<>'archived'`,
            [variantId, offeringId],
          );
          if (!variant.rows[0]) {
            errors.push({ row, message: "Variant was not found" });
            continue;
          }
        }
        if (action.kind === "delete") {
          if (variantId) {
            const remaining = await client.query<{ count: string }>(
              `select count(*) from app.item_variants where catalog_item_id=$1 and status='active' and id<>$2`,
              [offeringId, variantId],
            );
            if (Number(remaining.rows[0].count) === 0)
              errors.push({
                row,
                message: "This offering must keep at least one active variant",
              });
          }
          continue;
        }
        const sku = action.variant.sku;
        if (!sku) continue;
        const firstRow = skuFirstSeenAtRow.get(sku);
        if (firstRow) {
          errors.push({
            row,
            message: `sku duplicado con la fila ${firstRow}: "${sku}"`,
          });
          continue;
        }
        skuFirstSeenAtRow.set(sku, row);
        const collision = await client.query<{ id: string }>(
          `select id from app.item_variants where sku=$1 and status<>'archived' and ($2::uuid is null or id<>$2)`,
          [sku, variantId ?? null],
        );
        if (collision.rows[0])
          errors.push({
            row,
            message: "This SKU is already used by another variant",
          });
      }
      return errors;
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
      return { entry: { ...result.rows[0], translations: await this.entryTranslations(client, entryId) } };
    });
  }
  saveEntryLocalization(
    tenantId: string,
    userId: string,
    entryId: string,
    input: { title: string; content: string },
  ) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      if (!(await this.canManage(client, userId)))
        throw forbidden("KNOWLEDGE_FORBIDDEN", "Actor cannot manage business knowledge");
      await client.query(
        `insert into app.knowledge_entry_localizations(tenant_id,knowledge_entry_id,locale,title,content)
         values(app.current_tenant_id(),$1,'en',$2,$3)
         on conflict(tenant_id,knowledge_entry_id,locale) do update set
           title=excluded.title,content=excluded.content,updated_at=now()`,
        [entryId, input.title || null, input.content || null],
      );
      const entry = await client.query(
        `select id,kind,title,content,status,coalesce(keywords,'{}') as keywords from app.knowledge_entries where id=$1`,
        [entryId],
      );
      if (!entry.rows[0])
        throw notFound("KNOWLEDGE_ENTRY_NOT_FOUND", "Published answer was not found");
      return { entry: { ...entry.rows[0], translations: await this.entryTranslations(client, entryId) } };
    });
  }
  private async entryTranslations(client: PoolClient, entryId: string) {
    const row = (
      await client.query<{ title: string | null; content: string | null }>(
        `select title,content from app.knowledge_entry_localizations where knowledge_entry_id=$1 and locale='en'`,
        [entryId],
      )
    ).rows[0];
    return { en: { title: row?.title ?? "", content: row?.content ?? "" } };
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
    const itemLoc = (
      await client.query<{ name: string | null; description: string | null }>(
        `select name,description from app.catalog_item_localizations where catalog_item_id=$1 and locale='en'`,
        [id],
      )
    ).rows[0];
    const variantLoc = new Map(
      (
        await client.query<{ item_variant_id: string; name: string | null }>(
          `select item_variant_id,name from app.item_variant_localizations where item_variant_id=any($1) and locale='en'`,
          [variants.map((variant: { id: string }) => variant.id)],
        )
      ).rows.map((row) => [row.item_variant_id, row.name]),
    );
    return {
      ...item,
      sourceProvider: item.source_provider,
      offeringType: item.offering_type,
      durationMinutes: item.duration_minutes,
      bookingRequired: item.booking_required,
      translations: {
        en: { name: itemLoc?.name ?? "", description: itemLoc?.description ?? "" },
      },
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
        translations: { en: { name: variantLoc.get(variant.id) ?? "" } },
      })),
    };
  }
}
function isPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}

// One row = one variant, product columns repeated per row (same shape
// Magento's own product import uses) — every row is self-contained and
// never depends on the order or presence of any other row.
export const CSV_COLUMNS = [
  "id_producto",
  "id_variante",
  "accion",
  "nombre_producto",
  "descripcion_producto",
  "categoria",
  "tipo",
  "estado_producto",
  "duracion_minutos",
  "requiere_reserva",
  "nombre_variante",
  "sku",
  "precio",
  "moneda",
  "disponibilidad",
  "estado_variante",
  "nombre_producto_en",
  "descripcion_producto_en",
  "nombre_variante_en",
];
const CSV_OFFERING_TYPES = [
  "product",
  "service",
  "prepared_product",
  "appointment",
  "package",
];
const CSV_STATUSES = ["active", "inactive"];

type CsvOffering = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  offeringType: string;
  status: string;
  durationMinutes: number | null;
  bookingRequired: boolean;
  translations: { en: { name: string; description: string } };
};
type CsvVariant = {
  id: string;
  name: string;
  sku: string | null;
  status: string;
  priceMinor: number;
  currency: string;
  availabilityStatus: string;
  translations: { en: { name: string } };
};
type CsvRowAction =
  | { kind: "delete"; offeringId: string; variantId: string | null }
  | {
      kind: "upsert";
      offeringId: string | null;
      variantId: string | null;
      offering: OfferingInput;
      variant: VariantInput;
      offeringTranslation: { name: string; description: string } | null;
      variantTranslation: { name: string } | null;
    };
export type CsvImportOutcome = {
  created: number;
  updated: number;
  archived: number;
  errors: { row: number; message: string }[];
};

export function buildCsvRow(product: CsvOffering, variant: CsvVariant): string[] {
  return [
    product.id,
    variant.id,
    "",
    product.name,
    product.description ?? "",
    product.category ?? "",
    product.offeringType,
    product.status,
    product.durationMinutes === null ? "" : String(product.durationMinutes),
    product.bookingRequired ? "true" : "false",
    variant.name,
    variant.sku ?? "",
    (variant.priceMinor / 100).toString(),
    variant.currency,
    variant.availabilityStatus,
    variant.status,
    product.translations.en.name,
    product.translations.en.description,
    variant.translations.en.name,
  ];
}
// Template constant is built with the same stringifyCsv() the real import
// reads, so its separator/quoting always matches what the parser expects —
// never hand-typed CSV text that could silently drift from the real format.
export const IMPORT_TEMPLATE_CSV = stringifyCsv([
  CSV_COLUMNS,
  [
    "", "", "", "Camiseta básica", "Camiseta de algodón 100%", "ropa",
    "product", "active", "", "false", "Talla M", "", "45000", "COP",
    "available", "active", "Basic T-shirt", "100% cotton T-shirt", "Size M",
  ],
  [
    "", "", "", "Camiseta básica", "Camiseta de algodón 100%", "ropa",
    "product", "active", "", "false", "Talla L", "", "45000", "COP",
    "available", "active", "Basic T-shirt", "100% cotton T-shirt", "Size L",
  ],
  [
    "", "", "", "Corte de cabello", "Corte y peinado", "servicios",
    "service", "active", "30", "true", "Sesión estándar", "", "25000", "COP",
    "available", "active", "Haircut", "Cut and styling", "Standard session",
  ],
]);

function csvField(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim();
}
function csvBoolean(value: string): boolean {
  return ["true", "si", "sí", "1", "yes"].includes(value.toLowerCase());
}
function csvRequire(value: string, field: string): string {
  if (!value) throw new Error(`${field} es obligatorio`);
  return value;
}
// The write half of the CSV orchestration layer: turns one already-parsed
// CSV row into the exact input shape the existing create/update/archive
// methods expect, doing the same field-level validation parseOffering()/
// parseVariant() (knowledge.controller.ts) do for the JSON API — duplicated
// here rather than shared, since the CSV row shape (strings, extra id/
// accion columns) doesn't line up cleanly with the JSON body shape those
// parse.
export function parseCsvRow(row: Record<string, string>): CsvRowAction {
  const offeringId = csvField(row, "id_producto") || null;
  const variantId = csvField(row, "id_variante") || null;
  const action = csvField(row, "accion").toLowerCase();
  if (variantId && !offeringId)
    throw new Error("id_variante requiere id_producto en la misma fila");
  if (action === "eliminar") {
    if (!offeringId)
      throw new Error(
        "accion=eliminar requiere id_producto (y opcionalmente id_variante)",
      );
    return { kind: "delete", offeringId, variantId };
  }
  if (action)
    throw new Error(
      `accion desconocida: "${action}" (deja vacío o usa "eliminar")`,
    );
  const offeringType = csvRequire(csvField(row, "tipo"), "tipo");
  if (!CSV_OFFERING_TYPES.includes(offeringType))
    throw new Error(`tipo inválido: "${offeringType}"`);
  const offeringStatus = csvRequire(
    csvField(row, "estado_producto"),
    "estado_producto",
  );
  if (!CSV_STATUSES.includes(offeringStatus))
    throw new Error(`estado_producto inválido: "${offeringStatus}"`);
  const durationRaw = csvField(row, "duracion_minutos");
  const durationMinutes = durationRaw === "" ? null : Number(durationRaw);
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      durationMinutes > 10080)
  )
    throw new Error(`duracion_minutos inválido: "${durationRaw}"`);
  const variantStatus = csvRequire(
    csvField(row, "estado_variante"),
    "estado_variante",
  );
  if (!CSV_STATUSES.includes(variantStatus))
    throw new Error(`estado_variante inválido: "${variantStatus}"`);
  const currency = csvRequire(csvField(row, "moneda"), "moneda").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error(`moneda inválida: "${currency}"`);
  const priceRaw = csvRequire(csvField(row, "precio"), "precio");
  const priceNumber = Number(priceRaw);
  if (!Number.isFinite(priceNumber) || priceNumber < 0)
    throw new Error(`precio inválido: "${priceRaw}"`);
  const priceMinor = Math.round(priceNumber * 100);
  if (!Number.isSafeInteger(priceMinor) || priceMinor > 999999999999)
    throw new Error(`precio inválido: "${priceRaw}"`);
  const offering: OfferingInput = {
    name: csvRequire(csvField(row, "nombre_producto"), "nombre_producto"),
    description: csvField(row, "descripcion_producto"),
    category: csvField(row, "categoria"),
    offeringType: offeringType as OfferingInput["offeringType"],
    status: offeringStatus as OfferingInput["status"],
    durationMinutes,
    bookingRequired: csvBoolean(csvField(row, "requiere_reserva")),
  };
  const variant: VariantInput = {
    name: csvRequire(csvField(row, "nombre_variante"), "nombre_variante"),
    sku: csvField(row, "sku") || null,
    priceMinor,
    currency,
    status: variantStatus as VariantInput["status"],
    availabilityStatus:
      csvField(row, "disponibilidad") === "unavailable"
        ? "unavailable"
        : "available",
  };
  const nameEn = csvField(row, "nombre_producto_en");
  const descriptionEn = csvField(row, "descripcion_producto_en");
  const variantNameEn = csvField(row, "nombre_variante_en");
  return {
    kind: "upsert",
    offeringId,
    variantId,
    offering,
    variant,
    offeringTranslation:
      nameEn || descriptionEn
        ? { name: nameEn, description: descriptionEn }
        : null,
    variantTranslation: variantNameEn ? { name: variantNameEn } : null,
  };
}
function csvRowErrorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && response && "message" in response)
      return String((response as { message: unknown }).message);
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Error desconocido";
}
