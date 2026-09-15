import { LoggroConnectionService } from "./loggro-connection.service";

describe("LoggroConnectionService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const userId = "0194f000-0000-7000-8000-000000000102";

  function service(
    query: jest.Mock,
    apiClient?: Partial<{ login: jest.Mock; getTables: jest.Mock }>,
    credentials?: { encrypt: jest.Mock; decrypt: jest.Mock },
  ) {
    const resolvedCredentials =
      credentials ?? { encrypt: jest.fn((value: string) => `enc:${value}`), decrypt: jest.fn() };
    return new LoggroConnectionService(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
      resolvedCredentials as never,
      { login: apiClient?.login ?? jest.fn(), getTables: apiClient?.getTables ?? jest.fn() } as never,
    );
  }

  it("rejects an actor who cannot manage connections", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ allowed: false }] });

    await expect(service(query).connect(tenantId, userId, { email: "a@b.com", password: "x" }))
      .rejects.toMatchObject({ response: { code: "LOGGRO_FORBIDDEN" } });
  });

  it("requires a password on the very first connect (no existing secret to fall back to)", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [] }); // no existing pos_connections row

    await expect(service(query).connect(tenantId, userId, { email: "a@b.com" }))
      .rejects.toMatchObject({ response: { code: "LOGGRO_CREDENTIALS_REQUIRED" } });
  });

  it("omitting password on a re-save reuses the already-encrypted stored secret, never re-encrypting it", async () => {
    const encrypt = jest.fn();
    const decrypt = jest.fn();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "conn-1", secret_reference: "enc:already-stored" }] })
      .mockResolvedValueOnce({ rows: [] }); // update
    const login = jest.fn().mockResolvedValue("token");

    const result = await service(query, { login }, { encrypt, decrypt }).connect(tenantId, userId, { email: "a@b.com" });

    expect(result).toEqual({ connectionId: "conn-1" });
    expect(encrypt).not.toHaveBeenCalled();
    const update = query.mock.calls[2];
    expect(String(update[0])).toContain("update app.pos_connections set secret_reference=$2");
    expect(update[1]).toEqual(["conn-1", "enc:already-stored"]);
    expect(login).toHaveBeenCalledWith(tenantId, "conn-1");
  });

  it("encrypts a freshly provided email+password and validates it immediately against the real login endpoint", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [] }) // no existing row -> insert path
      .mockResolvedValueOnce({ rows: [] }); // insert
    const login = jest.fn().mockResolvedValue("token");

    const result = await service(query, { login }).connect(tenantId, userId, {
      email: "santos@example.com",
      password: "real-password",
    });

    expect(result.connectionId).toBeDefined();
    const insert = query.mock.calls[2];
    expect(String(insert[0])).toContain("insert into app.pos_connections");
    expect(insert[1][2]).toBe('enc:{"email":"santos@example.com","password":"real-password"}');
    expect(login).toHaveBeenCalledWith(tenantId, result.connectionId);
  });

  it("setHomeDeliveryTable throws when Loggro was never connected for this tenant", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(service(query).setHomeDeliveryTable(tenantId, userId, "table-1"))
      .rejects.toMatchObject({ response: { code: "LOGGRO_NOT_CONNECTED" } });
  });

  it("status never leaks the secret itself, only whether one is configured", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({
        rows: [{
          status: "connected", secret_reference: "enc:real-secret", home_delivery_table_id: "table-1",
          last_synced_at: null, last_error_code: null,
        }],
      });

    const status = await service(query).status(tenantId, userId);

    expect(status).toEqual({
      connected: true, status: "connected", secretConfigured: true,
      homeDeliveryTableId: "table-1", lastSyncedAt: null, lastErrorCode: null,
    });
    expect(JSON.stringify(status)).not.toContain("real-secret");
  });
});
