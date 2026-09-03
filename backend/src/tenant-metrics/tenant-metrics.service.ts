import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { forbidden } from '../observability/http-errors';

export interface TenantOperationalSummary {
  tenantId: string;
  slug: string;
  displayName: string;
  messagesTotal: number;
  resolvedRate: number | null;
  conversationsTotal: number;
  humanHandledRate: number | null;
  commercialRequestsTotal: number;
  conversionRate: number | null;
  avgResponseLatencyMs: number | null;
  aiCallsTotal: number;
  aiCostMinor: number;
  aiCurrency: string | null;
  aiAvgLatencyMs: number | null;
}

interface SummaryRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  messages_total: string;
  messages_resolved: string;
  conversations_total: string;
  conversations_handed_off: string;
  commercial_requests_total: string;
  commercial_requests_confirmed: string;
  avg_response_latency_ms: string | null;
  ai_calls_total: string;
  ai_cost_minor: string;
  ai_currency: string | null;
  ai_avg_latency_ms: string | null;
}

@Injectable()
export class TenantMetricsService {
  constructor(private readonly database: DatabaseService) {}

  async summary(
    actorUserId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<TenantOperationalSummary[]> {
    try {
      return await this.database.withRuntimeTransaction(async (client) => {
        const result = await client.query<SummaryRow>(
          'select * from app.tenant_operational_summary($1, $2, $3)',
          [actorUserId, periodStart, periodEnd],
        );
        return result.rows.map((row) => {
          const messagesTotal = Number(row.messages_total);
          const conversationsTotal = Number(row.conversations_total);
          const commercialRequestsTotal = Number(row.commercial_requests_total);
          return {
            tenantId: row.tenant_id,
            slug: row.tenant_slug,
            displayName: row.tenant_display_name,
            messagesTotal,
            resolvedRate: rate(Number(row.messages_resolved), messagesTotal),
            conversationsTotal,
            humanHandledRate: rate(
              Number(row.conversations_handed_off),
              conversationsTotal,
            ),
            commercialRequestsTotal,
            conversionRate: rate(
              Number(row.commercial_requests_confirmed),
              commercialRequestsTotal,
            ),
            avgResponseLatencyMs: numberOrNull(row.avg_response_latency_ms),
            aiCallsTotal: Number(row.ai_calls_total),
            aiCostMinor: Number(row.ai_cost_minor),
            aiCurrency: row.ai_currency,
            aiAvgLatencyMs: numberOrNull(row.ai_avg_latency_ms),
          };
        });
      });
    } catch (error) {
      if (isPgCode(error, '42501')) {
        throw forbidden(
          'TENANT_METRICS_FORBIDDEN',
          'Only a platform owner can view metrics across companies',
        );
      }
      throw error;
    }
  }
}

function rate(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function isPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === code
  );
}
