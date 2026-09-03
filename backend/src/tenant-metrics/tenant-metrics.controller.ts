import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { badRequest } from '../observability/http-errors';
import { TenantMetricsService } from './tenant-metrics.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 30;

@Controller('v1/admin/platform/tenant-metrics')
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class TenantMetricsController {
  constructor(private readonly metrics: TenantMetricsService) {}

  @Get()
  summary(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    const { from, to } = parsePeriod(query);
    return this.metrics.summary(request.actor.userId, from, to);
  }

  @Get(':tenantId/daily')
  daily(
    @Param('tenantId') tenantId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!isUuid(tenantId)) {
      throw badRequest('VALIDATION_ERROR', 'tenantId must be a UUID');
    }
    const { from, to } = parsePeriod(query);
    return this.metrics.daily(request.actor.userId, tenantId, from, to);
  }
}

function parsePeriod(query: Record<string, unknown>): {
  from: string;
  to: string;
} {
  const to = typeof query.to === 'string' ? query.to : isoDate(new Date());
  const from =
    typeof query.from === 'string'
      ? query.from
      : isoDate(daysAgo(DEFAULT_WINDOW_DAYS));
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw badRequest('VALIDATION_ERROR', 'from/to must be YYYY-MM-DD dates');
  }
  if (from > to) {
    throw badRequest('VALIDATION_ERROR', 'from must not be after to');
  }
  return { from, to };
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
