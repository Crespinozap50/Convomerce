import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';

export type AiRewriteContext={tenantId:string;conversationId:string;messageId:string};
export type AiBudgetReservation={id:string;tenantId:string;conversationId:string;messageId:string;reservedCostMinor:number;currency:string};
export type AiBudgetDecision={allowed:boolean;reason?:'tenant_disabled'|'rollout_excluded'|'daily_limit'|'monthly_budget';reservation?:AiBudgetReservation};
export type AiUsageSettlement={provider:string;model:string;inputTokens:number;outputTokens:number;actualCostMinor:number;latencyMs:number;success:boolean;failureReason?:string};

type Policy={enabled:boolean;rollout_percentage:number;daily_request_limit:number;monthly_cost_limit_minor:string;reservation_cost_minor:string;cost_currency:string};
type Period={reserved_requests:number;completed_requests:number;reserved_cost_minor:string;actual_cost_minor:string};

@Injectable()
export class AiUsageBudgetService{
  constructor(private readonly database:DatabaseService){}

  reserve(context:AiRewriteContext):Promise<AiBudgetDecision>{
    return this.database.withTenantTransaction(context.tenantId,async client=>{
      const expired=await client.query<{id:string;reserved_cost_minor:string;created_at:string}>(`select id,reserved_cost_minor::text,created_at from app.ai_usage_reservations where status='reserved' and expires_at<=now() order by expires_at limit 100 for update skip locked`);
      for(const reservation of expired.rows){
        const day=new Date(reservation.created_at).toISOString().slice(0,10),month=`${new Date(reservation.created_at).toISOString().slice(0,7)}-01`;
        await client.query(`update app.ai_usage_reservations set status='failed',actual_cost_minor=0,failure_reason='reservation_expired',settled_at=now() where id=$1 and status='reserved'`,[reservation.id]);
        await client.query(`update app.ai_budget_periods set reserved_requests=greatest(0,reserved_requests-1),reserved_cost_minor=greatest(0,reserved_cost_minor-$3),updated_at=now() where tenant_id=app.current_tenant_id() and ((period_type='day' and period_start=$1) or (period_type='month' and period_start=$2))`,[day,month,Number(reservation.reserved_cost_minor)]);
      }
      const policyResult=await client.query<Policy>(`select enabled,rollout_percentage,daily_request_limit,monthly_cost_limit_minor::text,reservation_cost_minor::text,cost_currency from app.ai_response_policies where tenant_id=app.current_tenant_id()`);
      const policy=policyResult.rows[0];
      if(!policy?.enabled)return{allowed:false,reason:'tenant_disabled'};
      if(this.bucket(context.conversationId)>=policy.rollout_percentage)return{allowed:false,reason:'rollout_excluded'};
      const today=new Date().toISOString().slice(0,10);
      const month=`${today.slice(0,7)}-01`;
      await client.query(`insert into app.ai_budget_periods(tenant_id,period_type,period_start) values(app.current_tenant_id(),'day',$1), (app.current_tenant_id(),'month',$2) on conflict do nothing`,[today,month]);
      const periods=await client.query<Period>(`select reserved_requests,completed_requests,reserved_cost_minor::text,actual_cost_minor::text from app.ai_budget_periods where tenant_id=app.current_tenant_id() and ((period_type='day' and period_start=$1) or (period_type='month' and period_start=$2)) order by period_type for update`,[today,month]);
      const day=periods.rows[0],monthly=periods.rows[1];
      if(!day||!monthly)throw new Error('AI budget periods could not be initialized');
      if(day.reserved_requests+day.completed_requests>=policy.daily_request_limit)return{allowed:false,reason:'daily_limit'};
      const reservedCost=Number(policy.reservation_cost_minor);
      if(Number(monthly.reserved_cost_minor)+Number(monthly.actual_cost_minor)+reservedCost>Number(policy.monthly_cost_limit_minor))return{allowed:false,reason:'monthly_budget'};
      await client.query(`update app.ai_budget_periods set reserved_requests=reserved_requests+1,reserved_cost_minor=reserved_cost_minor+$3,updated_at=now() where tenant_id=app.current_tenant_id() and ((period_type='day' and period_start=$1) or (period_type='month' and period_start=$2))`,[today,month,reservedCost]);
      const reservation:AiBudgetReservation={id:uuidv7(),tenantId:context.tenantId,conversationId:context.conversationId,messageId:context.messageId,reservedCostMinor:reservedCost,currency:policy.cost_currency};
      await client.query(`insert into app.ai_usage_reservations(id,tenant_id,conversation_id,message_id,purpose,reserved_cost_minor) values($1,app.current_tenant_id(),$2,$3,'response_rewriting',$4)`,[reservation.id,context.conversationId,context.messageId,reservedCost]);
      return{allowed:true,reservation};
    });
  }

  settle(reservation:AiBudgetReservation,usage:AiUsageSettlement):Promise<void>{
    return this.database.withTenantTransaction(reservation.tenantId,async client=>{
      const result=await client.query<{created_at:string}>(`update app.ai_usage_reservations set status=$2,actual_cost_minor=$3,failure_reason=$4,settled_at=now() where id=$1 and status='reserved' returning created_at`,[reservation.id,usage.success?'completed':'failed',usage.actualCostMinor,usage.failureReason??null]);
      if(!result.rows[0])return;
      const today=new Date(result.rows[0].created_at).toISOString().slice(0,10),month=`${new Date(result.rows[0].created_at).toISOString().slice(0,7)}-01`;
      await client.query(`update app.ai_budget_periods set reserved_requests=greatest(0,reserved_requests-1),completed_requests=completed_requests+1,reserved_cost_minor=greatest(0,reserved_cost_minor-$3),actual_cost_minor=actual_cost_minor+$4,updated_at=now() where tenant_id=app.current_tenant_id() and ((period_type='day' and period_start=$1) or (period_type='month' and period_start=$2))`,[today,month,reservation.reservedCostMinor,usage.actualCostMinor]);
      await client.query(`insert into app.ai_usage(id,tenant_id,conversation_id,message_id,provider,model,purpose,input_tokens,output_tokens,estimated_cost_minor,cost_currency,latency_ms,success) values($1,app.current_tenant_id(),$2,$3,$4,$5,'response_rewriting',$6,$7,$8,$9,$10,$11)`,[uuidv7(),reservation.conversationId,reservation.messageId,usage.provider,usage.model,usage.inputTokens,usage.outputTokens,usage.actualCostMinor,reservation.currency,usage.latencyMs,usage.success]);
    });
  }

  private bucket(conversationId:string):number{return createHash('sha256').update(conversationId).digest().readUInt32BE(0)%100;}
}
