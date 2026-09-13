import { TenantUsersService } from "./tenant-users.service";

// D-156 (docs/decisions.md): zero dedicated unit test coverage before this
// session's security review, despite owning invitations, role changes, and
// the last-owner protection for every tenant. Adds coverage for the parts
// most likely to silently regress: the pg-error-code -> HTTP-error mapping
// (invite/list/updateMembership/revokeInvitation all translate a raw
// Postgres error code from a SECURITY DEFINER function into a specific,
// user-facing error — a typo in a code here fails open into a generic 500
// instead of the intended 403/409), and exposeToken only ever leaking the
// invitation token outside NODE_ENV=production (D-154 already flagged that
// production being misconfigured as 'development' makes this leak live on
// the real pilot server today — this test at least pins the behavior so a
// future refactor of this exact check doesn't quietly change it further).
describe("TenantUsersService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const actorUserId = "0194f000-0000-7000-8000-000000000102";

  function pgError(code: string) {
    return Object.assign(new Error("pg error"), { code });
  }

  function service(query: jest.Mock, nodeEnv: string, send: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
    return new TenantUsersService(
      { withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op({ query }), withRuntimeTransaction: (op: (c: unknown) => unknown) => op({ query }) } as never,
      { send } as never,
      { get: jest.fn((key: string) => (key === "NODE_ENV" ? nodeEnv : "http://localhost:5173")) } as never,
    );
  }

  describe("invite", () => {
    it("exposes the raw invitation token outside production (dev/test convenience — no real email delivery configured)", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });

      const result = await service(query, "development").invite(tenantId, actorUserId, "new@commerce.test", "admin");

      expect(result.invitationToken).toEqual(expect.any(String));
    });

    it("never exposes the token in production, even to the actor who created it", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });

      const result = await service(query, "production").invite(tenantId, actorUserId, "new@commerce.test", "admin");

      expect(result.invitationToken).toBeUndefined();
    });

    it("translates the SECURITY DEFINER function's insufficient_privilege into TENANT_USERS_FORBIDDEN", async () => {
      const query = jest.fn().mockRejectedValue(pgError("42501"));

      await expect(
        service(query, "test").invite(tenantId, actorUserId, "new@commerce.test", "admin"),
      ).rejects.toMatchObject({ response: { code: "TENANT_USERS_FORBIDDEN" } });
    });

    it("translates a duplicate invitation/membership into a 409, not a raw constraint error", async () => {
      const query = jest.fn().mockRejectedValue(pgError("23505"));

      await expect(
        service(query, "test").invite(tenantId, actorUserId, "existing@commerce.test", "admin"),
      ).rejects.toMatchObject({ response: { code: "TENANT_INVITATION_DUPLICATE" } });
    });

    it("does not swallow an unrelated database error behind a misleading 403/409", async () => {
      const query = jest.fn().mockRejectedValue(new Error("connection reset"));

      await expect(
        service(query, "test").invite(tenantId, actorUserId, "new@commerce.test", "admin"),
      ).rejects.toThrow("connection reset");
    });

    it("emails the invitee a real accept link naming the tenant and role, not just a bare token", async () => {
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("from app.tenants")) return { rows: [{ display_name: "CrediCel Store" }] };
        return { rows: [] };
      });
      const send = jest.fn().mockResolvedValue(undefined);

      await service(query, "test", send).invite(tenantId, actorUserId, "invitee@example.com", "admin");

      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, text, html] = send.mock.calls[0];
      expect(to).toBe("invitee@example.com");
      expect(subject).toContain("CrediCel Store");
      expect(text).toContain("http://localhost:5173/accept-invite?token=");
      expect(html).toContain("http://localhost:5173/accept-invite?token=");
      expect(text).toContain("admin");
    });

    it("still sends the invitation email even without an email a client could double-check (never blocks on it)", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const send = jest.fn().mockResolvedValue(undefined);

      const result = await service(query, "test", send).invite(tenantId, actorUserId, "new@commerce.test", "viewer");

      expect(result.invitationId).toEqual(expect.any(String));
      expect(send).toHaveBeenCalled();
    });
  });

  describe("accept", () => {
    it("maps an invalid/expired invitation to 401, not a raw 28000", async () => {
      const query = jest.fn().mockRejectedValue(pgError("28000"));

      await expect(
        service(query, "test").accept("some-token", "Nueva persona", "a-real-password"),
      ).rejects.toMatchObject({ response: { code: "TENANT_INVITATION_INVALID" } });
    });

    it("maps an already-accepted invitation to a 409, not a raw unique-violation", async () => {
      const query = jest.fn().mockRejectedValue(pgError("23505"));

      await expect(
        service(query, "test").accept("some-token", "Nueva persona", "a-real-password"),
      ).rejects.toMatchObject({ response: { code: "TENANT_INVITATION_ACCEPTED" } });
    });

    it("returns the new membership on success", async () => {
      const query = jest.fn().mockResolvedValue({
        rows: [{ user_id: "user-1", tenant_id: tenantId }],
      });

      const result = await service(query, "test").accept("some-token", "Nueva persona", "a-real-password");

      expect(result).toEqual({ userId: "user-1", tenantId, accepted: true });
    });
  });

  describe("updateMembership", () => {
    it("translates insufficient_privilege into TENANT_USERS_FORBIDDEN", async () => {
      const query = jest.fn().mockRejectedValue(pgError("42501"));

      await expect(
        service(query, "test").updateMembership(tenantId, actorUserId, "membership-1", "admin", "active"),
      ).rejects.toMatchObject({ response: { code: "TENANT_USERS_FORBIDDEN" } });
    });

    it("translates the last-active-owner CHECK constraint into TENANT_LAST_OWNER, not a raw 23514", async () => {
      const query = jest.fn().mockRejectedValue(pgError("23514"));

      await expect(
        service(query, "test").updateMembership(tenantId, actorUserId, "membership-1", "viewer", "active"),
      ).rejects.toMatchObject({ response: { code: "TENANT_LAST_OWNER" } });
    });
  });

  describe("revokeInvitation", () => {
    it("translates insufficient_privilege into TENANT_USERS_FORBIDDEN", async () => {
      const query = jest.fn().mockRejectedValue(pgError("42501"));

      await expect(
        service(query, "test").revokeInvitation(tenantId, actorUserId, "invitation-1"),
      ).rejects.toMatchObject({ response: { code: "TENANT_USERS_FORBIDDEN" } });
    });
  });

  describe("list", () => {
    it("translates insufficient_privilege into TENANT_USERS_FORBIDDEN instead of leaking the raw pg error", async () => {
      const query = jest.fn().mockRejectedValue(pgError("42501"));

      await expect(service(query, "test").list(tenantId, actorUserId)).rejects.toMatchObject({
        response: { code: "TENANT_USERS_FORBIDDEN" },
      });
    });
  });
});
