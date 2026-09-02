import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { ChannelConnectionsService } from './channel-connections.service';
import { badRequest } from '../observability/http-errors';

@Controller('v1/admin/tenants/:tenantId/channel-connections')
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class ChannelConnectionsController {
  constructor(private readonly connections: ChannelConnectionsService) {}

  @Get()
  list(@Param('tenantId') tenantId: string, @Req() request: AuthenticatedRequest) {
    requireUuid(tenantId, 'tenantId');
    return this.connections.list(tenantId, request.actor.userId);
  }

  @Put()
  connect(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId, 'tenantId');
    const input = objectBody(body);
    const channelId = requiredString(input.channelId, 'channelId');
    requireUuid(channelId, 'channelId');
    return this.connections.connect({
      tenantId, actorUserId: request.actor.userId, channelId,
      phoneNumberId: requiredString(input.phoneNumberId, 'phoneNumberId'),
      wabaId: requiredString(input.wabaId, 'wabaId'),
      providerAppId: optionalString(input.providerAppId),
      // Optional: omit (or send empty) to keep the access token already on
      // file — see ConnectMetaChannelCommand.accessToken.
      accessToken: optionalString(input.accessToken),
    });
  }

  @Post(':connectionId/test')
  test(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId, 'tenantId');
    requireUuid(connectionId, 'connectionId');
    return this.connections.validate(tenantId, request.actor.userId, connectionId);
  }

  @Delete(':connectionId')
  async disconnect(
    @Param('tenantId') tenantId: string,
    @Param('connectionId') connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId, 'tenantId');
    requireUuid(connectionId, 'connectionId');
    return { disconnected: await this.connections.disconnect(tenantId, request.actor.userId, connectionId) };
  }
}

function requireUuid(value: string, field: string): void {
  if (!isUuid(value)) throw badRequest('VALIDATION_ERROR', `${field} must be a UUID`);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('VALIDATION_ERROR', 'Request body must be an object');
  }
  return body as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('VALIDATION_ERROR', `${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
