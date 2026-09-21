import { UpsellSuggestionsService } from "./upsell-suggestions.service";

const db = (query: jest.Mock) =>
  ({ withTenantTransaction: (_tenant: string, run: (client: unknown) => unknown) => run({ query }) }) as never;

describe("UpsellSuggestionsService", () => {
  it("groups every rule that offers the same product into one suggestion and reports the switch", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ upsell_enabled: false }] })
      .mockResolvedValueOnce({
        rows: [
          { target_variant_id: "t1", product_name: "Agua fresca de tamarindo", variant_name: "Unidad", price_minor: "700000", currency: "COP", active: true, available: true, source_variant_id: "s1", source_name: "Tacos de pollo" },
          { target_variant_id: "t1", product_name: "Agua fresca de tamarindo", variant_name: "Unidad", price_minor: "700000", currency: "COP", active: false, available: true, source_variant_id: "s2", source_name: "Tacos de birria" },
        ],
      });
    const result = await new UpsellSuggestionsService(db(query)).get("tenant", "user");
    expect(result.enabled).toBe(false);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].active).toBe(true);
    expect(result.suggestions[0].offeredWith.map((s) => s.name)).toEqual(["Tacos de pollo", "Tacos de birria"]);
  });

  it("defaults the general switch to ON when the tenant has no bot configuration row", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect((await new UpsellSuggestionsService(db(query)).get("tenant", "user")).enabled).toBe(true);
  });

  it("turns a single suggestion off through the permission-checked function", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ changed: 5 }] });
    const result = await new UpsellSuggestionsService(db(query)).setTarget("tenant", "user", "t1", false);
    expect(query).toHaveBeenCalledWith("select app.set_upsell_target($1,$2,$3) changed", ["user", "t1", false]);
    expect(result).toEqual({ saved: true, targetVariantId: "t1", active: false });
  });

  it("answers not found when no rule offers that product", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ changed: 0 }] });
    await expect(new UpsellSuggestionsService(db(query)).setTarget("tenant", "user", "t9", true)).rejects.toBeDefined();
  });

  it("maps a database permission error to forbidden", async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "42501" }));
    await expect(new UpsellSuggestionsService(db(query)).setEnabled("tenant", "user", true)).rejects.toMatchObject({
      status: 403,
    });
  });
});
