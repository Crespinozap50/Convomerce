import { KnowledgeService, OfferingInput } from './knowledge.service';

describe('KnowledgeService offerings', () => {
  const input: OfferingInput = {
    name: 'Servicio demo', description: 'Descripción', category: 'Servicios',
    offeringType: 'service', status: 'active', durationMinutes: 45,
    bookingRequired: true, variantName: 'Sesión estándar', sku: null,
    priceMinor: 5000000, currency: 'COP', availabilityStatus: 'available',
  };

  it('creates a tenant-scoped offering and its primary variant', async () => {
    const queries: string[] = [];
    const client = { query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('can_manage_channel_connections')) return { rows: [{ allowed: true }] };
      if (sql.includes("from app.catalogs where status='published'")) return { rows: [{ id: 'catalog-1' }] };
      if (sql.includes('from app.catalog_items where id=')) return { rows: [{ id: 'item-1', name: input.name, source_provider: 'manual', offering_type: 'service', duration_minutes: 45, booking_required: true }] };
      if (sql.includes('from app.item_variants where catalog_item_id=')) return { rows: [{ id: 'variant-1', name: input.variantName, price_minor: '5000000', currency: 'COP', availability_status: 'available', status: 'active' }] };
      return { rows: [] };
    }) };
    const database = { withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) => operation(client) } as never;

    const result = await new KnowledgeService(database).createOffering('tenant-1', 'user-1', input);

    expect(result.offering.name).toBe(input.name);
    expect(result.offering.variants[0].priceMinor).toBe(5000000);
    expect(queries.some((sql) => sql.includes('insert into app.catalog_items'))).toBe(true);
    expect(queries.some((sql) => sql.includes('insert into app.item_variants'))).toBe(true);
  });
});
