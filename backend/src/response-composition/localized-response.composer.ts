import { Injectable } from '@nestjs/common';
import { validateInteractiveMessage } from '../interactive-messages/interactive-message.types';
import { appointmentCopy, commercialCopy } from '../localization/conversation-copy';
import { normalizeLocale } from '../localization/localization';
import { ComposedResponse, LocalizedTemplate, ResponsePlan } from './response-plan.types';

const TEXT_LIMIT=4096;
const INTERACTIVE_BODY_LIMIT=1024;

@Injectable()
export class LocalizedResponseComposer {
  compose(plan:ResponsePlan,locale:string):ComposedResponse{
    const body=this.render(plan,locale).trim();
    if(!body)throw new Error('Composed response body is required');
    const maximum=plan.interactive?INTERACTIVE_BODY_LIMIT:TEXT_LIMIT;
    if(body.length>maximum)throw new Error(`Composed response body exceeds the ${maximum} character limit`);
    const interactive=plan.interactive?{...plan.interactive,body}:undefined;
    if(interactive)validateInteractiveMessage(interactive);
    return{
      locale:normalizeLocale(locale),
      body,
      ...(interactive?{interactive}:{}),
      composition:plan.kind==='localized_template'?'template':plan.kind==='composite'?'composite':'verified_content',
    };
  }

  private render(plan:ResponsePlan,locale:string):string{
    if(plan.kind==='composite')return plan.segments.map(segment=>segment.kind==='line_break'?`\n`:segment.kind==='verified_text'?segment.text:this.renderTemplate(segment.template,segment.values,locale)).join('');
    if(plan.kind!=='localized_template')return plan.body;
    return this.renderTemplate(plan.template,plan.values,locale);
  }

  private renderTemplate(template:LocalizedTemplate,values:Record<string,string|number>|undefined,locale:string):string{return template.namespace==='commercial'?commercialCopy(locale,template.key,values):appointmentCopy(locale,template.key,values);}
}
