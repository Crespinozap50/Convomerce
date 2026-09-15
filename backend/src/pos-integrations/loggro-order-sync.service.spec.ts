import { LoggroOrderSyncService } from "./loggro-order-sync.service";

describe("LoggroOrderSyncService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const commercialRequestId = "0194f000-0000-7000-8000-000000000301";

  function service(query: jest.Mock, apiClient?: Partial<{ createOrder: jest.Mock }>) {
    return new LoggroOrderSyncService(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
      { createOrder: apiClient?.createOrder ?? jest.fn() } as never,
    );
  }

  function connectionRow(homeDeliveryTableId: string | null = "table-1") {
    return { rows: [{ id: "conn-1", home_delivery_table_id: homeDeliveryTableId }] };
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

  it("throws when the tenant has no home-delivery table configured, before calling the Loggro API", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(connectionRow(null))
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(noModifiers());
    const createOrder = jest.fn();

    await expect(service(query, { createOrder }).pushOrder(tenantId, commercialRequestId))
      .rejects.toThrow(/home-delivery table/);
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

    expect(result).toEqual({ externalOrderId: "loggro-order-1" });
    const [orderPayload] = createOrder.mock.calls[0].slice(2);
    expect(orderPayload.table).toBe("table-1");
    expect(orderPayload.orders).toEqual([
      { product: "loggro-prod-1", quantity: 2, unit_price: 17900, notes: ["Pedido #00000301"] },
    ]);
    expect(orderPayload.groupName).toBe("WhatsApp - Pedido 00000301");
    const finalWrite = query.mock.calls[4];
    expect(String(finalWrite[0])).toContain("pos_sync_status='synced'");
    expect(finalWrite[1]).toEqual([commercialRequestId, "loggro-order-1"]);
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

  it("sends a mapped modifier as its own priced productsExtra entry, not just free text (live finding, Santiago, Santos Tacos)", async () => {
    // Found live: "Guacamole" (+$3.000) reached Loggro only as text inside
    // the parent line's notes — the real order there registered $9.500
    // (just the taco) when the customer had actually been charged
    // $12.500. A modifier mapped in app.pos_product_mappings now goes out
    // with its real price via Loggro's own productsExtra field.
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
    expect(orderPayload.orders[0].productsExtra).toEqual([
      { product: "loggro-guac-1", quantity: 1, price: 3000 },
    ]);
    expect(orderPayload.orders[0].notes).toEqual(["Pedido #00000301"]);
  });

  it("markFailed records pos_sync_status='failed' with the error message as the code", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });

    await service(query).markFailed(tenantId, commercialRequestId, new Error("Loggro API call failed with HTTP 500"));

    expect(String(query.mock.calls[0][0])).toContain("pos_sync_status='failed'");
    expect(query.mock.calls[0][1]).toEqual([commercialRequestId, "Loggro API call failed with HTTP 500"]);
  });
});
