import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { forbidden } from '../observability/http-errors';
import { catalogFor, ConversationLocale } from '../localization/localization';

export type AiResponsePolicyInput={enabled:boolean;rolloutPercentage:number;dailyRequestLimit:number;monthlyCostLimitMinor:number};
export type BotConfigInput = { enabled:boolean; assistantName:string; locale:ConversationLocale; welcomeMessage:string; fallbackMessage:string; handoffKeywords:string[];aiResponsePolicy:AiResponsePolicyInput;conversationTimeoutMinutes:number|null;messageRetentionDays:number|null };
@Injectable()
export class BotConfigService {
  constructor(private readonly database: DatabaseService) {}
  get(tenantId:string, actorUserId:string) {
    return this.database.withTenantTransaction(tenantId, async client => {
      const access=await client.query<{allowed:boolean}>(`select app.can_manage_channel_connections($1) or exists(select 1 from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active') as allowed`,[actorUserId]);
      if(!access.rows[0]?.allowed) throw forbidden('BOT_CONFIG_FORBIDDEN','Actor is not authorized to view bot configuration');
      const result=await client.query(`select enabled,assistant_name,locale,welcome_message,fallback_message,handoff_keywords,conversation_timeout_minutes,message_retention_days from app.bot_configurations`);
      const policyResult=await client.query(`select enabled,rollout_percentage,daily_request_limit,monthly_cost_limit_minor::int,cost_currency from app.ai_response_policies`);
      const defaults=catalogFor('en').bot;
      const row=result.rows[0] ?? {enabled:false,assistant_name:'Commerce Assistant',locale:'en',welcome_message:defaults.defaultWelcome,fallback_message:defaults.defaultFallback,handoff_keywords:defaults.defaultHandoffKeywords,conversation_timeout_minutes:null,message_retention_days:null};
      const policy=policyResult.rows[0]??{enabled:false,rollout_percentage:0,daily_request_limit:100,monthly_cost_limit_minor:500,cost_currency:'USD'};
      return {enabled:row.enabled,assistantName:row.assistant_name,locale:row.locale,welcomeMessage:row.welcome_message,fallbackMessage:row.fallback_message,handoffKeywords:row.handoff_keywords,conversationTimeoutMinutes:row.conversation_timeout_minutes,messageRetentionDays:row.message_retention_days,aiResponsePolicy:{enabled:policy.enabled,rolloutPercentage:policy.rollout_percentage,dailyRequestLimit:policy.daily_request_limit,monthlyCostLimitMinor:policy.monthly_cost_limit_minor,costCurrency:policy.cost_currency}};
    });
  }
  save(tenantId:string, actorUserId:string, input:BotConfigInput) {
    return this.database.withTenantTransaction(tenantId, async client => {
      await client.query('select app.save_bot_configuration($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actorUserId,input.enabled,input.assistantName,input.locale,input.welcomeMessage,input.fallbackMessage,input.handoffKeywords,input.conversationTimeoutMinutes,input.messageRetentionDays]);
      await client.query('select app.save_ai_response_policy($1,$2,$3,$4,$5)',[actorUserId,input.aiResponsePolicy.enabled,input.aiResponsePolicy.rolloutPercentage,input.aiResponsePolicy.dailyRequestLimit,input.aiResponsePolicy.monthlyCostLimitMinor]);
      return {saved:true};
    });
  }
}
