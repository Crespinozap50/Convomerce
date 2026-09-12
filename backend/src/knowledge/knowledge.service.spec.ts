import {
  KnowledgeService,
  OfferingInput,
  VariantInput,
} from './knowledge.service';

const offering: OfferingInput = {
  name: 'Servicio demo', description: 'Descripción', category: 'Servicios',
  offeringType: 'service', status: 'active', durationMinutes: 45,
  bookingRequired: true,
};
const variant: VariantInput = {
  name: 'Sesión estándar', sku: null, priceMinor: 5000000, currency: 'COP',
  status: 'active', availabilityStatus: 'available',
};

function readOfferingRows(itemId: string, variantRows: unknown[] = []) {
  return {
    item: { id: itemId, name: offering.name, source_provider: 'manual', offering_type: 'service', duration_minutes: 45, booking_required: true },
    variants: variantRows,
  };
}

// Generic mock: each test supplies `handlers`, a list of [substring, response]
// pairs checked in order against the query SQL — first match wins. Falls
// back to `{ rows: [] }` so queries this test doesn't care about (e.g.
// localizations selects) don't need to be enumerated every time.
function makeClient(handlers: [string, unknown][]) {
  const queries: string[] = [];
  const client = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      const match = handlers.find(([substring]) => sql.includes(substring));
      return match ? match[1] : { rows: [] };
    }),
  };
  const database = {
    withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) =>
      operation(client),
  } as never;
  return { client, queries, database };
}

describe('KnowledgeService offerings', () => {
  it('creates a tenant-scoped offering and its primary variant', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ["from app.catalogs where status='published'", { rows: [{ id: 'catalog-1' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [{ id: 'variant-1', name: variant.name, sku: null, status: 'active', price_minor: '5000000', currency: 'COP', availability_status: 'available' }] }],
    ]);

    const result = await new KnowledgeService(database).createOffering('tenant-1', 'user-1', offering, variant);

    expect(result.offering.name).toBe(offering.name);
    expect(result.offering.variants[0].priceMinor).toBe(5000000);
    expect(queries.some((sql) => sql.includes('insert into app.catalog_items'))).toBe(true);
    expect(queries.some((sql) => sql.includes('insert into app.item_variants'))).toBe(true);
  });

  it('updateOffering never touches app.item_variants', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
    ]);

    await new KnowledgeService(database).updateOffering('tenant-1', 'user-1', 'item-1', offering);

    expect(queries.some((sql) => sql.includes('update app.item_variants'))).toBe(false);
  });
});

describe('KnowledgeService variants', () => {
  it('createVariant inserts a second variant for a manual offering', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [{ id: 'variant-2', name: 'Talla grande', sku: null, status: 'active', price_minor: '6000000', currency: 'COP', availability_status: 'available' }] }],
    ]);

    const result = await new KnowledgeService(database).createVariant('tenant-1', 'user-1', 'item-1', { ...variant, name: 'Talla grande', priceMinor: 6000000 });

    expect(queries.some((sql) => sql.includes('insert into app.item_variants'))).toBe(true);
    expect(result.offering.variants[0].name).toBe('Talla grande');
  });

  it('createVariant rejects an externally synchronized offering', async () => {
    const { database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'shopify' }] }],
    ]);

    await expect(
      new KnowledgeService(database).createVariant('tenant-1', 'user-1', 'item-1', variant),
    ).rejects.toHaveProperty('response.code', 'EXTERNAL_OFFERING_READ_ONLY');
  });

  it('createVariant returns 409 VARIANT_SKU_IN_USE, not a raw 500, on a unique-index collision', async () => {
    const { database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['insert into app.item_variants', Promise.reject({ code: '23505' })],
    ]);

    await expect(
      new KnowledgeService(database).createVariant('tenant-1', 'user-1', 'item-1', { ...variant, sku: 'DUP-1' }),
    ).rejects.toHaveProperty('response.code', 'VARIANT_SKU_IN_USE');
  });

  it('updateVariant updates and returns the refreshed offering', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['update app.item_variants set sku=', { rows: [{ id: 'variant-1' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [{ id: 'variant-1', name: 'Nuevo nombre', sku: null, status: 'active', price_minor: '5500000', currency: 'COP', availability_status: 'available' }] }],
    ]);

    const result = await new KnowledgeService(database).updateVariant('tenant-1', 'user-1', 'item-1', 'variant-1', { ...variant, name: 'Nuevo nombre', priceMinor: 5500000 });

    expect(queries.some((sql) => sql.includes('update app.item_variants set sku='))).toBe(true);
    expect(result.offering.variants[0].name).toBe('Nuevo nombre');
  });

  it('updateVariant returns 404 VARIANT_NOT_FOUND when the offering/variant pair does not match', async () => {
    const { database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['update app.item_variants set sku=', { rows: [] }],
    ]);

    await expect(
      new KnowledgeService(database).updateVariant('tenant-1', 'user-1', 'item-1', 'variant-missing', variant),
    ).rejects.toHaveProperty('response.code', 'VARIANT_NOT_FOUND');
  });

  it('archiveVariant archives when another active variant remains', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ["select count(*) from app.item_variants where catalog_item_id=", { rows: [{ count: '1' }] }],
      ["update app.item_variants set status='archived'", { rows: [{ id: 'variant-1' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [] }],
    ]);

    await new KnowledgeService(database).archiveVariant('tenant-1', 'user-1', 'item-1', 'variant-1');

    expect(queries.some((sql) => sql.includes("update app.item_variants set status='archived'"))).toBe(true);
  });

  it('archiveVariant rejects with 409 OFFERING_LAST_VARIANT and never sends the archive update', async () => {
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ["select count(*) from app.item_variants where catalog_item_id=", { rows: [{ count: '0' }] }],
    ]);

    await expect(
      new KnowledgeService(database).archiveVariant('tenant-1', 'user-1', 'item-1', 'variant-1'),
    ).rejects.toHaveProperty('response.code', 'OFFERING_LAST_VARIANT');
    expect(queries.some((sql) => sql.includes("update app.item_variants set status='archived'"))).toBe(false);
  });

  it('saveVariantLocalization translates the addressed variant, not always the first one', async () => {
    const item = readOfferingRows('item-1');
    const { queries, database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select id from app.item_variants where id=', { rows: [{ id: 'variant-2' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [] }],
    ]);

    await new KnowledgeService(database).saveVariantLocalization('tenant-1', 'user-1', 'item-1', 'variant-2', { name: 'Large size' });

    const upsert = queries.find((sql) => sql.includes('insert into app.item_variant_localizations'));
    expect(upsert).toBeDefined();
  });
});
