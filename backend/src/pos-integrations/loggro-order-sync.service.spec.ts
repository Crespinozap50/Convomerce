import { LoggroOrderSyncService } from "./loggro-order-sync.service";

describe("LoggroOrderSyncService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const commercialRequestId = "0194f000-0000-7000-8000-000000000301";

  function service(
    query: jest.Mock,
    apiClient?: Partial<{
      createOrder: jest.Mock;
      getTables: jest.Mock;
      getOccupiedTableIds: jest.Mock;
      createTable: jest.Mock;
    }>,
  ) {
    return new LoggroOrderSyncService(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
      {
        createOrder: apiClient?.createOrder ?? jest.fn(),
        getTables:
          apiClient?.getTables ??
          jest.fn().mockResolvedValue([
            { _id: "table-1", name: "Bot Convomerce 1", isActive: true, isHomeDelivery: false },
          ]),
        getOccupiedTableIds: apiClient?.getOccupiedTableIds ?? jest.fn().mockResolvedValue(new Set()),
        createTable: apiClient?.createTable ?? jest.fn(),
      } as never,
    );
  }

  function connectionRow(tableNamePattern: string | null = "Bot Convomerce") {
    return { rows: [{ id: "conn-1", table_name_pattern: tableNamePattern }] };
  }
  function requestRow() {
    return { rows: [{ currency: "COP", customer_notes: null }] };
  }
  function noModifiers() {
    return { rows: [] };
  }

  it("throws naming the unmapped item, before ever calling the Loggro API", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({
        rows: [{ id: "line-1", description_snapshot: "Tacos de pollo", quantity: "2", unit_price_minor_snapshot: "1790000", external_product_id: null }],
      })
      .mockResolvedValueOnce(noModifiers());
    const createOrder = jest.fn();

    await expect(service(query, { createOrder }).pushOrder(tenantId, commercialRequestId))
      .rejects.toThrow(/Tacos de pollo/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("throws when the tenant has no table name pattern configured, before calling the Loggro API", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow(null))
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(noModifiers());
    const getTables = jest.fn();
    const createOrder = jest.fn();

    await expect(service(query, { createOrder, getTables }).pushOrder(tenantId, commercialRequestId))
      .rejects.toThrow(/table name pattern/);
    expect(getTables).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("on success, records pos_sync_status='synced' with the real external order id", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({
        rows: [{ id: "line-1", description_snapshot: "Tacos de pollo", quantity: "2", unit_price_minor_snapshot: "1790000", external_product_id: "loggro-prod-1" }],
      })
      .mockResolvedValueOnce(noModifiers())
      .mockResolvedValueOnce({ rows: [] }); // final status write
    const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

    const result = await service(query, { createOrder }).pushOrder(tenantId, commercialRequestId);

    expect(result).toEqual({ externalOrderIds: ["loggro-order-1"] });
    const [orderPayload] = createOrder.mock.calls[0].slice(2);
    expect(orderPayload.table).toBe("table-1");
    expect(orderPayload.orders).toEqual([
      { product: "loggro-prod-1", quantity: 2, unit_price: 17900, notes: ["Pedido #00000301"] },
    ]);
    expect(orderPayload.groupName).toBe("WhatsApp - Pedido 00000301");
    const finalWrite = query.mock.calls[4];
    expect(String(finalWrite[0])).toContain("pos_sync_status='synced'");
    expect(finalWrite[1]).toEqual([commercialRequestId, ["loggro-order-1"]]);
  });

  it("tracks every order id Loggro returns, not just the first — a modifier creates its own separate order document (D-195, live finding)", async () => {
    // Found live: Loggro's POST /orders creates one independent order
    // document PER ENTRY of `orders[]`, never a single order with several
    // lines. A request with a mapped modifier (D-192/D-193) used to only
    // record created[0]._id, leaving the modifier's own order untracked —
    // a real orphan on the real Bot Convomerce table, cleaned up by hand.
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({
        rows: [{ id: "line-1", description_snapshot: "Dorado de Pollo", quantity: "1", unit_price_minor_snapshot: "950000", external_product_id: "loggro-prod-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ request_line_id: "line-1", description_snapshot: "Guacamole", quantity: "1", unit_price_delta_minor_snapshot: "300000", external_product_id: "loggro-guac-1" }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const createOrder = jest.fn().mockResolvedValue([
      { _id: "loggro-order-parent", status: "Espera" },
      { _id: "loggro-order-modifier", status: "Espera" },
    ]);

    const result = await service(query, { createOrder }).pushOrder(tenantId, commercialRequestId);

    expect(result).toEqual({ externalOrderIds: ["loggro-order-parent", "loggro-order-modifier"] });
    const finalWrite = query.mock.calls[4];
    expect(finalWrite[1]).toEqual([commercialRequestId, ["loggro-order-parent", "loggro-order-modifier"]]);
  });

  it("folds an unmapped modifier into the line's notes instead of dropping it", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({
        rows: [{ id: "line-1", description_snapshot: "Tacos de pollo", quantity: "1", unit_price_minor_snapshot: "1790000", external_product_id: "loggro-prod-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ request_line_id: "line-1", description_snapshot: "Extra queso", quantity: "1", unit_price_delta_minor_snapshot: "0", external_product_id: null }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

    await service(query, { createOrder }).pushOrder(tenantId, commercialRequestId);

    const [orderPayload] = createOrder.mock.calls[0].slice(2);
    expect(orderPayload.orders[0].notes).toEqual(["Pedido #00000301", "Extra queso"]);
    expect(orderPayload.orders[0].productsExtra).toBeUndefined();
  });

  it("sends a mapped modifier as its own separate order line, not nested productsExtra (D-192, live finding, Santiago, Santos Tacos)", async () => {
    // Found live: "Guacamole" (+$3.000) reached Loggro only as text inside
    // the parent line's notes — the real order there registered $9.500
    // (just the taco) when the customer had actually been charged
    // $12.500. A modifier mapped in app.pos_product_mappings now goes out
    // with its real price as its own top-level order line — never as
    // `productsExtra`, which the project owner confirmed live (Postman)
    // triggers a real Loggro-side rendering bug (D-192, docs/decisions.md).
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({
        rows: [{ id: "line-1", description_snapshot: "Dorado de Pollo", quantity: "1", unit_price_minor_snapshot: "950000", external_product_id: "loggro-prod-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ request_line_id: "line-1", description_snapshot: "Guacamole", quantity: "1", unit_price_delta_minor_snapshot: "300000", external_product_id: "loggro-guac-1" }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

    await service(query, { createOrder }).pushOrder(tenantId, commercialRequestId);

    const [orderPayload] = createOrder.mock.calls[0].slice(2);
    expect(orderPayload.orders).toEqual([
      { product: "loggro-prod-1", quantity: 1, unit_price: 9500, notes: ["Pedido #00000301"] },
      {
        product: "loggro-guac-1",
        quantity: 1,
        unit_price: 3000,
        notes: ["Pedido #00000301", "Adición de: Dorado de Pollo"],
      },
    ]);
    expect(orderPayload.orders[0].productsExtra).toBeUndefined();
    expect(orderPayload.orders[1].productsExtra).toBeUndefined();
  });

  it("markFailed records pos_sync_status='failed' with the error message as the code", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });

    await service(query).markFailed(tenantId, commercialRequestId, new Error("Loggro API call failed with HTTP 500"));

    expect(String(query.mock.calls[0][0])).toContain("pos_sync_status='failed'");
    expect(query.mock.calls[0][1]).toEqual([commercialRequestId, "Loggro API call failed with HTTP 500"]);
  });

  // D-194 (docs/decisions.md): the tenant no longer points at one fixed
  // table — it keeps a real pool of tables sharing a name prefix (e.g.
  // "Bot Convomerce N") and the sync service resolves the first free one
  // live on every push, re-reading the real account so a table added later
  // with the same prefix needs no code/config change.
  describe("table pool resolution (D-188 punto 5, D-194)", () => {
    function lineRow() {
      return {
        rows: [{ id: "line-1", description_snapshot: "Tacos de pollo", quantity: "1", unit_price_minor_snapshot: "1000000", external_product_id: "loggro-prod-1" }],
      };
    }

    it("picks the lowest-numbered free table from the matching pool, ignoring tables outside the pattern", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(connectionRow())
        .mockResolvedValueOnce(requestRow())
        .mockResolvedValueOnce(lineRow())
        .mockResolvedValueOnce(noModifiers())
        .mockResolvedValueOnce({ rows: [] });
      const getTables = jest.fn().mockResolvedValue([
        { _id: "table-2", name: "Bot Convomerce 2", isActive: true, isHomeDelivery: false },
        { _id: "table-1", name: "Bot Convomerce 1", isActive: true, isHomeDelivery: false },
        { _id: "table-10", name: "Bot Convomerce 10", isActive: true, isHomeDelivery: false },
        { _id: "other", name: "Mesa 3", isActive: true, isHomeDelivery: false },
      ]);
      const getOccupiedTableIds = jest.fn().mockResolvedValue(new Set(["table-1"]));
      const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

      await service(query, { createOrder, getTables, getOccupiedTableIds }).pushOrder(tenantId, commercialRequestId);

      const [orderPayload] = createOrder.mock.calls[0].slice(2);
      expect(orderPayload.table).toBe("table-2");
      expect(getOccupiedTableIds).toHaveBeenCalledWith(tenantId, "conn-1", ["Espera", "Cocina", "Listo", "Entregado"]);
    });

    it("throws when no real Loggro table matches the configured pattern", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(connectionRow())
        .mockResolvedValueOnce(requestRow())
        .mockResolvedValueOnce(lineRow())
        .mockResolvedValueOnce(noModifiers());
      const getTables = jest.fn().mockResolvedValue([
        { _id: "other", name: "Mesa 3", isActive: true, isHomeDelivery: false },
      ]);
      const createOrder = jest.fn();

      await expect(service(query, { createOrder, getTables }).pushOrder(tenantId, commercialRequestId))
        .rejects.toThrow(/Bot Convomerce/);
      expect(createOrder).not.toHaveBeenCalled();
    });

    it("creates the next numbered table when every table in the pool is occupied (D-197, live finding)", async () => {
      // Confirmed live (developer.loggro.com/reference/guardarmesa): POST
      // /tables with no `_id` creates a real new table. Pedido explícito
      // del dueño del proyecto: en vez de fallar el pedido cuando el pool
      // entero está ocupado, crea la siguiente mesa numerada.
      const query = jest
        .fn()
        .mockResolvedValueOnce(connectionRow())
        .mockResolvedValueOnce(requestRow())
        .mockResolvedValueOnce(lineRow())
        .mockResolvedValueOnce(noModifiers())
        .mockResolvedValueOnce({ rows: [] });
      const getTables = jest.fn().mockResolvedValue([
        { _id: "table-1", name: "Bot Convomerce 1", isActive: true, isHomeDelivery: false },
        { _id: "table-2", name: "Bot Convomerce 2", isActive: true, isHomeDelivery: false },
      ]);
      const getOccupiedTableIds = jest.fn().mockResolvedValue(new Set(["table-1", "table-2"]));
      const createTable = jest.fn().mockResolvedValue({ _id: "table-3", name: "Bot Convomerce 3", isActive: true, isHomeDelivery: false });
      const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

      await service(query, { createOrder, getTables, getOccupiedTableIds, createTable }).pushOrder(tenantId, commercialRequestId);

      expect(createTable).toHaveBeenCalledWith(tenantId, "conn-1", "Bot Convomerce 3");
      const [orderPayload] = createOrder.mock.calls[0].slice(2);
      expect(orderPayload.table).toBe("table-3");
    });

    it("never reuses a deactivated table's number when creating the next one", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(connectionRow())
        .mockResolvedValueOnce(requestRow())
        .mockResolvedValueOnce(lineRow())
        .mockResolvedValueOnce(noModifiers())
        .mockResolvedValueOnce({ rows: [] });
      const getTables = jest.fn().mockResolvedValue([
        { _id: "table-1", name: "Bot Convomerce 1", isActive: true, isHomeDelivery: false },
        { _id: "table-5", name: "Bot Convomerce 5", isActive: false, isHomeDelivery: false },
      ]);
      const getOccupiedTableIds = jest.fn().mockResolvedValue(new Set(["table-1"]));
      const createTable = jest.fn().mockResolvedValue({ _id: "table-2", name: "Bot Convomerce 2", isActive: true, isHomeDelivery: false });
      const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

      await service(query, { createOrder, getTables, getOccupiedTableIds, createTable }).pushOrder(tenantId, commercialRequestId);

      expect(createTable).toHaveBeenCalledWith(tenantId, "conn-1", "Bot Convomerce 2");
    });

    it("never matches a deactivated table even if its name still fits the pattern (D-197, live finding)", async () => {
      // Found live: GET /tables keeps returning a table after it's
      // deactivated (isActive:false) — only a real DELETE removes it from
      // this list, and that call can fail on Loggro's side (e.g. an open
      // cash register blocks it). A leftover deactivated "Bot Convomerce
      // Prueba" table must never be picked as a real destination.
      const query = jest
        .fn()
        .mockResolvedValueOnce(connectionRow())
        .mockResolvedValueOnce(requestRow())
        .mockResolvedValueOnce(lineRow())
        .mockResolvedValueOnce(noModifiers())
        .mockResolvedValueOnce({ rows: [] });
      const getTables = jest.fn().mockResolvedValue([
        { _id: "table-inactive", name: "Bot Convomerce Prueba", isActive: false, isHomeDelivery: false },
        { _id: "table-2", name: "Bot Convomerce 2", isActive: true, isHomeDelivery: false },
      ]);
      const createOrder = jest.fn().mockResolvedValue([{ _id: "loggro-order-1", status: "Espera" }]);

      await service(query, { createOrder, getTables }).pushOrder(tenantId, commercialRequestId);

      const [orderPayload] = createOrder.mock.calls[0].slice(2);
      expect(orderPayload.table).toBe("table-2");
    });
  });

  describe("cancelOrder (D-202 reversed)", () => {
    const cancelService = (opts: {
      pattern?: string | null;
      externalIds?: string[] | null;
      tables?: { _id: string; name: string }[];
      ordersByTable?: Record<string, { _id: string; status: string }[]>;
      orderStatuses?: Record<string, string>;
    }) => {
      const query = jest.fn(async (sql: string) => {
        if (sql.includes("from app.pos_connections"))
          return { rows: [{ id: "conn-1", table_name_pattern: opts.pattern === undefined ? "Bot Convomerce" : opts.pattern }] };
        if (sql.includes("pos_external_order_id"))
          return { rows: [{ pos_external_order_id: opts.externalIds === undefined ? ["o1", "o2"] : opts.externalIds }] };
        return { rows: [] };
      });
      const api = {
        getTables: jest.fn().mockResolvedValue(
          opts.tables ?? [
            { _id: "t-bot", name: "Bot Convomerce 1" },
            { _id: "t-real", name: "Mesa 7" },
          ],
        ),
        getOrdersByTable: jest.fn(async (_t: string, _c: string, tableId: string) => opts.ordersByTable?.[tableId] ?? []),
        cancelOrder: jest.fn().mockResolvedValue({ _id: "x", status: "Cancelada" }),
        getOrder: jest.fn(async (_t: string, _c: string, id: string) => ({ _id: id, status: opts.orderStatuses?.[id] ?? "Espera" })),
      };
      const svc = new LoggroOrderSyncService(
        { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
        api as never,
      );
      return { svc, api };
    };

    it("cancels every order of the request that sits on a Bot Convomerce table, skipping ones already cancelled", async () => {
      const { svc, api } = cancelService({
        ordersByTable: { "t-bot": [{ _id: "o1", status: "Espera" }, { _id: "o2", status: "Cancelada" }] },
      });
      const result = await svc.cancelOrder(tenantId, commercialRequestId, "Cliente pidió cancelar");
      expect(result).toEqual({ cancelled: ["o1"], alreadyCancelled: ["o2"] });
      expect(api.cancelOrder).toHaveBeenCalledTimes(1);
      expect(api.cancelOrder).toHaveBeenCalledWith(tenantId, "conn-1", "o1", "Cliente pidió cancelar");
      expect(api.getOrdersByTable).not.toHaveBeenCalledWith(tenantId, "conn-1", "t-real");
    });

    it("refuses, cancelling NOTHING, when any order is not on a Bot Convomerce table", async () => {
      const { svc, api } = cancelService({
        ordersByTable: { "t-bot": [{ _id: "o1", status: "Espera" }], "t-real": [{ _id: "o2", status: "Espera" }] },
      });
      await expect(svc.cancelOrder(tenantId, commercialRequestId, "nota valida")).rejects.toMatchObject({ status: 400 });
      expect(api.cancelOrder).not.toHaveBeenCalled();
    });

    it("treats an order missing from the active by-table list but already cancelled in Loggro as done, so a retry after a partial failure works", async () => {
      const { svc, api } = cancelService({
        ordersByTable: { "t-bot": [{ _id: "o1", status: "Espera" }] },
        orderStatuses: { o2: "Cancelada" },
      });
      const result = await svc.cancelOrder(tenantId, commercialRequestId, "nota valida");
      expect(result).toEqual({ cancelled: ["o1"], alreadyCancelled: ["o2"] });
      expect(api.cancelOrder).toHaveBeenCalledTimes(1);
    });

    it("refuses when no Bot table pattern is configured (nothing to verify against)", async () => {
      const { svc, api } = cancelService({ pattern: null });
      await expect(svc.cancelOrder(tenantId, commercialRequestId, "nota valida")).rejects.toMatchObject({ status: 400 });
      expect(api.cancelOrder).not.toHaveBeenCalled();
    });

    it("does nothing for an order that never reached Loggro", async () => {
      const { svc, api } = cancelService({ externalIds: null });
      expect(await svc.cancelOrder(tenantId, commercialRequestId, "nota valida")).toEqual({ cancelled: [], alreadyCancelled: [] });
      expect(api.getTables).not.toHaveBeenCalled();
    });
  });
});
