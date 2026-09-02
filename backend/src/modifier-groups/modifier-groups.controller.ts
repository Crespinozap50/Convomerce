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
  ModifierGroupInput,
  ModifierGroupsService,
  ModifierOptionInput,
  SelectionType,
} from "./modifier-groups.service";

@Controller("v1/admin/tenants/:tenantId/modifier-groups")
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class ModifierGroupsController {
  constructor(private readonly service: ModifierGroupsService) {}

  @Get() list(
    @Param("tenantId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.list(id, request.actor.userId);
  }

  @Post() createGroup(
    @Param("tenantId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    return this.service.createGroup(id, request.actor.userId, parseGroup(body));
  }

  @Patch(":groupId") updateGroup(
    @Param("tenantId") id: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(groupId);
    return this.service.updateGroup(id, request.actor.userId, groupId, parseGroup(body));
  }

  @Delete(":groupId") archiveGroup(
    @Param("tenantId") id: string,
    @Param("groupId") groupId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(groupId);
    return this.service.archiveGroup(id, request.actor.userId, groupId);
  }

  @Post(":groupId/options") createOption(
    @Param("tenantId") id: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(groupId);
    return this.service.createOption(id, request.actor.userId, groupId, parseOption(body));
  }

  @Patch(":groupId/options/:optionId") updateOption(
    @Param("tenantId") id: string,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(groupId);
    valid(optionId);
    return this.service.updateOption(id, request.actor.userId, groupId, optionId, parseOption(body));
  }

  @Delete(":groupId/options/:optionId") archiveOption(
    @Param("tenantId") id: string,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(groupId);
    valid(optionId);
    return this.service.archiveOption(id, request.actor.userId, groupId, optionId);
  }

  @Put("items/:catalogItemId") setItemGroups(
    @Param("tenantId") id: string,
    @Param("catalogItemId") catalogItemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(id);
    valid(catalogItemId);
    return this.service.setItemGroups(id, request.actor.userId, catalogItemId, parseGroupIds(body));
  }
}

function valid(value: string) {
  if (!uuid(value)) throw badRequest("VALIDATION_ERROR", "tenantId must be UUID");
}
function parseGroup(body: unknown): ModifierGroupInput {
  const value = body as Record<string, unknown>;
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const selectionType = value?.selectionType;
  if (!name || !["single", "multiple"].includes(String(selectionType)))
    throw badRequest("VALIDATION_ERROR", "Invalid extras group");
  return { name, selectionType: selectionType as SelectionType };
}
function parseOption(body: unknown): ModifierOptionInput {
  const value = body as Record<string, unknown>;
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const priceMinor = Number(value?.priceMinor ?? 0);
  const currency = typeof value?.currency === "string" ? value.currency.trim().toUpperCase() : "";
  if (
    !name ||
    !Number.isSafeInteger(priceMinor) ||
    priceMinor < 0 ||
    priceMinor > 999999999999 ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw badRequest("VALIDATION_ERROR", "Invalid extra option");
  return { name, priceMinor, currency };
}
function parseGroupIds(body: unknown): string[] {
  const value = (body as { groupIds?: unknown })?.groupIds;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !uuid(item)))
    throw badRequest("VALIDATION_ERROR", "Invalid extras group selection");
  return [...new Set(value as string[])];
}
