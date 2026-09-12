import { DeterministicReply, ReplyIntent } from '../commerce-events/deterministic-reply.service';
import { ResponsePlan } from '../response-composition/response-plan.types';

export type DecisionCapability = 'appointment' | 'commerce' | 'knowledge';
export type DecisionOutcome = 'respond' | 'handoff';

export interface ConversationDecision {
  outcome: DecisionOutcome;
  capability: DecisionCapability;
  intent: ReplyIntent;
  requestedAction: string | null;
  confidence: number;
  sources: string[];
  reason: string;
  responsePlan:ResponsePlan;
  // D-144 (docs/decisions.md): passed through unchanged from
  // DeterministicReply.additionalMessages — see its own comment there.
  additionalMessages?: DeterministicReply['additionalMessages'];
}
