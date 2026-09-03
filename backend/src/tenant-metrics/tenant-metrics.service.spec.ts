import { TenantMetricsService } from './tenant-metrics.service';

describe('TenantMetricsService', () => {
  it('computes rates from raw counts and passes through cost/latency untouched', async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [
          {
            tenant_id: 'tenant-1',
            tenant_slug: 'restaurante-demo',
            tenant_display_name: 'Santos Tacos',
            messages_total: '10',
            messages_resolved: '8',
            conversations_total: '5',
            conversations_handed_off: '1',
            commercial_requests_total: '4',
            commercial_requests_confirmed: '3',
            avg_response_latency_ms: '1250.5',
            ai_calls_total: '6',
            ai_cost_minor: '1234',
            ai_currency: 'USD',
            ai_avg_latency_ms: '900',
          },
          {
            tenant_id: 'tenant-2',
            tenant_slug: 'lavadero-ruta-80',
            tenant_display_name: 'Ruta 80 Car Wash',
            messages_total: '0',
            messages_resolved: '0',
            conversations_total: '0',
            conversations_handed_off: '0',
            commercial_requests_total: '0',
            commercial_requests_confirmed: '0',
            avg_response_latency_ms: null,
            ai_calls_total: '0',
            ai_cost_minor: '0',
            ai_currency: null,
            ai_avg_latency_ms: null,
          },
        ],
      })),
    };
    const db = {
      withRuntimeTransaction: (operation: (client: unknown) => unknown) =>
        operation(client),
    } as never;

    const result = await new TenantMetricsService(db).summary(
      'user-1',
      '2026-08-01',
      '2026-08-31',
    );

    expect(client.query).toHaveBeenCalledWith(
      'select * from app.tenant_operational_summary($1, $2, $3)',
      ['user-1', '2026-08-01', '2026-08-31'],
    );
    expect(result[0]).toMatchObject({
      tenantId: 'tenant-1',
      slug: 'restaurante-demo',
      resolvedRate: 0.8,
      humanHandledRate: 0.2,
      conversionRate: 0.75,
      avgResponseLatencyMs: 1250.5,
      aiCostMinor: 1234,
      aiCurrency: 'USD',
      aiAvgLatencyMs: 900,
    });
    // Un tenant sin actividad en el período no debe dividir por cero — las
    // tasas quedan en null (sin dato), nunca en NaN o 0 engañoso.
    expect(result[1]).toMatchObject({
      resolvedRate: null,
      humanHandledRate: null,
      conversionRate: null,
      avgResponseLatencyMs: null,
      aiCostMinor: 0,
      aiCurrency: null,
    });
  });

  it('maps a platform-forbidden Postgres error to a 403', async () => {
    const client = {
      query: jest.fn(async () => {
        const error = new Error('insufficient_privilege') as Error & {
          code: string;
        };
        error.code = '42501';
        throw error;
      }),
    };
    const db = {
      withRuntimeTransaction: (operation: (client: unknown) => unknown) =>
        operation(client),
    } as never;

    await expect(
      new TenantMetricsService(db).summary(
        'not-an-owner',
        '2026-08-01',
        '2026-08-31',
      ),
    ).rejects.toThrow('Only a platform owner can view metrics');
  });

  it('daily() maps a row per day, including days with no activity', async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [
          {
            day: '2026-08-30',
            messages_total: '0',
            messages_resolved: '0',
            conversations_total: '0',
            conversations_handed_off: '0',
            commercial_requests_total: '0',
            commercial_requests_confirmed: '0',
            avg_response_latency_ms: null,
            ai_calls_total: '0',
            ai_cost_minor: '0',
            ai_currency: null,
            ai_avg_latency_ms: null,
          },
          {
            day: '2026-08-31',
            messages_total: '10',
            messages_resolved: '9',
            conversations_total: '3',
            conversations_handed_off: '0',
            commercial_requests_total: '1',
            commercial_requests_confirmed: '1',
            avg_response_latency_ms: '2148',
            ai_calls_total: '0',
            ai_cost_minor: '0',
            ai_currency: null,
            ai_avg_latency_ms: null,
          },
        ],
      })),
    };
    const db = {
      withRuntimeTransaction: (operation: (client: unknown) => unknown) =>
        operation(client),
    } as never;

    const result = await new TenantMetricsService(db).daily(
      'user-1',
      'tenant-1',
      '2026-08-30',
      '2026-08-31',
    );

    expect(client.query).toHaveBeenCalledWith(
      'select * from app.tenant_operational_daily($1, $2, $3, $4)',
      ['user-1', 'tenant-1', '2026-08-30', '2026-08-31'],
    );
    expect(result).toMatchObject([
      { day: '2026-08-30', messagesTotal: 0, resolvedRate: null },
      {
        day: '2026-08-31',
        messagesTotal: 10,
        resolvedRate: 0.9,
        conversionRate: 1,
        avgResponseLatencyMs: 2148,
      },
    ]);
  });

  it('daily() also maps a platform-forbidden Postgres error to a 403', async () => {
    const client = {
      query: jest.fn(async () => {
        const error = new Error('insufficient_privilege') as Error & {
          code: string;
        };
        error.code = '42501';
        throw error;
      }),
    };
    const db = {
      withRuntimeTransaction: (operation: (client: unknown) => unknown) =>
        operation(client),
    } as never;

    await expect(
      new TenantMetricsService(db).daily(
        'not-an-owner',
        'tenant-1',
        '2026-08-01',
        '2026-08-31',
      ),
    ).rejects.toThrow('Only a platform owner can view metrics');
  });
});
