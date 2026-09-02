import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { validate as uuid } from "uuid";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { PasswordReadyGuard } from "../auth/password-ready.guard";
import { badRequest } from "../observability/http-errors";
import { RequirementDataType } from "../commerce-events/requirement-loop";
import {
  OperationalRequirementsService,
  OperationType,
  RequirementInput,
} from "./operational-requirements.service";

@Controller("v1/admin/tenants/:tenantId/operational-requirements")
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class OperationalRequirementsController {
  constructor(private readonly service: OperationalRequirementsService) {}

  @Get() list(@Param("tenantId") id: string) {
    valid(id);
    return this.service.list(id);
  }
  @Post() create(@Param("tenantId") id: string, @Body() body: unknown) {
    valid(id);
    return this.service.create(id, parseRequirement(body));
  }
  @Patch(":requirementId") update(
    @Param("tenantId") id: string,
    @Param("requirementId") requirementId: string,
    @Body() body: unknown,
  ) {
    valid(id);
    valid(requirementId);
    return this.service.update(id, requirementId, parsePartialRequirement(body));
  }
  @Patch(":requirementId/active") setActive(
    @Param("tenantId") id: string,
    @Param("requirementId") requirementId: string,
    @Body() body: unknown,
  ) {
    valid(id);
    valid(requirementId);
    const value = body as { active?: unknown };
    if (typeof value?.active !== "boolean")
      throw badRequest("VALIDATION_ERROR", "active must be boolean");
    return this.service.setActive(id, requirementId, value.active);
  }
  @Put(":requirementId/localizations/:locale") setLocalization(
    @Param("tenantId") id: string,
    @Param("requirementId") requirementId: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ) {
    valid(id);
    valid(requirementId);
    const value = body as { label?: unknown; helpText?: unknown };
    const label = typeof value?.label === "string" ? value.label : "";
    const helpText =
      typeof value?.helpText === "string" && value.helpText.trim()
        ? value.helpText.trim()
        : null;
    return this.service.setLocalization(id, requirementId, locale, label, helpText);
  }
  @Put(":requirementId/options") setOptions(
    @Param("tenantId") id: string,
    @Param("requirementId") requirementId: string,
    @Body() body: unknown,
  ) {
    valid(id);
    valid(requirementId);
    return this.service.setOptions(id, requirementId, parseOptions(body));
  }
  @Put(":requirementId/options/:optionValue/localizations/:locale") setOptionLocalization(
    @Param("tenantId") id: string,
    @Param("requirementId") requirementId: string,
    @Param("optionValue") optionValue: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ) {
    valid(id);
    valid(requirementId);
    const value = body as { label?: unknown };
    const label = typeof value?.label === "string" ? value.label : "";
    return this.service.setOptionLocalization(id, requirementId, optionValue, locale, label);
  }
}

function valid(value: string) {
  if (!uuid(value)) throw badRequest("VALIDATION_ERROR", "id must be UUID");
}

const operationTypes: OperationType[] = ["order", "appointment", "service", "quote"];
const dataTypes: RequirementDataType[] = [
  "text",
  "number",
  "select",
  "boolean",
  "address",
  "phone",
];
const sensitivities = ["none", "pii", "sensitive"];

function parseRequirement(body: unknown): RequirementInput {
  const value = body as Record<string, unknown>;
  if (!value || typeof value !== "object")
    throw badRequest("VALIDATION_ERROR", "Invalid requirement");
  const operationType = value.operationType;
  const dataType = value.dataType;
  const sensitivity =
    typeof value.sensitivity === "string" ? value.sensitivity : "none";
  const fulfillmentType =
    typeof value.fulfillmentType === "string" ? value.fulfillmentType.trim() : "";
  const fieldKey = typeof value.fieldKey === "string" ? value.fieldKey.trim() : "";
  if (
    !operationTypes.includes(operationType as OperationType) ||
    !dataTypes.includes(dataType as RequirementDataType) ||
    !sensitivities.includes(sensitivity) ||
    !fulfillmentType ||
    !fieldKey
  )
    throw badRequest("VALIDATION_ERROR", "Invalid requirement values");
  return {
    operationType: operationType as OperationType,
    fulfillmentType,
    catalogItemId:
      typeof value.catalogItemId === "string" ? value.catalogItemId : null,
    fieldKey,
    dataType: dataType as RequirementDataType,
    isRequired: value.isRequired !== false,
    displayOrder: Number.isInteger(value.displayOrder)
      ? (value.displayOrder as number)
      : 0,
    validationRule:
      value.validationRule && typeof value.validationRule === "object"
        ? (value.validationRule as Record<string, unknown>)
        : {},
    sensitivity: sensitivity as "none" | "pii" | "sensitive",
    retentionDays: Number.isInteger(value.retentionDays)
      ? (value.retentionDays as number)
      : null,
    requiresConfirmation: value.requiresConfirmation === true,
  };
}

function parsePartialRequirement(body: unknown): Partial<RequirementInput> {
  const value = body as Record<string, unknown>;
  if (!value || typeof value !== "object")
    throw badRequest("VALIDATION_ERROR", "Invalid requirement");
  const partial: Partial<RequirementInput> = {};
  if (typeof value.fulfillmentType === "string")
    partial.fulfillmentType = value.fulfillmentType.trim();
  if (typeof value.catalogItemId === "string" || value.catalogItemId === null)
    partial.catalogItemId = value.catalogItemId as string | null;
  if (dataTypes.includes(value.dataType as RequirementDataType))
    partial.dataType = value.dataType as RequirementDataType;
  if (typeof value.isRequired === "boolean")
    partial.isRequired = value.isRequired;
  if (Number.isInteger(value.displayOrder))
    partial.displayOrder = value.displayOrder as number;
  if (value.validationRule && typeof value.validationRule === "object")
    partial.validationRule = value.validationRule as Record<string, unknown>;
  if (sensitivities.includes(value.sensitivity as string))
    partial.sensitivity = value.sensitivity as "none" | "pii" | "sensitive";
  if (Number.isInteger(value.retentionDays) || value.retentionDays === null)
    partial.retentionDays = value.retentionDays as number | null;
  if (typeof value.requiresConfirmation === "boolean")
    partial.requiresConfirmation = value.requiresConfirmation;
  return partial;
}

function parseOptions(body: unknown) {
  const value = body as { options?: unknown };
  if (!Array.isArray(value?.options))
    throw badRequest("VALIDATION_ERROR", "options must be an array");
  return value.options.map((option, index) => {
    const item = option as Record<string, unknown>;
    const optionValue =
      typeof item?.value === "string" ? item.value.trim() : "";
    if (!optionValue)
      throw badRequest("VALIDATION_ERROR", "Each option needs a value");
    return {
      value: optionValue,
      displayOrder: Number.isInteger(item.displayOrder)
        ? (item.displayOrder as number)
        : index,
    };
  });
}
