import { ConversationsService } from "./conversations.service";

// D-156 (docs/decisions.md): this service had zero dedicated unit test
// coverage before this session's security review (D-154/D-155), despite
// owning the exact cross-tenant authorization gate (actor()) that keeps a
// valid session for one tenant from reading another tenant's real customer
// conversations — verified correct by manual code review during that
// review, now locked in by tests so a future change can't silently regress
// it without a test failing.
describe("ConversationsService", () => {
  const tenantId = "0194f000-0000-7000-8000-000000000001";
  const userId = "0194f000-0000-7000-8000-000000000102";
  const conversationId = "0194f003-0000-7000-8000-000000000001";

  function clientWith(overrides: {
    tenantUserRow?: { id: string; role: string } | undefined;
    platformAllowed?: boolean;
    extra?: (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;
  }) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("from app.tenant_users")) {
        return { rows: overrides.tenantUserRow ? [overrides.tenantUserRow] : [] };
      }
      if (sql.includes("can_manage_channel_connections")) {
        return { rows: [{ allowed: overrides.platformAllowed ?? false }] };
      }
      const extra = overrides.extra?.(sql, params);
      if (extra) return extra;
      return { rows: [] };
    });
    return { query, queries };
  }

  function service(client: { query: jest.Mock }) {
    return new ConversationsService({
      withTenantTransaction: (_id: string, op: (c: unknown) => unknown) => op(client),
    } as never);
  }

  describe("actor authorization (cross-tenant isolation)", () => {
    it("rejects a caller who is neither an active tenant member nor a platform admin", async () => {
      const { query } = clientWith({ tenantUserRow: undefined, platformAllowed: false });

      await expect(service({ query }).list(tenantId, userId)).rejects.toMatchObject({
        response: { code: "CONVERSATIONS_FORBIDDEN" },
      });
    });

    it("allows a platform admin who has no direct tenant membership", async () => {
      const { query } = clientWith({ tenantUserRow: undefined, platformAllowed: true });

      const result = await service({ query }).list(tenantId, userId);

      expect(result.canManage).toBe(true);
      expect(result.conversations).toEqual([]);
    });

    it("reports canManage:false for a viewer-role tenant member", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "membership-1", role: "viewer" } });

      const result = await service({ query }).list(tenantId, userId);

      expect(result.canManage).toBe(false);
    });

    it("reports canManage:true for a non-viewer tenant member", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "membership-1", role: "admin" } });

      const result = await service({ query }).list(tenantId, userId);

      expect(result.canManage).toBe(true);
    });

    it("blocks a viewer from a manage-only action (act/reply/retry) even though they can read", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "membership-1", role: "viewer" } });

      await expect(
        service({ query }).act(tenantId, userId, conversationId, "take"),
      ).rejects.toMatchObject({ response: { code: "CONVERSATIONS_FORBIDDEN" } });
    });
  });

  describe("list", () => {
    it("falls back display_name -> provider_subject -> 'Unknown contact', in that order", async () => {
      const rows = [
        { id: "c1", display_name: "Cristian", provider_subject: "57300", last_direction: "inbound" },
        { id: "c2", display_name: null, provider_subject: "57301", last_direction: "inbound" },
        { id: "c3", display_name: null, provider_subject: null, last_direction: "inbound" },
      ];
      const { query } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => (sql.includes("from app.conversations conversation") ? { rows } : undefined),
      });

      const result = await service({ query }).list(tenantId, userId);

      expect(result.conversations.map((c) => c.contactName)).toEqual([
        "Cristian",
        "57301",
        "Unknown contact",
      ]);
    });
  });

  describe("messages", () => {
    it("throws CONVERSATION_NOT_FOUND when the conversation doesn't belong to this tenant (RLS-filtered to zero rows)", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "m1", role: "admin" } });

      await expect(
        service({ query }).messages(tenantId, userId, conversationId),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    });

    it.each([
      // [finalBody, rewriting, expected generationOutcome]
      ["hola reescrita", { mode: "openai", deterministicBody: "hola original", model: "gpt" }, "rewritten"],
      ["hola exacta", { mode: "openai", deterministicBody: "hola exacta", model: "gpt" }, "reviewed"],
      ["hola", { mode: "library" }, "reused"],
      ["hola", { mode: "deterministic" }, "deterministic"],
      ["hola", { mode: "deterministic", fallbackReason: "timeout" }, "fallback"],
      ["hola", { mode: "deterministic", fallbackReason: "ineligible" }, "deterministic"],
      ["hola", undefined, null],
    ] as const)("maps rewriting metadata %#: %p to generationOutcome %p", async (body, rewriting, expected) => {
      const { query } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => {
          if (sql.includes("from app.conversations conversation"))
            return { rows: [{ id: conversationId, status: "open" }] };
          if (sql.includes("from app.messages message"))
            return {
              rows: [
                {
                  id: "msg-1",
                  direction: "outbound",
                  content: rewriting ? { body, decision: { rewriting } } : { body },
                  input_tokens: null,
                },
              ],
            };
          return undefined;
        },
      });

      const result = await service({ query }).messages(tenantId, userId, conversationId);

      expect(result.messages[0].generationOutcome).toBe(expected);
    });
  });

  describe("act", () => {
    it("throws CONVERSATION_NOT_FOUND when the update matches no row", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "m1", role: "admin" } });

      await expect(
        service({ query }).act(tenantId, userId, conversationId, "take"),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    });

    it("cascades close to cancel drafts, cancel the active workflow, and expire shown recommendations", async () => {
      const { query, queries } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => (sql.includes("update app.conversations") ? { rows: [{ id: conversationId }] } : undefined),
      });

      await service({ query }).act(tenantId, userId, conversationId, "close");

      expect(queries.some((q) => q.sql.includes("update app.commercial_requests"))).toBe(true);
      expect(queries.some((q) => q.sql.includes("update app.conversation_workflows"))).toBe(true);
      expect(queries.some((q) => q.sql.includes("update app.recommendation_events"))).toBe(true);
    });

    it("does not run the close cascade for 'take'/'bot'", async () => {
      const { query, queries } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => (sql.includes("update app.conversations") ? { rows: [{ id: conversationId }] } : undefined),
      });

      await service({ query }).act(tenantId, userId, conversationId, "bot");

      expect(queries.some((q) => q.sql.includes("update app.commercial_requests"))).toBe(false);
    });
  });

  describe("reply", () => {
    it("throws CONVERSATION_NOT_FOUND instead of inserting a message when the conversation can't be reopened", async () => {
      const { query, queries } = clientWith({ tenantUserRow: { id: "m1", role: "admin" } });

      await expect(
        service({ query }).reply(tenantId, userId, conversationId, "hola"),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
      expect(queries.some((q) => q.sql.includes("insert into app.messages"))).toBe(false);
    });

    it("inserts the outbound message and a matching outbox event on success", async () => {
      const { query, queries } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) =>
          sql.includes("update app.conversations") ? { rows: [{ channel_id: "channel-1" }] } : undefined,
      });

      const result = await service({ query }).reply(tenantId, userId, conversationId, "hola cliente");

      expect(result.deliveryStatus).toBe("queued");
      expect(queries.some((q) => q.sql.includes("insert into app.messages"))).toBe(true);
      expect(queries.some((q) => q.sql.includes("insert into app.outbox_events"))).toBe(true);
    });
  });

  describe("retry", () => {
    it("throws MESSAGE_NOT_RETRYABLE when no failed outbound message matches", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "m1", role: "admin" } });

      await expect(
        service({ query }).retry(tenantId, userId, conversationId, "message-1"),
      ).rejects.toMatchObject({ response: { code: "MESSAGE_NOT_RETRYABLE" } });
    });

    it("re-queues the message and enqueues a fresh outbox event", async () => {
      const { query, queries } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => (sql.includes("update app.messages") ? { rows: [{ id: "message-1" }] } : undefined),
      });

      const result = await service({ query }).retry(tenantId, userId, conversationId, "message-1");

      expect(result).toEqual({ retried: true, deliveryStatus: "queued" });
      expect(queries.some((q) => q.sql.includes("insert into app.outbox_events"))).toBe(true);
    });
  });

  describe("markRead", () => {
    it("throws CONVERSATION_NOT_FOUND for a conversation outside this tenant", async () => {
      const { query } = clientWith({ tenantUserRow: { id: "m1", role: "admin" } });

      await expect(
        service({ query }).markRead(tenantId, userId, conversationId),
      ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    });

    it("upserts the read marker when the conversation exists", async () => {
      const { query, queries } = clientWith({
        tenantUserRow: { id: "m1", role: "admin" },
        extra: (sql) => (sql.includes("select 1 from app.conversations") ? { rows: [{ "?column?": 1 }] } : undefined),
      });

      const result = await service({ query }).markRead(tenantId, userId, conversationId);

      expect(result).toEqual({ read: true });
      expect(queries.some((q) => q.sql.includes("insert into app.conversation_reads"))).toBe(true);
    });
  });
});
