import { LoggroApiClient } from "./loggro-api-client.service";

describe("LoggroApiClient", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const connectionId = "0194f000-0000-7000-8000-000000000201";

  function client(query: jest.Mock, decrypt?: jest.Mock) {
    return new LoggroApiClient(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
      {
        decrypt: decrypt ?? jest.fn(() => JSON.stringify({ email: "santos@example.com", password: "secret" })),
        encrypt: jest.fn(),
      } as never,
    );
  }

  afterEach(() => jest.restoreAllMocks());

  describe("login", () => {
    it("caches tokenCurrent and clears any prior error on success", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ secret_reference: "enc:v1:...:...:..." }] }) // read secret
        .mockResolvedValueOnce({ rows: [] }); // cache write
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ tokenCurrent: "jwt-token", business: { _id: "biz-1" } }),
      } as Response);

      const token = await client(query).login(tenantId, connectionId);

      expect(token).toBe("jwt-token");
      const cacheWrite = query.mock.calls[1][0] as string;
      expect(cacheWrite).toContain("cached_token=$2");
      expect(query.mock.calls[1][1]).toEqual([connectionId, "jwt-token", "biz-1"]);
    });

    it("throws a real error and records it, instead of leaking a raw fetch failure, on bad credentials", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ secret_reference: "enc:v1:...:...:..." }] })
        .mockResolvedValueOnce({ rows: [] }); // error write
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 400, json: async () => ({}) } as Response);

      await expect(client(query).login(tenantId, connectionId)).rejects.toThrow(/HTTP 400/);
      expect(String(query.mock.calls[1][0])).toContain("status='error'");
    });

    it("throws before ever calling fetch when no credentials are stored", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const fetchSpy = jest.spyOn(global, "fetch");

      await expect(client(query).login(tenantId, connectionId)).rejects.toThrow(/no stored credentials/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("withAuth (401 handling)", () => {
    it("retries exactly once after a single 401, using the freshly re-logged-in token", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ cached_token: "stale-token" }] }) // resolveToken
        .mockResolvedValueOnce({ rows: [{ secret_reference: "enc:v1:...:...:..." }] }) // login's secret read
        .mockResolvedValueOnce({ rows: [] }); // login's cache write
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response) // first products call
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tokenCurrent: "fresh-token" }) } as Response) // login
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ _id: "p1", name: "Taco" }] }) } as Response); // retried products call

      const products = await client(query).getProducts(tenantId, connectionId);

      expect(products).toEqual([{ _id: "p1", name: "Taco" }]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect((fetchSpy.mock.calls[2][1] as RequestInit).headers).toMatchObject({
        authorization: "Bearer fresh-token",
      });
    });

    it("surfaces a real error instead of looping when the retried call also 401s", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ cached_token: "stale-token" }] })
        .mockResolvedValueOnce({ rows: [{ secret_reference: "enc:v1:...:...:..." }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }); // error write after second 401
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tokenCurrent: "fresh-token" }) } as Response)
        .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "still unauthorized" } as Response);

      await expect(client(query).getProducts(tenantId, connectionId)).rejects.toThrow(/HTTP 401/);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // never a 4th attempt
    });
  });

  describe("getOccupiedTableIds", () => {
    it("unions the table ids returned across every status queried", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ cached_token: "cached-token" }] });
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({ ok: true, json: async () => [{ _id: "table-1", total: 10000 }] } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { _id: "table-2", total: 5000 },
            { _id: "table-1", total: 10000 },
          ],
        } as Response);

      const occupied = await client(query).getOccupiedTableIds(tenantId, connectionId, ["Espera", "Cocina"]);

      expect(occupied).toEqual(new Set(["table-1", "table-2"]));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe("https://api.pirpos.com/orders/tables/status/Espera");
      expect(fetchSpy.mock.calls[1][0]).toBe("https://api.pirpos.com/orders/tables/status/Cocina");
    });
  });

  describe("createOrder", () => {
    it("POSTs the exact payload it was given, with the resolved bearer token", async () => {
      const query = jest.fn().mockResolvedValueOnce({ rows: [{ cached_token: "cached-token" }] });
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ ok: true, json: async () => [{ _id: "order-1", status: "Espera" }] } as Response);
      const payload = {
        table: "table-1",
        group: "group-1",
        groupName: "WhatsApp - Pedido ABC12345",
        orders: [{ product: "prod-1", quantity: 2, unit_price: 15000, notes: ["Sin cebolla"] }],
      };

      const created = await client(query).createOrder(tenantId, connectionId, payload);

      expect(created).toEqual([{ _id: "order-1", status: "Espera" }]);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.pirpos.com/orders");
      expect((init as RequestInit).method).toBe("POST");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);
    });
  });
});
