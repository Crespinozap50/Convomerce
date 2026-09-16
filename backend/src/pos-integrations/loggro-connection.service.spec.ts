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

  it("setTableNamePattern throws when Loggro was never connected for this tenant", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(service(query).setTableNamePattern(tenantId, userId, "Bot Convomerce"))
      .rejects.toMatchObject({ response: { code: "LOGGRO_NOT_CONNECTED" } });
  });

  it("setTableNamePattern saves the pattern, not a table id", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await service(query).setTableNamePattern(tenantId, userId, "Bot Convomerce");

    expect(result).toEqual({ tableNamePattern: "Bot Convomerce" });
    const update = query.mock.calls[1];
    expect(String(update[0])).toContain("update app.pos_connections set table_name_pattern=$2");
    expect(update[1]).toEqual([tenantId, "Bot Convomerce"]);
  });

  it("status never leaks the secret itself, only whether one is configured", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({
        rows: [{
          status: "connected", secret_reference: "enc:real-secret", table_name_pattern: "Bot Convomerce",
          last_synced_at: null, last_error_code: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] });

    const status = await service(query).status(tenantId, userId);

    expect(status).toEqual({
      connected: true, status: "connected", secretConfigured: true,
      tableNamePattern: "Bot Convomerce", lastSyncedAt: null, lastErrorCode: null, enabled: true,
    });
    expect(JSON.stringify(status)).not.toContain("real-secret");
  });

  describe("setEnabled (D-201)", () => {
    it("refuses to enable when Loggro was never connected for this tenant", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [] }); // no connected pos_connections row

      await expect(service(query).setEnabled(tenantId, userId, true))
        .rejects.toMatchObject({ response: { code: "LOGGRO_NOT_CONNECTED" } });
    });

    it("refuses to enable before a table pool pattern is configured", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [{ table_name_pattern: null }] });

      await expect(service(query).setEnabled(tenantId, userId, true))
        .rejects.toMatchObject({ response: { code: "LOGGRO_TABLE_PATTERN_REQUIRED" } });
    });

    it("enables loggro_pos while preserving every other already-enabled capability", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [{ table_name_pattern: "Bot Convomerce" }] })
        .mockResolvedValueOnce({ rows: [{ capability: "orders" }, { capability: "delivery" }] })
        .mockResolvedValueOnce({ rows: [] }); // save_tenant_capabilities

      const result = await service(query).setEnabled(tenantId, userId, true);

      expect(result).toEqual({ enabled: true });
      const save = query.mock.calls[3];
      expect(String(save[0])).toContain("select app.save_tenant_capabilities($1,$2::text[])");
      expect(save[1][0]).toBe(userId);
      expect(save[1][1]).toEqual(expect.arrayContaining(["orders", "delivery", "loggro_pos"]));
      expect(save[1][1]).toHaveLength(3);
    });

    it("disables loggro_pos without touching or requiring a connection/pattern check", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [{ capability: "orders" }, { capability: "loggro_pos" }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service(query).setEnabled(tenantId, userId, false);

      expect(result).toEqual({ enabled: false });
      const save = query.mock.calls[2];
      expect(save[1][1]).toEqual(["orders"]);
    });
  });
});
