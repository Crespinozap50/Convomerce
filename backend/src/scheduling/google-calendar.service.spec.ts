import { GoogleCalendarService } from "./google-calendar.service";

// D-156 (docs/decisions.md): zero dedicated unit test coverage before this
// session's security review, despite this service owning the HMAC-signed
// OAuth `state` (CSRF protection for the Google Calendar connect flow,
// reviewed and confirmed sound in D-154) and the encryption of Google
// refresh tokens at rest. Covers the parts most likely to silently regress:
// state forgery/tampering/expiry, the access-check gate, and mapping a
// failed token exchange to a real error instead of a raw fetch() throw.
describe("GoogleCalendarService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const userId = "0194f000-0000-7000-8000-000000000102";
  const configValues: Record<string, string> = {
    GOOGLE_CALENDAR_CLIENT_ID: "client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
    CREDENTIAL_ENCRYPTION_KEY: "a-real-32-plus-character-encryption-key-value",
    FRONTEND_ORIGIN: "http://localhost:5173",
  };

  function service(query: jest.Mock, credentials?: Partial<{ encrypt: jest.Mock; decrypt: jest.Mock }>) {
    return new GoogleCalendarService(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }) } as never,
      { get: jest.fn((key: string) => configValues[key]) } as never,
      {
        encrypt: credentials?.encrypt ?? jest.fn((value: string) => `enc:${value}`),
        decrypt: credentials?.decrypt ?? jest.fn((value: string) => value.replace(/^enc:/, "")),
      } as never,
    );
  }

  function extractState(authorizationUrl: string): string {
    const state = new URL(authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("test setup: no state on generated authorization URL");
    return state;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("authorizationUrl (access gate)", () => {
    it("rejects a viewer with no platform-admin fallback", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "viewer" }] });

      await expect(service(query).authorizationUrl(tenantId, userId)).rejects.toMatchObject({
        response: { code: "GOOGLE_CALENDAR_FORBIDDEN" },
      });
    });

    it("allows a non-viewer tenant member and issues a state a later callback can validate", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] });

      const { authorizationUrl } = await service(query).authorizationUrl(tenantId, userId);

      const url = new URL(authorizationUrl);
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(extractState(authorizationUrl).split(".")).toHaveLength(2);
    });

    it("falls back to the platform-admin check when the actor has no direct membership", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // no tenant_users row
        .mockResolvedValueOnce({ rows: [{ allowed: true }] }); // can_manage_channel_connections

      await expect(service(query).authorizationUrl(tenantId, userId)).resolves.toEqual(
        expect.objectContaining({ authorizationUrl: expect.any(String) }),
      );
    });
  });

  describe("callback (OAuth state forgery/tampering/expiry)", () => {
    it("rejects a state with no signature at all", async () => {
      await expect(service(jest.fn()).callback("some-code", "not-a-real-state")).rejects.toMatchObject({
        response: { code: "GOOGLE_OAUTH_STATE_INVALID" },
      });
    });

    it("rejects a forged state signed with the wrong key (a different service instance's signature)", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] });
      const legitimate = service(query);
      const attacker = new GoogleCalendarService(
        {
          withTenantTransaction: (_id: string, op: (c: unknown) => unknown) =>
            op({ query: jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] }) }),
        } as never,
        { get: jest.fn((key: string) => (key === "CREDENTIAL_ENCRYPTION_KEY" ? "a-totally-different-encryption-key-value" : configValues[key])) } as never,
        { encrypt: jest.fn(), decrypt: jest.fn() } as never,
      );
      const { authorizationUrl } = await attacker.authorizationUrl(tenantId, userId);
      const forgedState = extractState(authorizationUrl);

      await expect(legitimate.callback("some-code", forgedState)).rejects.toMatchObject({
        response: { code: "GOOGLE_OAUTH_STATE_INVALID" },
      });
    });

    it("rejects a tampered payload (same signature, different tenantId spliced in)", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] });
      const svc = service(query);
      const { authorizationUrl } = await svc.authorizationUrl(tenantId, userId);
      const [, signature] = extractState(authorizationUrl).split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ tenantId: "0194f000-0000-7000-8000-000000000099", userId, expiresAt: Date.now() + 600000 }),
      ).toString("base64url");

      await expect(svc.callback("some-code", `${forgedPayload}.${signature}`)).rejects.toMatchObject({
        response: { code: "GOOGLE_OAUTH_STATE_INVALID" },
      });
    });

    it("rejects an expired state even with a genuinely valid signature", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] });
      const svc = service(query);
      jest.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
      const { authorizationUrl } = await svc.authorizationUrl(tenantId, userId);
      const state = extractState(authorizationUrl);
      jest.spyOn(Date, "now").mockReturnValue(1_000_000_000_000 + 700_000); // past the 10-minute window

      await expect(svc.callback("some-code", state)).rejects.toMatchObject({
        response: { code: "GOOGLE_OAUTH_STATE_EXPIRED" },
      });
    });

    it("maps a failed token exchange to a real error instead of leaking a raw fetch failure", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "admin" }] });
      const svc = service(query);
      const { authorizationUrl } = await svc.authorizationUrl(tenantId, userId);
      const state = extractState(authorizationUrl);
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_grant" }),
      } as Response);

      await expect(svc.callback("bad-code", state)).rejects.toMatchObject({
        response: { code: "GOOGLE_TOKEN_EXCHANGE_FAILED" },
      });
    });

    it("encrypts the refresh token before storing it, and returns the configured frontend origin", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: "admin" }] }) // authorizationUrl's membership check
        .mockResolvedValueOnce({ rows: [] }) // callback's existing-source lookup: none yet, so it inserts
        .mockResolvedValueOnce({ rows: [] }); // the insert itself
      const encrypt = jest.fn((value: string) => `enc:${value}`);
      const svc = service(query, { encrypt });
      const { authorizationUrl } = await svc.authorizationUrl(tenantId, userId);
      const state = extractState(authorizationUrl);
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ refresh_token: "real-refresh-token" }),
      } as Response);

      const redirectTarget = await svc.callback("good-code", state);

      expect(redirectTarget).toBe("http://localhost:5173");
      expect(encrypt).toHaveBeenCalledWith("real-refresh-token");
    });
  });

  describe("calendars (access gate + response mapping)", () => {
    it("rejects a viewer with no platform-admin fallback", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ role: "viewer" }] });

      await expect(service(query).calendars(tenantId, userId, "source-1")).rejects.toMatchObject({
        response: { code: "GOOGLE_CALENDAR_FORBIDDEN" },
      });
    });

    it("rejects when the calendar source has no stored credential", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
        .mockResolvedValueOnce({ rows: [{ secret_reference: null }] });

      await expect(service(query).calendars(tenantId, userId, "source-1")).rejects.toMatchObject({
        response: { code: "GOOGLE_CALENDAR_NOT_CONNECTED" },
      });
    });

    it("sorts the primary calendar first, then alphabetically", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: "admin" }] })
        .mockResolvedValueOnce({ rows: [{ secret_reference: "enc:refresh-token" }] });
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "access-token" }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              { id: "b", summary: "Bravo", primary: false },
              { id: "a", summary: "Alpha", primary: false },
              { id: "z", summary: "Zulu (primary)", primary: true },
            ],
          }),
        } as Response);

      const result = await service(query).calendars(tenantId, userId, "source-1");

      expect(result.calendars.map((c) => c.id)).toEqual(["z", "a", "b"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
