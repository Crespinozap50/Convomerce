import { Body, Controller, Get, Param, Patch, Put, Req, UseGuards } from "@nestjs/common";
import { validate as uuid } from "uuid";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { PasswordReadyGuard } from "../auth/password-ready.guard";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { badRequest } from "../observability/http-errors";
import { UpsellSuggestionsService } from "./upsell-suggestions.service";

@Controller("v1/admin/tenants/:tenantId/upsell-suggestions")
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class UpsellSuggestionsController {
  constructor(private readonly service: UpsellSuggestionsService) {}

  @Get() get(@Param("tenantId") tenantId: string, @Req() request: AuthenticatedRequest) {
    valid(tenantId);
    return this.service.get(tenantId, request.actor.userId);
  }

  @Put("enabled") setEnabled(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(tenantId);
    return this.service.setEnabled(tenantId, request.actor.userId, parseEnabled(body));
  }

  @Patch("targets/:variantId") setTarget(
    @Param("tenantId") tenantId: string,
    @Param("variantId") variantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    valid(tenantId);
    valid(variantId);
    return this.service.setTarget(tenantId, request.actor.userId, variantId, parseEnabled(body));
  }
}

function valid(value: string) {
  if (!uuid(value)) throw badRequest("INVALID_ID", "Invalid identifier");
}
function parseEnabled(body: unknown): boolean {
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") throw badRequest("INVALID_BODY", "enabled must be a boolean");
  return enabled;
}
