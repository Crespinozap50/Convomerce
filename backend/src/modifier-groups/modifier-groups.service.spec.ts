import { ModifierGroupsService } from "./modifier-groups.service";

describe("ModifierGroupsService", () => {
  const service = (client: { query: jest.Mock }) =>
    new ModifierGroupsService({
      withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) =>
        operation(client),
    } as never);

  it("rejects managing extras when the actor lacks permission", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ allowed: false }] }) };

    await expect(
      service(client).createGroup("tenant-1", "user-1", { name: "Extras", selectionType: "multiple" }),
    ).rejects.toThrow("Actor cannot manage extras");
  });

  it("creates a single-select group with max_selections locked to 1", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await service(client).createGroup("tenant-1", "user-1", { name: "Salsa", selectionType: "single" });

    const [, params] = client.query.mock.calls[1];
    expect(params[3]).toBe("single");
    expect(params[4]).toBe(1);
  });

  it("creates a multiple-select group with no max_selections cap", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await service(client).createGroup("tenant-1", "user-1", { name: "Extras", selectionType: "multiple" });

    const [, params] = client.query.mock.calls[1];
    expect(params[4]).toBeNull();
  });

  it("replaces the full set of extras groups assigned to a product", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [{ id: "item-1" }] }) // item exists
        .mockResolvedValueOnce({ rows: [] }) // delete existing links
        .mockResolvedValueOnce({ rows: [] }) // insert group-a
        .mockResolvedValueOnce({ rows: [] }), // insert group-b
    };

    await service(client).setItemGroups("tenant-1", "user-1", "item-1", ["group-a", "group-b"]);

    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes("delete from app.item_modifier_groups")),
    ).toBe(true);
    expect(
      client.query.mock.calls.filter(([sql]) => String(sql).includes("insert into app.item_modifier_groups")),
    ).toHaveLength(2);
  });

  it("rejects assigning extras to an offering that does not exist", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowed: true }] })
        .mockResolvedValueOnce({ rows: [] }), // item lookup: not found
    };

    await expect(
      service(client).setItemGroups("tenant-1", "user-1", "missing-item", ["group-a"]),
    ).rejects.toThrow("Offering was not found");
  });
});
