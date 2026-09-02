import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { v7 as uuidv7 } from "uuid";
import { DatabaseService } from "../database/database.service";
import { AiRewriteContext } from "./ai-usage-budget.service";
import { ComposedResponse, ResponsePlan } from "./response-plan.types";

@Injectable()
export class ApprovedResponseVariantService {
  constructor(private readonly database: DatabaseService) {}

  async find(
    context: AiRewriteContext,
    plan: ResponsePlan,
    response: ComposedResponse,
    protectedFacts: string[],
  ): Promise<
    | { body: string; variantId: string; status: "approved" }
    | { status: "candidate" | "rejected" }
    | null
  > {
    const identity = this.identity(plan, response, protectedFacts);
    if (!identity) return null;
    return this.database.withTenantTransaction(
      context.tenantId,
      async (client) => {
        const result = await client.query<{
          id: string;
          tenant_id: string | null;
          variant_body: string;
          status: "candidate" | "approved" | "rejected";
        }>(
          `select id,tenant_id,variant_body,status
           from app.approved_response_variants
          where template_namespace=$1 and template_key=$2
            and locale=$3 and template_version=$4 and input_hash=$5
          order by case when tenant_id=app.current_tenant_id() then 0 else 1 end
          limit 1`,
          [
            identity.namespace,
            identity.key,
            response.locale,
            identity.version,
            identity.hash,
          ],
        );
        const variant = result.rows[0];
        if (!variant) return null;
        if (variant.status !== "approved") return { status: variant.status };
        if (variant.tenant_id) {
          await client.query(
            `update app.approved_response_variants
              set use_count=use_count+1,last_used_at=now(),updated_at=now()
            where id=$1`,
            [variant.id],
          );
        }
        return {
          body: variant.variant_body,
          variantId: variant.id,
          status: "approved",
        };
      },
    );
  }

  async remember(
    context: AiRewriteContext,
    plan: ResponsePlan,
    response: ComposedResponse,
    variantBody: string,
    protectedFacts: string[],
  ): Promise<void> {
    const identity = this.identity(plan, response, protectedFacts);
    if (!identity) return;
    await this.database.withTenantTransaction(
      context.tenantId,
      async (client) => {
        await client.query(
          `insert into app.approved_response_variants
          (id,tenant_id,scope,template_namespace,template_key,locale,template_version,input_hash,
           deterministic_body,variant_body,protected_facts,status,source)
         values($1,app.current_tenant_id(),'tenant',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'candidate','openai')
         on conflict (tenant_id,template_namespace,template_key,locale,template_version,input_hash)
           where scope='tenant'
         do update set variant_body=excluded.variant_body,protected_facts=excluded.protected_facts,
                       status='candidate',source='openai',updated_at=now()
          where app.approved_response_variants.status<>'approved'`,
          [
            uuidv7(),
            identity.namespace,
            identity.key,
            response.locale,
            identity.version,
            identity.hash,
            response.body,
            variantBody,
            JSON.stringify(protectedFacts),
          ],
        );
      },
    );
  }

  private identity(
    plan: ResponsePlan,
    response: ComposedResponse,
    protectedFacts: string[],
  ) {
    if (plan.kind !== "localized_template") return null;
    const version = 1;
    const hash = createHash("sha256")
      .update(JSON.stringify({ protectedFacts }))
      .digest("hex");
    return {
      namespace: plan.template.namespace,
      key: plan.template.key,
      version,
      hash,
    };
  }
}
