import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PlatformTenantsService } from './platform-tenants.service';
import { badRequest } from '../observability/http-errors';

@Controller('v1/admin/platform/tenants')
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}
  @Get() list(@Req() request: AuthenticatedRequest) { return this.tenants.list(request.actor.userId); }
  @Post() create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.tenants.create(request.actor.userId, parseTenant(body));
  }
  @Patch(':tenantId') update(@Param('tenantId') tenantId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!isUuid(tenantId)) throw badRequest('VALIDATION_ERROR', 'tenantId must be UUID');
    return this.tenants.update(request.actor.userId, tenantId, parseTenantUpdate(body));
  }
}

function parseTenant(body: unknown) {
  if (!body || typeof body !== 'object') throw badRequest('VALIDATION_ERROR', 'Invalid company');
  const value = body as Record<string, unknown>;
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
  const slug = typeof value.slug === 'string' ? value.slug.trim().toLowerCase() : '';
  const timezone = typeof value.timezone === 'string' ? value.timezone.trim() : 'America/Bogota';
  const defaultLocale = typeof value.defaultLocale === 'string' ? value.defaultLocale.trim() : 'es-CO';
  if (displayName.length < 2 || displayName.length > 120) throw badRequest('VALIDATION_ERROR', 'Invalid company name');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw badRequest('VALIDATION_ERROR', 'Identifier only allows lowercase letters, numbers, and hyphens');
  if (timezone.length > 64 || defaultLocale.length > 16) throw badRequest('VALIDATION_ERROR', 'Invalid regional configuration');
  return { displayName, slug, timezone, defaultLocale };
}

function parseTenantUpdate(body: unknown) {
  if (!body || typeof body !== 'object') throw badRequest('VALIDATION_ERROR', 'Invalid company');
  const value = body as Record<string, unknown>;
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
  const timezone = typeof value.timezone === 'string' ? value.timezone.trim() : '';
  const defaultLocale = typeof value.defaultLocale === 'string' ? value.defaultLocale.trim() : '';
  const status = typeof value.status === 'string' ? value.status.trim() : '';
  if (displayName.length < 2 || displayName.length > 120) throw badRequest('VALIDATION_ERROR', 'Invalid company name');
  if (!timezone || timezone.length > 64 || defaultLocale.length < 2 || defaultLocale.length > 16) throw badRequest('VALIDATION_ERROR', 'Invalid regional configuration');
  if (!['active', 'suspended', 'disabled'].includes(status)) throw badRequest('VALIDATION_ERROR', 'Invalid company status');
  return { displayName, timezone, defaultLocale, status };
}
