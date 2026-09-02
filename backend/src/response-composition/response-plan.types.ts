import { InteractiveMessage } from '../interactive-messages/interactive-message.types';
import { AppointmentCopyKey, CommercialCopyKey } from '../localization/conversation-copy';

export type LocalizedTemplate =
  | { namespace:'commercial'; key:CommercialCopyKey }
  | { namespace:'appointment'; key:AppointmentCopyKey };

export type ResponseSegment =
  | { kind:'template'; template:LocalizedTemplate; values?:Record<string,string|number> }
  | { kind:'verified_text'; text:string }
  | { kind:'line_break' };

export type ResponsePlan =
  | { kind:'localized_template'; template:LocalizedTemplate; values?:Record<string,string|number>; interactive?:InteractiveMessage }
  // rewriteKey opts a composite into NaturalResponseRewriter eligibility (see
  // D-041, docs/natural-response-rewriting.md); omitted means never eligible.
  | { kind:'composite'; segments:ResponseSegment[]; interactive?:InteractiveMessage; rewriteKey?:string }
  | { kind:'verified_content'; body:string; interactive?:InteractiveMessage };

export interface ComposedResponse {
  locale:string;
  body:string;
  interactive?:InteractiveMessage;
  composition:'template'|'composite'|'verified_content';
}
