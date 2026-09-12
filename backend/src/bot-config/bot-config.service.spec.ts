import { BotConfigService } from './bot-config.service';

describe('BotConfigService.usage', () => {
  it('reports today\'s and this month\'s AI usage against the configured limits (D-148)', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('can_manage_channel_connections')) return { rows: [{ allowed: true }] };
        if (sql.includes('from app.ai_response_policies'))
          return { rows: [{ daily_request_limit: 300, monthly_cost_limit_minor: 500, cost_currency: 'USD' }] };
        if (sql.includes('from app.ai_budget_periods'))
          return {
            rows: [
              { period_type: 'day', period_start: '2026-09-12', completed_requests: 165, reserved_requests: 0, actual_cost_minor: '165', reserved_cost_minor: '0' },
              { period_type: 'month', period_start: '2026-09-01', completed_requests: 272, reserved_requests: 0, actual_cost_minor: '272', reserved_cost_minor: '0' },
            ],
          };
        return { rows: [] };
      }),
    };
    const database = { withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) => operation(client) } as never;

    const result = await new BotConfigService(database).usage('tenant-1', 'user-1');

    expect(result).toEqual({
      costCurrency: 'USD',
      day: { requestsUsed: 165, requestsLimit: 300 },
      month: { costUsedMinor: 272, costLimitMinor: 500 },
    });
  });

  it('reports zero usage, not an error, when a tenant has never used the AI budget yet', async () => {
    // app.ai_budget_periods rows only exist once AiUsageBudgetService.reserve()
    // has actually run at least once — a fresh tenant (or a new day/month
    // with no requests yet) genuinely has no row for that period, which
    // means zero usage so far, not a data problem.
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('can_manage_channel_connections')) return { rows: [{ allowed: true }] };
        if (sql.includes('from app.ai_response_policies'))
          return { rows: [{ daily_request_limit: 100, monthly_cost_limit_minor: 500, cost_currency: 'USD' }] };
        if (sql.includes('from app.ai_budget_periods')) return { rows: [] };
        return { rows: [] };
      }),
    };
    const database = { withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) => operation(client) } as never;

    const result = await new BotConfigService(database).usage('tenant-1', 'user-1');

    expect(result).toEqual({
      costCurrency: 'USD',
      day: { requestsUsed: 0, requestsLimit: 100 },
      month: { costUsedMinor: 0, costLimitMinor: 500 },
    });
  });

  it('rejects an actor who cannot manage this tenant\'s bot configuration', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ allowed: false }] }) };
    const database = { withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) => operation(client) } as never;

    await expect(new BotConfigService(database).usage('tenant-1', 'user-1')).rejects.toMatchObject({
      response: { code: 'BOT_CONFIG_FORBIDDEN' },
    });
  });
});
