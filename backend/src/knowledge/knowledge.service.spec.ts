import { stringify as stringifyCsv } from 'csv-stringify/sync';
import {
  buildCsvRow,
  CSV_COLUMNS,
  KnowledgeService,
  OfferingInput,
  parseCsvRow,
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

describe('KnowledgeService CSV row parsing/serialization', () => {
  const validRow: Record<string, string> = {
    id_producto: '', id_variante: '', accion: '',
    nombre_producto: 'Camiseta', descripcion_producto: 'Desc', categoria: 'ropa',
    tipo: 'product', estado_producto: 'active',
    duracion_minutos: '', requiere_reserva: 'no',
    nombre_variante: 'Talla M', sku: '', precio: '45000', moneda: 'COP',
    disponibilidad: 'available', estado_variante: 'active',
    nombre_producto_en: '', descripcion_producto_en: '', nombre_variante_en: '',
  };

  it('parses a new-product row (empty ids) into offering+variant input', () => {
    const parsed = parseCsvRow(validRow);
    if (parsed.kind !== 'upsert') throw new Error('expected an upsert row');
    expect(parsed.offeringId).toBeNull();
    expect(parsed.variantId).toBeNull();
    expect(parsed.offering.name).toBe('Camiseta');
    expect(parsed.offering.bookingRequired).toBe(false);
    expect(parsed.variant.priceMinor).toBe(4500000);
  });

  it('rejects accion=eliminar with no id_producto and no id_variante', () => {
    expect(() =>
      parseCsvRow({ ...validRow, accion: 'eliminar', id_producto: '', id_variante: '' }),
    ).toThrow(/accion=eliminar requiere id_producto/);
  });

  it('requiere_reserva accepts si/no/true/false, not just true/false', () => {
    expect(parseCsvRow({ ...validRow, requiere_reserva: 'si' })).toMatchObject({
      offering: { bookingRequired: true },
    });
    expect(parseCsvRow({ ...validRow, requiere_reserva: 'true' })).toMatchObject({
      offering: { bookingRequired: true },
    });
    expect(parseCsvRow({ ...validRow, requiere_reserva: 'false' })).toMatchObject({
      offering: { bookingRequired: false },
    });
  });

  it('buildCsvRow + parseCsvRow round-trip an existing product/variant', () => {
    const product = {
      id: 'item-1', name: 'Camiseta', description: 'Desc', category: 'ropa',
      offeringType: 'product', status: 'active', durationMinutes: null, bookingRequired: false,
      translations: { en: { name: 'T-Shirt', description: 'English desc' } },
    };
    const variant = {
      id: 'variant-1', name: 'Talla M', sku: 'SKU-1', status: 'active',
      priceMinor: 4500000, currency: 'COP', availabilityStatus: 'available',
      translations: { en: { name: 'Size M' } },
    };
    const row = buildCsvRow(product as never, variant as never);
    const record = Object.fromEntries(CSV_COLUMNS.map((key, index) => [key, row[index]]));
    const parsed = parseCsvRow(record);
    if (parsed.kind !== 'upsert') throw new Error('expected an upsert row');
    expect(parsed.offeringId).toBe('item-1');
    expect(parsed.variantId).toBe('variant-1');
    expect(parsed.offering.name).toBe('Camiseta');
    expect(parsed.variant.priceMinor).toBe(4500000);
    expect(parsed.offeringTranslation).toEqual({ name: 'T-Shirt', description: 'English desc' });
    expect(parsed.variantTranslation).toEqual({ name: 'Size M' });
  });
});

describe('KnowledgeService importOfferingsCsv', () => {
  const emptyRow: string[] = CSV_COLUMNS.map(() => '');
  function row(overrides: Record<string, string>): string[] {
    return CSV_COLUMNS.map((key, index) => overrides[key] ?? emptyRow[index]);
  }
  function csvText(rows: string[][]): string {
    return stringifyCsv([CSV_COLUMNS, ...rows]);
  }
  const newProductOverrides = {
    nombre_producto: 'Camiseta', descripcion_producto: 'Desc', categoria: 'ropa',
    tipo: 'product', estado_producto: 'active', requiere_reserva: 'no',
    nombre_variante: 'Talla M', precio: '45000', moneda: 'COP',
    disponibilidad: 'available', estado_variante: 'active',
  };
  const newProductRow = row(newProductOverrides);

  it('a new-product row (empty ids) dispatches to createOffering', async () => {
    const item = readOfferingRows('item-1');
    const { database } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ["from app.catalogs where status='published'", { rows: [{ id: 'catalog-1' }] }],
      ['from app.catalog_items where id=', { rows: [item.item] }],
      ['from app.item_variants where catalog_item_id=', { rows: [{ id: 'variant-1', name: 'Talla M', sku: null, status: 'active', price_minor: '4500000', currency: 'COP', availability_status: 'available' }] }],
    ]);

    const outcome = await new KnowledgeService(database).importOfferingsCsv(
      'tenant-1', 'user-1', csvText([newProductRow]),
    );

    expect(outcome).toEqual({ created: 1, updated: 0, archived: 0, errors: [] });
  });

  // The core guarantee this whole two-phase design exists for: a file that
  // has ANY bad row writes NOTHING at all, not even the rows that were
  // individually fine — otherwise re-uploading the same file after fixing
  // the bad row would re-create every "new product" row that already
  // succeeded the first time (it still has no id in the file to update
  // instead of create).
  it('an invalid row and a row targeting an externally-synced offering both block the whole file — the otherwise-valid row is never written', async () => {
    const { database, queries } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items where id=$1 and status', { rows: [{ source_provider: 'shopify' }] }],
    ]);
    const invalidRow = row({ tipo: 'no-es-un-tipo-valido', estado_producto: 'active' });
    const externalRow = row({
      id_producto: 'item-external', nombre_producto: 'Camiseta', categoria: 'ropa',
      tipo: 'product', estado_producto: 'active', nombre_variante: 'Talla M',
      precio: '45000', moneda: 'COP', disponibilidad: 'available', estado_variante: 'active',
    });

    const outcome = await new KnowledgeService(database).importOfferingsCsv(
      'tenant-1', 'user-1', csvText([newProductRow, invalidRow, externalRow]),
    );

    expect(outcome).toEqual({
      created: 0, updated: 0, archived: 0,
      errors: [
        { row: 3, message: expect.stringContaining('tipo inválido') },
        { row: 4, message: expect.stringContaining('Externally synchronized') },
      ],
    });
    expect(queries.some((sql) => sql.includes('insert into'))).toBe(false);
  });

  it('accion=eliminar on the last active variant blocks the file before archiving anything', async () => {
    const { database, queries } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['from app.item_variants where id=$1 and catalog_item_id=$2', { rows: [{ id: 'variant-1' }] }],
      ["select count(*) from app.item_variants where catalog_item_id=", { rows: [{ count: '0' }] }],
    ]);
    const deleteRow = row({ id_producto: 'item-1', id_variante: 'variant-1', accion: 'eliminar' });

    const outcome = await new KnowledgeService(database).importOfferingsCsv(
      'tenant-1', 'user-1', csvText([deleteRow]),
    );

    expect(outcome).toEqual({
      created: 0, updated: 0, archived: 0,
      errors: [{ row: 2, message: expect.stringContaining('active variant') }],
    });
    expect(queries.some((sql) => sql.includes("status='archived'"))).toBe(false);
  });

  it('two new-product rows sharing the same SKU are both rejected before anything is written', async () => {
    const { database, queries } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
    ]);
    const rowA = row({ ...newProductOverrides, sku: 'DUP-1' });
    const rowB = row({ ...newProductOverrides, sku: 'DUP-1' });

    const outcome = await new KnowledgeService(database).importOfferingsCsv(
      'tenant-1', 'user-1', csvText([rowA, rowB]),
    );

    expect(outcome.created).toBe(0);
    expect(outcome.errors).toEqual([
      { row: 3, message: expect.stringContaining('DUP-1') },
    ]);
    expect(queries.some((sql) => sql.includes('insert into'))).toBe(false);
  });

  it('a new-variant row whose SKU already exists on another product is rejected before writing', async () => {
    const { database, queries } = makeClient([
      ['can_manage_channel_connections', { rows: [{ allowed: true }] }],
      ['select source_provider from app.catalog_items', { rows: [{ source_provider: 'manual' }] }],
      ['select id from app.item_variants where sku=', { rows: [{ id: 'variant-existing' }] }],
    ]);
    const newVariantRow = row({
      id_producto: 'item-1', nombre_producto: 'Camiseta', categoria: 'ropa',
      tipo: 'product', estado_producto: 'active', nombre_variante: 'Talla L',
      sku: 'ALREADY-USED', precio: '45000', moneda: 'COP',
      disponibilidad: 'available', estado_variante: 'active',
    });

    const outcome = await new KnowledgeService(database).importOfferingsCsv(
      'tenant-1', 'user-1', csvText([newVariantRow]),
    );

    expect(outcome).toEqual({
      created: 0, updated: 0, archived: 0,
      errors: [{ row: 2, message: expect.stringContaining('already used') }],
    });
    expect(queries.some((sql) => sql.includes('insert into'))).toBe(false);
  });
});

describe('KnowledgeService exportOfferingsCsv', () => {
  it('excludes archived variants and emits one row per non-archived variant', async () => {
    const { database } = makeClient([]);
    const service = new KnowledgeService(database);
    jest.spyOn(service, 'get').mockResolvedValue({
      products: [
        {
          id: 'item-1', name: 'Camiseta', description: '', category: 'ropa',
          offeringType: 'product', status: 'active', durationMinutes: null, bookingRequired: false,
          translations: { en: { name: '', description: '' } },
          variants: [
            { id: 'variant-1', name: 'Talla M', sku: null, status: 'active', priceMinor: 4500000, currency: 'COP', availabilityStatus: 'available', translations: { en: { name: '' } } },
            { id: 'variant-2', name: 'Talla L', sku: null, status: 'active', priceMinor: 4500000, currency: 'COP', availabilityStatus: 'available', translations: { en: { name: '' } } },
            { id: 'variant-3', name: 'Talla S (descontinuada)', sku: null, status: 'archived', priceMinor: 4500000, currency: 'COP', availabilityStatus: 'unavailable', translations: { en: { name: '' } } },
          ],
        },
      ],
    } as never);

    const csv = await service.exportOfferingsCsv('tenant-1', 'user-1');

    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 non-archived variants
    expect(lines[1]).toContain('item-1');
    expect(lines[1]).toContain('variant-1');
    expect(lines[2]).toContain('variant-2');
    expect(csv).not.toContain('variant-3');
  });
});
