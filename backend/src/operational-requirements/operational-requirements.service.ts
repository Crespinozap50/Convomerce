import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import { badRequest, conflict, notFound } from "../observability/http-errors";
import { languageFor } from "../localization/localization";
import {
  PendingRequirement,
  RequirementDataType,
} from "../commerce-events/requirement-loop";

export type OperationType = "order" | "appointment" | "service" | "quote";

export type RequirementInput = {
  operationType: OperationType;
  fulfillmentType: string;
  catalogItemId: string | null;
  fieldKey: string;
  dataType: RequirementDataType;
  isRequired: boolean;
  displayOrder: number;
  validationRule: Record<string, unknown>;
  sensitivity: "none" | "pii" | "sensitive";
  retentionDays: number | null;
  requiresConfirmation: boolean;
};

export type RequirementDto = RequirementInput & {
  id: string;
  reuseFromContactMemory: boolean;
  isActive: boolean;
  localizations: { locale: string; label: string; helpText: string | null }[];
  options: {
    optionValue: string;
    displayOrder: number;
    localizations: { locale: string; label: string }[];
  }[];
};

const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;

interface PendingRequirementRow {
  id: string;
  field_key: string;
  data_type: RequirementDataType;
  is_required: boolean;
  display_order: number;
  validation_rule: Record<string, unknown> | null;
  sensitivity: "none" | "pii" | "sensitive";
  requires_confirmation: boolean;
  reuse_from_contact_memory: boolean;
  label: string | null;
  help_text: string | null;
  options: { value: string; label: string }[] | null;
}

interface RequirementRow {
  id: string;
  operation_type: OperationType;
  fulfillment_type: string;
  catalog_item_id: string | null;
  field_key: string;
  data_type: RequirementDataType;
  is_required: boolean;
  display_order: number;
  validation_rule: Record<string, unknown> | null;
  sensitivity: "none" | "pii" | "sensitive";
  retention_days: number | null;
  requires_confirmation: boolean;
  reuse_from_contact_memory: boolean;
  is_active: boolean;
}
// Field keys the two hardcoded static locale catalogs already know how to
// prompt for (see CommercialFlowService.requirementPrompt). Any other field
// key has no built-in copy, so it must carry an admin-configured localization
// before it can be activated — see setActive below.
const builtinFieldKeys = new Set(["name", "delivery_address"]);

@Injectable()
export class OperationalRequirementsService {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string): Promise<RequirementDto[]> {
    return this.db.withTenantTransaction(tenantId, (client) =>
      this.readAll(client),
    );
  }

  create(tenantId: string, input: RequirementInput): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      this.validateInput(input);
      if (builtinFieldKeys.has(input.fieldKey))
        throw conflict(
          "REQUIREMENT_RESERVED_FIELD_KEY",
          `${input.fieldKey} is a built-in field key managed by the platform`,
        );
      const id = uuidv7();
      await client.query(
        `insert into app.operational_requirements
          (id,tenant_id,operation_type,fulfillment_type,catalog_item_id,field_key,data_type,
           is_required,display_order,validation_rule,sensitivity,retention_days,requires_confirmation,
           is_active)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,false)`,
        [
          id,
          tenantId,
          input.operationType,
          input.fulfillmentType,
          input.catalogItemId,
          input.fieldKey,
          input.dataType,
          input.isRequired,
          input.displayOrder,
          JSON.stringify(input.validationRule ?? {}),
          input.sensitivity,
          input.retentionDays,
          input.requiresConfirmation,
        ],
      );
      return this.readOne(client, id);
    });
  }

  update(
    tenantId: string,
    id: string,
    input: Partial<RequirementInput>,
  ): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const current = await this.readOne(client, id);
      const merged: RequirementInput = { ...current, ...input };
      this.validateInput(merged);
      await client.query(
        `update app.operational_requirements
         set fulfillment_type=$2,catalog_item_id=$3,data_type=$4,is_required=$5,
             display_order=$6,validation_rule=$7::jsonb,sensitivity=$8,retention_days=$9,
             requires_confirmation=$10,updated_at=now()
         where id=$1`,
        [
          id,
          merged.fulfillmentType,
          merged.catalogItemId,
          merged.dataType,
          merged.isRequired,
          merged.displayOrder,
          JSON.stringify(merged.validationRule ?? {}),
          merged.sensitivity,
          merged.retentionDays,
          merged.requiresConfirmation,
        ],
      );
      return this.readOne(client, id);
    });
  }

  setActive(
    tenantId: string,
    id: string,
    active: boolean,
  ): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const current = await this.readOne(client, id);
      if (active && !builtinFieldKeys.has(current.fieldKey)) {
        const baseLocale = await client.query<{ locale: string }>(
          `select locale from app.bot_configurations limit 1`,
        );
        const language = languageFor(baseLocale.rows[0]?.locale);
        const hasLabel = current.localizations.some(
          (localization) => languageFor(localization.locale) === language,
        );
        if (!hasLabel)
          throw badRequest(
            "REQUIREMENT_MISSING_LOCALIZATION",
            `Requirement ${current.fieldKey} needs a localization for the tenant's base locale before activation`,
          );
        if (current.dataType === "select" && current.options.length === 0)
          throw badRequest(
            "REQUIREMENT_MISSING_OPTIONS",
            `Select requirement ${current.fieldKey} needs at least one option before activation`,
          );
      }
      await client.query(
        `update app.operational_requirements set is_active=$2,updated_at=now() where id=$1`,
        [id, active],
      );
      return this.readOne(client, id);
    });
  }

  setLocalization(
    tenantId: string,
    id: string,
    locale: string,
    label: string,
    helpText: string | null,
  ): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      await this.readOne(client, id);
      if (!label.trim())
        throw badRequest("VALIDATION_ERROR", "label is required");
      await client.query(
        `insert into app.operational_requirement_localizations
          (requirement_id,tenant_id,locale,label,help_text)
         values($1,$2,$3,$4,$5)
         on conflict(requirement_id,locale)
         do update set label=excluded.label,help_text=excluded.help_text,updated_at=now()`,
        [id, tenantId, locale, label.trim(), helpText],
      );
      return this.readOne(client, id);
    });
  }

  setOptionLocalization(
    tenantId: string,
    id: string,
    optionValue: string,
    locale: string,
    label: string,
  ): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const current = await this.readOne(client, id);
      if (!current.options.some((option) => option.optionValue === optionValue))
        throw notFound("REQUIREMENT_OPTION_NOT_FOUND", "Option was not found");
      if (!label.trim())
        throw badRequest("VALIDATION_ERROR", "label is required");
      await client.query(
        `insert into app.operational_requirement_option_localizations
          (requirement_id,option_value,tenant_id,locale,label)
         values($1,$2,$3,$4,$5)
         on conflict(requirement_id,option_value,locale)
         do update set label=excluded.label`,
        [id, optionValue, tenantId, locale, label.trim()],
      );
      return this.readOne(client, id);
    });
  }

  setOptions(
    tenantId: string,
    id: string,
    options: { value: string; displayOrder: number }[],
  ): Promise<RequirementDto> {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const current = await this.readOne(client, id);
      if (current.dataType !== "select")
        throw badRequest(
          "VALIDATION_ERROR",
          "Options only apply to select requirements",
        );
      // Only delete options that are actually being removed, and upsert the
      // rest in place. A blind delete-then-reinsert of every option (even
      // ones whose value is unchanged) would cascade-delete their per-locale
      // labels in operational_requirement_option_localizations, silently
      // wiping labels for options nobody asked to change.
      const keepValues = options.map((option) => option.value);
      await client.query(
        `delete from app.operational_requirement_options
         where requirement_id=$1 and option_value<>all($2::text[])`,
        [id, keepValues],
      );
      for (const option of options)
        await client.query(
          `insert into app.operational_requirement_options
            (requirement_id,tenant_id,option_value,display_order)
           values($1,$2,$3,$4)
           on conflict(requirement_id,option_value)
           do update set display_order=excluded.display_order`,
          [id, tenantId, option.value, option.displayOrder],
        );
      return this.readOne(client, id);
    });
  }

  // Runtime lookup consumed by CommercialFlowService/AppointmentFlowService
  // inside their own already-open tenant transaction. tenantId is accepted
  // for call-site clarity even though RLS (already set on `client`) is what
  // actually enforces isolation here, matching the rest of this codebase's
  // convention of trusting RLS over redundant application-level filters.
  async getPendingRequirements(
    client: PoolClient,
    _tenantId: string,
    operationType: OperationType,
    fulfillmentType: string | null,
    alreadyFilledFieldKeys: string[],
    locale: string,
    catalogItemId: string | null = null,
  ): Promise<PendingRequirement[]> {
    const language = languageFor(locale);
    const result = await client.query(
      `select r.id,r.field_key,r.data_type,r.is_required,r.display_order,
              r.validation_rule,r.sensitivity,r.requires_confirmation,r.reuse_from_contact_memory,
              loc.label,loc.help_text,
              coalesce(
                (select json_agg(json_build_object(
                    'value',opt.option_value,
                    'label',coalesce(optloc.label,opt.option_value)
                  ) order by opt.display_order)
                 from app.operational_requirement_options opt
                 left join app.operational_requirement_option_localizations optloc
                   on optloc.requirement_id=opt.requirement_id
                  and optloc.option_value=opt.option_value
                  and optloc.locale=$5
                 where opt.requirement_id=r.id),
                '[]'::json
              ) as options
       from app.operational_requirements r
       left join app.operational_requirement_localizations loc
         on loc.requirement_id=r.id and loc.locale=$5
       where r.operation_type=$1
         and r.is_active and r.is_required
         and (
           ($2::text is null and r.fulfillment_type='*')
           or ($2::text is not null and r.fulfillment_type in ($2,'*'))
         )
         and r.field_key<>all($3::text[])
         and (r.catalog_item_id=$4 or r.catalog_item_id is null)
       order by r.display_order,r.field_key`,
      [operationType, fulfillmentType, alreadyFilledFieldKeys, catalogItemId, language],
    );
    return result.rows.map(this.toPendingRequirement);
  }

  private toPendingRequirement(row: PendingRequirementRow): PendingRequirement {
    return {
      id: row.id,
      fieldKey: row.field_key,
      dataType: row.data_type,
      isRequired: row.is_required,
      displayOrder: row.display_order,
      validationRule: row.validation_rule ?? {},
      sensitivity: row.sensitivity,
      requiresConfirmation: row.requires_confirmation,
      reuseFromContactMemory: row.reuse_from_contact_memory,
      label: row.label,
      helpText: row.help_text,
      options: row.options ?? [],
    };
  }

  private async readAll(client: PoolClient): Promise<RequirementDto[]> {
    const result = await client.query(
      `select id,operation_type,fulfillment_type,catalog_item_id,field_key,data_type,
              is_required,display_order,validation_rule,sensitivity,retention_days,
              requires_confirmation,reuse_from_contact_memory,is_active
       from app.operational_requirements
       order by operation_type,fulfillment_type,display_order,field_key`,
    );
    return Promise.all(
      result.rows.map((row) => this.attachChildren(client, row)),
    );
  }

  private async readOne(
    client: PoolClient,
    id: string,
  ): Promise<RequirementDto> {
    const result = await client.query(
      `select id,operation_type,fulfillment_type,catalog_item_id,field_key,data_type,
              is_required,display_order,validation_rule,sensitivity,retention_days,
              requires_confirmation,reuse_from_contact_memory,is_active
       from app.operational_requirements where id=$1`,
      [id],
    );
    if (!result.rows[0])
      throw notFound(
        "REQUIREMENT_NOT_FOUND",
        "Operational requirement was not found",
      );
    return this.attachChildren(client, result.rows[0]);
  }

  private async attachChildren(
    client: PoolClient,
    row: RequirementRow,
  ): Promise<RequirementDto> {
    const [localizations, options] = await Promise.all([
      client.query(
        `select locale,label,help_text from app.operational_requirement_localizations where requirement_id=$1 order by locale`,
        [row.id],
      ),
      client.query(
        `select option_value,display_order from app.operational_requirement_options where requirement_id=$1 order by display_order`,
        [row.id],
      ),
    ]);
    const optionsWithLocalizations = await Promise.all(
      options.rows.map(async (option) => {
        const optionLocalizations = await client.query(
          `select locale,label from app.operational_requirement_option_localizations where requirement_id=$1 and option_value=$2 order by locale`,
          [row.id, option.option_value],
        );
        return {
          optionValue: option.option_value,
          displayOrder: option.display_order,
          localizations: optionLocalizations.rows.map((localization) => ({
            locale: localization.locale,
            label: localization.label,
          })),
        };
      }),
    );
    return {
      id: row.id,
      operationType: row.operation_type,
      fulfillmentType: row.fulfillment_type,
      catalogItemId: row.catalog_item_id,
      fieldKey: row.field_key,
      dataType: row.data_type,
      isRequired: row.is_required,
      displayOrder: row.display_order,
      validationRule: row.validation_rule ?? {},
      sensitivity: row.sensitivity,
      retentionDays: row.retention_days,
      requiresConfirmation: row.requires_confirmation,
      reuseFromContactMemory: row.reuse_from_contact_memory,
      isActive: row.is_active,
      localizations: localizations.rows.map((localization) => ({
        locale: localization.locale,
        label: localization.label,
        helpText: localization.help_text,
      })),
      options: optionsWithLocalizations,
    };
  }

  private validateInput(input: RequirementInput) {
    const operationTypes: OperationType[] = [
      "order",
      "appointment",
      "service",
      "quote",
    ];
    const dataTypes: RequirementDataType[] = [
      "text",
      "number",
      "select",
      "boolean",
      "address",
      "phone",
    ];
    const sensitivities = ["none", "pii", "sensitive"];
    if (!operationTypes.includes(input.operationType))
      throw badRequest("VALIDATION_ERROR", "Invalid operationType");
    if (!input.fulfillmentType || typeof input.fulfillmentType !== "string")
      throw badRequest("VALIDATION_ERROR", "fulfillmentType is required");
    if (!fieldKeyPattern.test(input.fieldKey))
      throw badRequest(
        "VALIDATION_ERROR",
        "fieldKey must be lowercase snake_case",
      );
    if (!dataTypes.includes(input.dataType))
      throw badRequest("VALIDATION_ERROR", "Invalid dataType");
    if (!sensitivities.includes(input.sensitivity))
      throw badRequest("VALIDATION_ERROR", "Invalid sensitivity");
    if (
      input.retentionDays !== null &&
      (!Number.isInteger(input.retentionDays) || input.retentionDays <= 0)
    )
      throw badRequest("VALIDATION_ERROR", "Invalid retentionDays");
    if (!input.validationRule || typeof input.validationRule !== "object")
      throw badRequest("VALIDATION_ERROR", "validationRule must be an object");
  }
}
