import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TenantRole, TenantUsersService } from './tenant-users.service';

@Controller('v1')
export class TenantUsersController {
  constructor(private readonly users: TenantUsersService) {}

  @Get('admin/tenants/:tenantId/users')
  @UseGuards(SessionAuthGuard, PasswordReadyGuard)
  list(@Param('tenantId') tenantId: string, @Req() request: AuthenticatedRequest) {
    requireUuid(tenantId);
    return this.users.list(tenantId, request.actor.userId);
  }

  @Post('admin/tenants/:tenantId/invitations')
  @UseGuards(SessionAuthGuard, PasswordReadyGuard)
  invite(@Param('tenantId') tenantId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    requireUuid(tenantId);
    const input = parseInvitation(body);
    return this.users.invite(tenantId, request.actor.userId, input.email, input.role);
  }

  @Patch('admin/tenants/:tenantId/users/:membershipId')
  @UseGuards(SessionAuthGuard, PasswordReadyGuard)
  updateMembership(
    @Param('tenantId') tenantId: string, @Param('membershipId') membershipId: string,
    @Body() body: unknown, @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId); requireId(membershipId, 'membershipId');
    const input = parseMembershipUpdate(body);
    return this.users.updateMembership(tenantId, request.actor.userId, membershipId, input.role, input.status);
  }

  @Delete('admin/tenants/:tenantId/invitations/:invitationId')
  @UseGuards(SessionAuthGuard, PasswordReadyGuard)
  revokeInvitation(
    @Param('tenantId') tenantId: string, @Param('invitationId') invitationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    requireUuid(tenantId); requireId(invitationId, 'invitationId');
    return this.users.revokeInvitation(tenantId, request.actor.userId, invitationId);
  }

  @Post('auth/invitations/accept')
  accept(@Body() body: unknown) {
    const input = parseAcceptance(body);
    return this.users.accept(input.token, input.displayName, input.password);
  }
}

function requireUuid(value: string): void {
  if (!isUuid(value)) throw new BadRequestException('tenantId must be a UUID');
}

function requireId(value: string, field: string): void {
  if (!isUuid(value)) throw new BadRequestException(`${field} must be a UUID`);
}

function parseInvitation(body: unknown): { email: string; role: TenantRole } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid invitation');
  const { email, role } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  if (!['owner', 'admin', 'operator', 'viewer'].includes(String(role))) {
    throw new BadRequestException('Invalid role');
  }
  return { email: email.trim().toLowerCase(), role: role as TenantRole };
}

function parseAcceptance(body: unknown): { token: string; displayName: string; password: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid invitation acceptance');
  const { token, displayName, password } = body as Record<string, unknown>;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw new BadRequestException('Invalid token');
  if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.length > 120) {
    throw new BadRequestException('Invalid display name');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new BadRequestException('Password must be between 12 and 256 characters');
  }
  return { token, displayName: displayName.trim(), password };
}

function parseMembershipUpdate(body: unknown): { role: TenantRole; status: 'active' | 'disabled' } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid update');
  const { role, status } = body as Record<string, unknown>;
  if (!['owner', 'admin', 'operator', 'viewer'].includes(String(role))) throw new BadRequestException('Invalid role');
  if (!['active', 'disabled'].includes(String(status))) throw new BadRequestException('Invalid status');
  return { role: role as TenantRole, status: status as 'active' | 'disabled' };
}
