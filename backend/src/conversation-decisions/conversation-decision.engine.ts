import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AppointmentFlowService } from '../commerce-events/appointment-flow.service';
import { CommercialFlowService } from '../commerce-events/commercial-flow.service';
import { BotCopy, DeterministicReply, DeterministicReplyService } from '../commerce-events/deterministic-reply.service';
import { UnderstoodFlowInput } from '../commerce-events/understood-flow-input';
import { ConversationDecision, DecisionCapability } from './conversation-decision.types';

@Injectable()
export class ConversationDecisionEngine {
  constructor(
    private readonly appointments:AppointmentFlowService,
    private readonly commerce:CommercialFlowService,
    private readonly knowledge:DeterministicReplyService,
  ){}

  async decide(client:PoolClient,input:UnderstoodFlowInput,bot:BotCopy):Promise<ConversationDecision>{
    const capabilities=await this.enabledCapabilities(client);
    if(capabilities.has('appointments')){
      const appointment=await this.appointments.resolve(client,input);
      if(appointment)return this.toDecision('appointment','appointment_flow_matched',appointment,input);
    }
    if(capabilities.has('orders')){
      const commercial=await this.commerce.resolve(client,input);
      if(commercial)return this.toDecision('commerce','commercial_flow_matched',commercial,input);
    }
    const knowledge=await this.knowledge.resolve(client,input.body,bot,input.interactiveSelectionId);
    // 'fallback' alone doesn't mean unanswered — it can still be genuinely
    // answered via a knowledge_entries match on title/keywords (D-077,
    // D-078). Only report "no domain capability matched" when it's truly
    // both: classifyMessage found no fixed intent AND no entry answered it.
    // Mislabeling an answered 'fallback' here would also wrongly log it as
    // unresolved downstream (message-received.consumer.ts).
    const unmatched=knowledge.intent==='fallback'&&knowledge.sources.length===0;
    return this.toDecision('knowledge',unmatched?'no_domain_capability_matched':'knowledge_intent_matched',knowledge,input);
  }

  private async enabledCapabilities(client:PoolClient):Promise<Set<string>>{
    const result=await client.query<{capability:string}>(
      `select capability from app.tenant_capabilities where enabled=true`,
    );
    return new Set(result.rows.map(({capability})=>capability));
  }

  private toDecision(
    capability:DecisionCapability,
    reason:string,
    reply:DeterministicReply,
    input:UnderstoodFlowInput,
  ):ConversationDecision{
    if(capability!=='knowledge'&&!reply.responsePlan){
      throw new Error(`${capability} capability returned a response without a structured plan`);
    }
    return{
      outcome:reply.handoff?'handoff':'respond',
      capability,
      intent:reply.intent,
      requestedAction:input.understanding.requestedAction,
      confidence:input.understanding.confidence,
      sources:reply.sources,
      reason,
      responsePlan:reply.responsePlan??{
        kind:'verified_content',
        body:reply.body,
        ...(reply.interactive?{interactive:reply.interactive}:{}),
      },
    };
  }
}
