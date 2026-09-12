import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { forbidden } from '../observability/http-errors';
import { catalogFor, ConversationLocale } from '../localization/localization';

export type AiResponsePolicyInput={enabled:boolean;rolloutPercentage:number;dailyRequestLimit:number;monthlyCostLimitMinor:number};
export type BotConfigInput = { enabled:boolean; assistantName:string; locale:ConversationLocale; welcomeMessage:string; fallbackMessage:string; handoffKeywords:string[];aiResponsePolicy:AiResponsePolicyInput;conversationTimeoutMinutes:number|null;messageRetentionDays:number|null;categoryLabelPrefix:string|null };
@Injectable()
export class BotConfigService {
  constructor(private readonly database: DatabaseService) {}
  get(tenantId:string, actorUserId:string) {
    return this.database.withTenantTransaction(tenantId, async client => {
      const access=await client.query<{allowed:boolean}>(`select app.can_manage_channel_connections($1) or exists(select 1 from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active') as allowed`,[actorUserId]);
      if(!access.rows[0]?.allowed) throw forbidden('BOT_CONFIG_FORBIDDEN','Actor is not authorized to view bot configuration');
      const result=await client.query(`select enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,conversation_timeout_minutes,message_retention_days,category_label_prefix from app.bot_configurations`);
      const policyResult=await client.query(`select enabled,rollout_percentage,daily_request_limit,monthly_cost_limit_minor::int,cost_currency from app.ai_response_policies`);
      const defaults=catalogFor('en').bot;
      const row=result.rows[0] ?? {enabled:false,assistant_name:'Commerce Assistant',locale:'en',welcome_message:defaults.defaultWelcome,fallback_message:defaults.defaultFallback,handoff_keywords:defaults.defaultHandoffKeywords,conversation_timeout_minutes:null,message_retention_days:null,category_label_prefix:null};
      const policy=policyResult.rows[0]??{enabled:false,rollout_percentage:0,daily_request_limit:100,monthly_cost_limit_minor:500,cost_currency:'USD'};
      return {enabled:row.enabled,assistantName:row.assistant_name,locale:row.locale,welcomeMessage:row.welcome_message,fallbackMessage:row.fallback_message,handoffKeywords:row.handoff_keywords,conversationTimeoutMinutes:row.conversation_timeout_minutes,messageRetentionDays:row.message_retention_days,categoryLabelPrefix:row.category_label_prefix,aiResponsePolicy:{enabled:policy.enabled,rolloutPercentage:policy.rollout_percentage,dailyRequestLimit:policy.daily_request_limit,monthlyCostLimitMinor:policy.monthly_cost_limit_minor,costCurrency:policy.cost_currency}};
    });
  }
  // D-148 (docs/decisions.md): the project owner had no way to see how
  // much of the AI budget (ai_response_policies.dailyRequestLimit/
  // monthlyCostLimitMinor) was already used without asking — found live
  // when a consultative-recommendation question silently fell back to the
  // generic answer because the daily limit had been exhausted by testing,
  // with no visible signal anywhere in the panel. Reads today's and this
  // month's app.ai_budget_periods rows (created lazily by
  // AiUsageBudgetService.reserve() — absent entirely means zero usage so
  // far, not an error) alongside the configured limits, so remaining
  // budget is a glance away instead of a database query.
  usage(tenantId:string, actorUserId:string) {
    return this.database.withTenantTransaction(tenantId, async client => {
      const access=await client.query<{allowed:boolean}>(`select app.can_manage_channel_connections($1) or exists(select 1 from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active') as allowed`,[actorUserId]);
      if(!access.rows[0]?.allowed) throw forbidden('BOT_CONFIG_FORBIDDEN','Actor is not authorized to view bot configuration');
      const policyResult=await client.query(`select daily_request_limit,monthly_cost_limit_minor::int,cost_currency from app.ai_response_policies`);
      const policy=policyResult.rows[0]??{daily_request_limit:100,monthly_cost_limit_minor:500,cost_currency:'USD'};
      const periods=await client.query<{period_type:string;period_start:string;completed_requests:number;reserved_requests:number;actual_cost_minor:string;reserved_cost_minor:string}>(
        `select period_type,period_start::text,completed_requests,reserved_requests,actual_cost_minor::text,reserved_cost_minor::text
           from app.ai_budget_periods
          where (period_type='day' and period_start=current_date)
             or (period_type='month' and period_start=date_trunc('month',current_date)::date)`,
      );
      const day=periods.rows.find(row=>row.period_type==='day');
      const month=periods.rows.find(row=>row.period_type==='month');
      return {
        costCurrency:policy.cost_currency,
        day:{
          requestsUsed:(day?Number(day.completed_requests)+Number(day.reserved_requests):0),
          requestsLimit:policy.daily_request_limit,
        },
        month:{
          costUsedMinor:(month?Number(month.actual_cost_minor)+Number(month.reserved_cost_minor):0),
          costLimitMinor:policy.monthly_cost_limit_minor,
        },
      };
    });
  }
  save(tenantId:string, actorUserId:string, input:BotConfigInput) {
    return this.database.withTenantTransaction(tenantId, async client => {
      await client.query('select app.save_bot_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[actorUserId,input.enabled,input.assistantName,input.locale,input.welcomeMessage,input.fallbackMessage,input.handoffKeywords,input.conversationTimeoutMinutes,input.messageRetentionDays,input.categoryLabelPrefix]);
      await client.query('select app.save_ai_response_policy($1,$2,$3,$4,$5)',[actorUserId,input.aiResponsePolicy.enabled,input.aiResponsePolicy.rolloutPercentage,input.aiResponsePolicy.dailyRequestLimit,input.aiResponsePolicy.monthlyCostLimitMinor]);
      return {saved:true};
    });
  }
}
