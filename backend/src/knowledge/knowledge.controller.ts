import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { validate as uuid } from "uuid";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { PasswordReadyGuard } from "../auth/password-ready.guard";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { badRequest } from "../observability/http-errors";
import {
  capabilityNames,
  CapabilityName,
  KnowledgeService,
  OfferingInput,
  ProfileInput,
  VariantInput,
} from "./knowledge.service";

@Controller("v1/admin/tenants/:tenantId/knowledge")
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}
  @Get() get(
    @Param("tenantId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.get(id, request.actor.userId);
  }
  @Put("profile") save(
    @Param("tenantId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.save(id, request.actor.userId, parseProfile(body));
  }
  @Put("profile/localizations/en") saveProfileLocalization(
    @Param("tenantId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.saveProfileLocalization(
      id,
      request.actor.userId,
      parseProfileLocalization(body),
    );
  }
  @Put("capabilities") saveCapabilities(
    @Param("tenantId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.saveCapabilities(
      id,
      request.actor.userId,
      parseCapabilities(body),
    );
  }
  @Post("offerings") createOffering(
    @Param("tenantId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    const { offering, variant } = parseCreateOffering(body);
    return this.service.createOffering(
      id,
      request.actor.userId,
      offering,
      variant,
    );
  }
  @Patch("offerings/:offeringId") updateOffering(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    return this.service.updateOffering(
      id,
      request.actor.userId,
      offeringId,
      parseOffering(body),
    );
  }
  @Put("offerings/:offeringId/localizations/en") saveOfferingLocalization(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    return this.service.saveOfferingLocalization(
      id,
      request.actor.userId,
      offeringId,
      parseOfferingLocalization(body),
    );
  }
  @Delete("offerings/:offeringId") archiveOffering(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    return this.service.archiveOffering(id, request.actor.userId, offeringId);
  }
  // D-142: nested under a specific offering, same "prefix:value" nested
  // resource shape modifier-groups.controller.ts already uses for
  // groupId/optionId — lets a manual offering carry more than one priced
  // variant from the admin panel instead of requiring raw SQL.
  @Post("offerings/:offeringId/variants") createVariant(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    return this.service.createVariant(
      id,
      request.actor.userId,
      offeringId,
      parseVariant(body),
    );
  }
  @Patch("offerings/:offeringId/variants/:variantId") updateVariant(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Param("variantId") variantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    valid(variantId);
    return this.service.updateVariant(
      id,
      request.actor.userId,
      offeringId,
      variantId,
      parseVariant(body),
    );
  }
  @Delete("offerings/:offeringId/variants/:variantId") archiveVariant(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Param("variantId") variantId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    valid(variantId);
    return this.service.archiveVariant(
      id,
      request.actor.userId,
      offeringId,
      variantId,
    );
  }
  @Put("offerings/:offeringId/variants/:variantId/localizations/en") saveVariantLocalization(
    @Param("tenantId") id: string,
    @Param("offeringId") offeringId: string,
    @Param("variantId") variantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(offeringId);
    valid(variantId);
    return this.service.saveVariantLocalization(
      id,
      request.actor.userId,
      offeringId,
      variantId,
      parseVariantLocalization(body),
    );
  }
  @Post("unresolved/:questionId/review") review(
    @Param("tenantId") id: string,
    @Param("questionId") questionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(questionId);
    return this.service.review(
      id,
      request.actor.userId,
      questionId,
      parseReview(body),
    );
  }
  @Patch("entries/:entryId") updateEntry(
    @Param("tenantId") id: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(entryId);
    return this.service.updateEntry(
      id,
      request.actor.userId,
      entryId,
      parseEntry(body),
    );
  }
  @Put("entries/:entryId/localizations/en") saveEntryLocalization(
    @Param("tenantId") id: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(entryId);
    return this.service.saveEntryLocalization(
      id,
      request.actor.userId,
      entryId,
      parseEntryLocalization(body),
    );
  }
  @Delete("entries/:entryId") archiveEntry(
    @Param("tenantId") id: string,
    @Param("entryId") entryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(entryId);
    return this.service.archiveEntry(id, request.actor.userId, entryId);
  }
  @Patch("response-variants/:variantId") reviewResponseVariant(
    @Param("tenantId") id: string,
    @Param("variantId") variantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(variantId);
    return this.service.reviewResponseVariant(
      id,
      request.actor.userId,
      variantId,
      parseResponseVariantReview(body),
    );
  }
}

function valid(value: string) {
  if (!uuid(value))
    throw badRequest("VALIDATION_ERROR", "tenantId must be UUID");
}
function parseProfile(body: unknown): ProfileInput {
  if (!body || typeof body !== "object")
    throw badRequest("VALIDATION_ERROR", "Invalid profile");
  const value = body as Record<string, unknown>;
  const string = (item: unknown) =>
    typeof item === "string" ? item.trim() : "";
  return {
    description: string(value.description),
    address: string(value.address),
    phone: string(value.phone),
    businessHours: string(value.businessHours),
    paymentMethods: string(value.paymentMethods),
    fulfillmentOptions: string(value.fulfillmentOptions),
  };
}
function parseCapabilities(body: unknown): CapabilityName[] {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { capabilities?: unknown }).capabilities)
  )
    throw badRequest("VALIDATION_ERROR", "Invalid capabilities");
  const values = (body as { capabilities: unknown[] }).capabilities;
  if (
    values.some(
      (value) =>
        typeof value !== "string" ||
        !capabilityNames.includes(value as CapabilityName),
    )
  )
    throw badRequest("VALIDATION_ERROR", "Invalid capability");
  return [...new Set(values)] as CapabilityName[];
}
function parseReview(body: unknown) {
  const value = body as Record<string, unknown>;
  if (!value || !["dismiss", "publish"].includes(String(value.action)))
    throw badRequest("VALIDATION_ERROR", "Invalid review action");
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  if (value.action === "publish" && (!title || !content))
    throw badRequest("VALIDATION_ERROR", "Title and content are required");
  return { action: value.action as "dismiss" | "publish", title, content, keywords: parseKeywords(value.keywords) };
}
function parseProfileLocalization(body: unknown) {
  const value = body as Record<string, unknown>;
  const string = (item: unknown) => (typeof item === "string" ? item.trim() : "");
  return {
    address: string(value?.address),
    businessHours: string(value?.businessHours),
    paymentMethods: string(value?.paymentMethods),
    fulfillmentOptions: string(value?.fulfillmentOptions),
  };
}
function parseOfferingLocalization(body: unknown) {
  const value = body as Record<string, unknown>;
  const string = (item: unknown) => (typeof item === "string" ? item.trim() : "");
  return {
    name: string(value?.name),
    description: string(value?.description),
  };
}
function parseVariantLocalization(body: unknown) {
  const value = body as Record<string, unknown>;
  return {
    name: typeof value?.name === "string" ? value.name.trim() : "",
  };
}
function parseEntryLocalization(body: unknown) {
  const value = body as Record<string, unknown>;
  const string = (item: unknown) => (typeof item === "string" ? item.trim() : "");
  return { title: string(value?.title), content: string(value?.content) };
}
function parseEntry(body: unknown) {
  const value = body as Record<string, unknown>;
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const content =
    typeof value?.content === "string" ? value.content.trim() : "";
  if (!title || !content)
    throw badRequest("VALIDATION_ERROR", "Title and content are required");
  return { title, content, keywords: parseKeywords(value?.keywords) };
}
// Extra phrasings this entry should also be found by, beyond its title —
// the per-entry replacement for the old shared, hardcoded intent vocabulary
// (D-078). Optional: an entry with none still works via title matching.
function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0 && item.length <= 60),
    ),
  ].slice(0, 20);
}
function parseResponseVariantReview(body: unknown) {
  const value = body as Record<string, unknown>;
  const action = value?.action;
  const variantBody =
    typeof value?.variantBody === "string" ? value.variantBody.trim() : "";
  if (
    !["approve", "reject"].includes(String(action)) ||
    (action === "approve" && (!variantBody || variantBody.length > 4096))
  )
    throw badRequest("VALIDATION_ERROR", "Invalid response variant review");
  return { action: action as "approve" | "reject", variantBody };
}
function parseOffering(body: unknown): OfferingInput {
  const value = body as Record<string, unknown>;
  if (!value || typeof value !== "object")
    throw badRequest("VALIDATION_ERROR", "Invalid offering");
  const string = (field: string, required = false) => {
    const result =
      typeof value[field] === "string" ? (value[field] as string).trim() : "";
    if (required && !result)
      throw badRequest("VALIDATION_ERROR", `${field} is required`);
    return result;
  };
  const types = [
    "product",
    "service",
    "prepared_product",
    "appointment",
    "package",
  ];
  const statuses = ["active", "inactive"];
  const offeringType = string("offeringType", true);
  const status = string("status", true);
  const durationMinutes =
    value.durationMinutes === null || value.durationMinutes === ""
      ? null
      : Number(value.durationMinutes);
  if (!types.includes(offeringType) || !statuses.includes(status))
    throw badRequest("VALIDATION_ERROR", "Invalid offering values");
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      durationMinutes > 10080)
  )
    throw badRequest("VALIDATION_ERROR", "Invalid duration");
  return {
    name: string("name", true),
    description: string("description"),
    category: string("category"),
    // Runtime-validated above against the same literal set as
    // OfferingInput['offeringType'] (types.includes(offeringType)).
    offeringType: offeringType as OfferingInput["offeringType"],
    status: status as "active" | "inactive",
    durationMinutes,
    bookingRequired: value.bookingRequired === true,
  };
}
// D-142: split out of parseOffering so it's shared by createVariant and
// updateVariant, which each address one specific variant instead of always
// the offering's first one.
function parseVariant(body: unknown): VariantInput {
  const value = body as Record<string, unknown>;
  if (!value || typeof value !== "object")
    throw badRequest("VALIDATION_ERROR", "Invalid variant");
  const string = (field: string, required = false) => {
    const result =
      typeof value[field] === "string" ? (value[field] as string).trim() : "";
    if (required && !result)
      throw badRequest("VALIDATION_ERROR", `${field} is required`);
    return result;
  };
  const statuses = ["active", "inactive"];
  const status = string("status", true);
  const currency = string("currency", true).toUpperCase();
  const priceMinor = Number(value.priceMinor);
  if (
    !statuses.includes(status) ||
    !Number.isSafeInteger(priceMinor) ||
    priceMinor < 0 ||
    priceMinor > 999999999999 ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw badRequest("VALIDATION_ERROR", "Invalid variant values");
  return {
    name: string("name", true),
    sku: string("sku") || null,
    priceMinor,
    currency,
    status: status as "active" | "inactive",
    availabilityStatus:
      value.availabilityStatus === "unavailable"
        ? "unavailable"
        : ("available" as "available" | "unavailable"),
  };
}
// Creating an offering still needs exactly one variant alongside it in the
// same call — a catalog item is never left with zero variants — so the
// request body nests { ...offeringFields, variant: {...} } instead of
// flattening everything the way the old single-variant OfferingInput did.
function parseCreateOffering(body: unknown): {
  offering: OfferingInput;
  variant: VariantInput;
} {
  const offering = parseOffering(body);
  const variant = parseVariant((body as Record<string, unknown>)?.variant);
  return { offering, variant };
}
