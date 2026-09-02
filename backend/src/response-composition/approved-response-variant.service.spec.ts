import { ApprovedResponseVariantService } from "./approved-response-variant.service";

describe("ApprovedResponseVariantService", () => {
  const context = {
    tenantId: "0194f000-0000-7000-8000-000000000001",
    conversationId: "0194f003-0000-7000-8000-000000000001",
    messageId: "0194f004-0000-7000-8000-000000000001",
  };
  const plan = {
    kind: "localized_template" as const,
    template: {
      namespace: "commercial" as const,
      key: "itemUnknown" as const,
    },
  };
  const response = {
    body: 'No encontré ese producto. Escribe "ver menú".',
    locale: "es" as const,
    composition: "template" as const,
  };

  it("returns an approved variant and records tenant reuse", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "variant-1",
            tenant_id: context.tenantId,
            variant_body: 'No lo encontré. Puedes escribir "ver menú".',
            status: "approved",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const database = {
      withTenantTransaction: jest.fn((_tenantId, operation) =>
        operation({ query }),
      ),
    };
    const service = new ApprovedResponseVariantService(database as never);

    await expect(service.find(context, plan, response, [])).resolves.toEqual({
      body: 'No lo encontré. Puedes escribir "ver menú".',
      variantId: "variant-1",
      status: "approved",
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1][0])).toContain("use_count=use_count+1");
  });

  it("stores a validated OpenAI result as a tenant candidate", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const database = {
      withTenantTransaction: jest.fn((_tenantId, operation) =>
        operation({ query }),
      ),
    };
    const service = new ApprovedResponseVariantService(database as never);

    await service.remember(
      context,
      plan,
      response,
      'No lo encontré. Puedes escribir "ver menú".',
      [],
    );

    expect(String(query.mock.calls[0][0])).toContain(
      "approved_response_variants",
    );
    expect(String(query.mock.calls[0][0])).toContain("'candidate','openai'");
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "commercial",
        "itemUnknown",
        "es",
        response.body,
        'No lo encontré. Puedes escribir "ver menú".',
      ]),
    );
  });

  it("returns a candidate without reusing its text", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: "variant-2",
          tenant_id: context.tenantId,
          variant_body: "Unapproved text",
          status: "candidate",
        },
      ],
    });
    const database = {
      withTenantTransaction: jest.fn((_tenantId, operation) =>
        operation({ query }),
      ),
    };
    const service = new ApprovedResponseVariantService(database as never);

    await expect(service.find(context, plan, response, [])).resolves.toEqual({
      status: "candidate",
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps the same identity when only base wording changes", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const database = {
      withTenantTransaction: jest.fn((_tenantId, operation) =>
        operation({ query }),
      ),
    };
    const service = new ApprovedResponseVariantService(database as never);

    await service.find(context, plan, response, []);
    await service.find(
      context,
      plan,
      { ...response, body: `${response.body} ` },
      [],
    );

    expect(query.mock.calls[0][1][4]).toBe(query.mock.calls[1][1][4]);
  });
});
