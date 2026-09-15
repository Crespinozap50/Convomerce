import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { validate as isUuid } from "uuid";
import { AuthenticatedRequest } from "../auth/authenticated-request";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { PasswordReadyGuard } from "../auth/password-ready.guard";
import { badRequest } from "../observability/http-errors";
import { LoggroConnectionService } from "./loggro-connection.service";

@Controller("v1/admin/tenants/:tenantId/pos-connections/loggro")
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class LoggroConnectionController {
  constructor(private readonly connections: LoggroConnectionService) {}

  @Get() status(@Param("tenantId") tenantId: string, @Req() request: AuthenticatedRequest) {
    requireUuid(tenantId);
    return this.connections.status(tenantId, request.actor.userId);
  }

  @Put() connect(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId);
    const input = objectBody(body);
    return this.connections.connect(tenantId, request.actor.userId, {
      email: requiredString(input.email, "email"),
      password: optionalString(input.password),
    });
  }

  @Get("tables") tables(@Param("tenantId") tenantId: string, @Req() request: AuthenticatedRequest) {
    requireUuid(tenantId);
    return this.connections.listTables(tenantId, request.actor.userId);
  }

  @Put("home-delivery-table") setHomeDeliveryTable(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId);
    const input = objectBody(body);
    return this.connections.setHomeDeliveryTable(
      tenantId,
      request.actor.userId,
      requiredString(input.tableId, "tableId"),
    );
  }
}

function requireUuid(value: string): void {
  if (!isUuid(value)) throw badRequest("VALIDATION_ERROR", "tenantId must be a UUID");
}
function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw badRequest("VALIDATION_ERROR", "Request body must be an object");
  return body as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw badRequest("VALIDATION_ERROR", `${field} is required`);
  return value.trim();
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
