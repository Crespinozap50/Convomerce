import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { DeterministicReply } from './deterministic-reply.service';
import { ConversationLocale, normalizeLocale } from '../localization/localization';
import { appointmentCopy, AppointmentCopyKey } from '../localization/conversation-copy';
import { UnderstoodFlowInput } from './understood-flow-input';
import { ResponsePlan } from '../response-composition/response-plan.types';
import { InteractiveMessage } from '../interactive-messages/interactive-message.types';
import { unprocessable } from '../observability/http-errors';
import { OperationalRequirementsService } from '../operational-requirements/operational-requirements.service';
import {
  extractPendingRequirementValues,
  nextPendingStep,
  PendingRequirement,
  resolveBooleanRequirementValue,
  validateRequirementValue,
} from './requirement-loop';

type Locale = ConversationLocale;
type AppointmentWorkflow = {
  id: string;
  commercial_request_id: string;
  step: string;
  context: Record<string, unknown>;
};
type BookableItem = {
  item_id: string;
  variant_id: string;
  name: string;
  variant_name: string;
  price_minor: string;
  currency: string;
  duration_minutes: number;
};
type Slot = { resource_id: string; resource_name: string; starts_at: string; ends_at: string; timezone: string };
type BookingResource = { id:string; name:string };
type CancellableAppointment = {
  id: string;
  commercial_request_id: string;
  catalog_item_id?: string;
  starts_at: string;
  ends_at?: string;
  timezone: string;
  item_name: string | null;
  resource_name: string | null;
};
type AppointmentSegment=
  | {kind:'template';template:{namespace:'appointment';key:AppointmentCopyKey};values?:Record<string,string|number>}
  | {kind:'verified_text';text:string}
  | {kind:'line_break'};
type PlannedContent={body:string;plan:Omit<Extract<ResponsePlan,{kind:'composite'}>,'segments'>&{segments:AppointmentSegment[]}};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// Naive Spanish singularizer so "cortes" matches a catalog service named
// "Corte" in matchBookableItem's token scoring; see commercial-flow.service.ts.
const singularize = (word: string) => {
  if (word.length <= 3) return word;
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  if (/[^aeiou]es$/.test(word)) return word.slice(0, -2);
  return word;
};

@Injectable()
export class AppointmentFlowService {
  constructor(private readonly requirements: OperationalRequirementsService) {}

  async resolve(client: PoolClient, input:UnderstoodFlowInput): Promise<DeterministicReply | null> {
    const active = await client.query<AppointmentWorkflow>(
      `select id,commercial_request_id,step,context from app.conversation_workflows
       where conversation_id=$1 and operation_type='appointment' and status='active'`,
      [input.conversationId],
    );
    if (active.rows[0]) return this.continue(client, active.rows[0], input);

    if (input.understanding.requestedAction==='cancel_appointment') return this.cancelUpcomingAppointment(client,input);
    if(input.understanding.requestedAction==='view_appointment')return this.describeUpcomingAppointment(client,input);
    if(input.understanding.requestedAction==='reschedule')return this.startReschedule(client,input);

    const item = await this.matchBookableItem(client, input);
    const wants = ['book_appointment','start_order'].includes(input.understanding.requestedAction??'');
    if (!item || !wants) return null;

    // A reservable offering must never remain trapped in a product-order workflow.
    await client.query(
      `update app.conversation_workflows set status='cancelled',updated_at=now()
       where conversation_id=$1 and status='active' and operation_type<>'appointment'`,
      [input.conversationId],
    );
    await client.query(
      `update app.commercial_requests request set status='cancelled',updated_at=now()
       where request.conversation_id=$1 and request.status='draft'
         and not exists(select 1 from app.conversation_workflows workflow
           where workflow.commercial_request_id=request.id and workflow.status='active')`,
      [input.conversationId],
    );

    const requestId = uuidv7();
    const workflowId = uuidv7();
    await client.query(
      `insert into app.commercial_requests(id,tenant_id,conversation_id,contact_id,request_type,status,currency)
       values($1,$2,$3,$4,'reservation','draft',$5)`,
      [requestId,input.tenantId,input.conversationId,input.contactId,item.currency],
    );
    await client.query(
      `insert into app.request_lines(id,tenant_id,commercial_request_id,item_variant_id,description_snapshot,
        unit_price_minor_snapshot,currency,quantity,line_total_minor)
       values($1,$2,$3,$4,$5,$6::bigint,$7,1,$6::bigint)`,
      [uuidv7(),input.tenantId,requestId,item.variant_id,`${item.name} (${item.variant_name})`,item.price_minor,item.currency],
    );
    await client.query(
      `update app.commercial_requests set subtotal_minor=$2::bigint,total_minor=$2::bigint where id=$1`,
      [requestId,item.price_minor],
    );
    const context = { catalogItemId:item.item_id,itemName:item.name };
    await client.query(
      `insert into app.conversation_workflows(id,tenant_id,conversation_id,contact_id,commercial_request_id,operation_type,step,context)
       values($1,$2,$3,$4,$5,'appointment',$6,$7::jsonb)`,
      [workflowId,input.tenantId,input.conversationId,input.contactId,requestId,'awaiting_date',JSON.stringify(context)],
    );
    return this.localizedReply(input.locale,'selectedItem',{item:item.name});
  }

  private async continue(client:PoolClient,flow:AppointmentWorkflow,input:UnderstoodFlowInput) {
    const text=typeof input.understanding.entities.normalizedText==='string'?input.understanding.entities.normalizedText:'';
    const affirmative=input.understanding.entities.response==='affirmative';
    const negative=input.understanding.entities.response==='negative';
    if (input.understanding.requestedAction==='cancel_appointment'||input.understanding.requestedAction==='cancel') {
      if(flow.context.rescheduleAppointmentId){
        await client.query(`update app.conversation_workflows set status='cancelled',updated_at=now() where id=$1`,[flow.id]);
        return this.localizedReply(input.locale,'originalKept');
      }
      if (flow.context.appointmentId) {
        await client.query(`select app.transition_appointment($1,'cancel',null,null)`,[String(flow.context.appointmentId)]);
      }
      await client.query(`update app.commercial_requests set status='cancelled',updated_at=now() where id=$1`,[flow.commercial_request_id]);
      await client.query(`update app.conversation_workflows set status='cancelled',updated_at=now() where id=$1`,[flow.id]);
      return this.localizedReply(input.locale,'bookingCancelled');
    }
    if(flow.step==='awaiting_date'){
      const requestedDate=typeof input.understanding.entities.requestedDate==='string'?input.understanding.entities.requestedDate:null;
      if(!requestedDate)return this.localizedReply(input.locale,'dateNotRecognized');
      const resources=await this.compatibleResources(client,String(flow.context.catalogItemId));
      const context={...flow.context,requestedDate,resources};
      if(resources.length>1){
        await this.step(client,flow.id,'awaiting_resource',context);
        return this.plannedReply(this.resourcePrompt(resources,requestedDate,input.locale));
      }
      return this.offerSlots(client,flow,{...context,resourceId:resources[0]?.id??null},input.locale);
    }
    if(flow.step==='awaiting_resource'){
      const resources=(flow.context.resources as BookingResource[]|undefined)??[];
      const choice=typeof input.understanding.entities.selectionIndex==='number'?input.understanding.entities.selectionIndex:Number.NaN;
      const named=resources.find(resource=>normalize(resource.name).split(' ').some(token=>token.length>2&&text.includes(token)));
      const any=input.understanding.entities.anyResource===true||choice===1;
      const selected=Number.isInteger(choice)&&choice>=2&&choice<=resources.length+1?resources[choice-2]:named;
      if(!any&&!selected)return this.plannedReply(this.resourcePrompt(resources,String(flow.context.requestedDate),input.locale));
      return this.offerSlots(client,flow,{...flow.context,resourceId:selected?.id??null,resourceName:selected?.name??null},input.locale);
    }
    if(flow.step==='awaiting_slot'){
      const slots=(flow.context.slots as Slot[]|undefined)??[];
      const choice=typeof input.understanding.entities.selectionIndex==='number'?input.understanding.entities.selectionIndex:Number.NaN;
      if(!Number.isInteger(choice)||choice<1||choice>slots.length)return this.plannedReply(this.slotPrompt(String(flow.context.itemName),String(flow.context.requestedDate),slots,input.locale));
      const slot=slots[choice-1];
      if(flow.context.rescheduleAppointmentId){
        await this.step(client,flow.id,'awaiting_confirmation',{...flow.context,selectedSlot:slot});
        return this.yesNoReply(input.locale,'confirmReschedule',{slot:this.formatSlot(slot,input.locale),resource:slot.resource_name});
      }
      const appointmentId=uuidv7();
      await client.query(
        `select app.hold_appointment($1,$2,$3,$4,$5,$6,$7,$8,$9,10) id`,
        [appointmentId,String(flow.context.catalogItemId),input.contactId,slot.resource_id,flow.commercial_request_id,
          `${flow.id}:${slot.starts_at}`,slot.starts_at,slot.ends_at,slot.timezone],
      );
      const context={...flow.context,appointmentId,selectedSlot:slot};
      return this.afterRequirementFilled(client,flow,input,context);
    }
    if(flow.step.startsWith('awaiting_requirement:')){
      const [,fieldKey,subStep]=flow.step.split(':');
      if(subStep==='confirm'){
        if(!affirmative&&!negative)return this.yesNoReply(input.locale,'yesNo');
        const pendingConfirmations={...((flow.context.pendingConfirmations as Record<string,string>)??{})};
        const value=pendingConfirmations[fieldKey];
        delete pendingConfirmations[fieldKey];
        const context:Record<string,unknown>={...flow.context,pendingConfirmations};
        if(affirmative&&value!==undefined)
          context.values={...((flow.context.values as Record<string,string>)??{}),[fieldKey]:value};
        return this.afterRequirementFilled(client,flow,input,context);
      }
      const requirement=await this.findRequirement(client,input,fieldKey);
      if(!requirement)return null;
      if(requirement.dataType==='boolean'){
        const value=resolveBooleanRequirementValue(input.understanding.entities);
        if(value===null)return this.requirementPrompt(input.locale,requirement);
        return this.afterRequirementFilled(client,flow,input,this.applyRequirementValue(requirement,value,flow.context));
      }
      // A tapped select option's list/button id is the option's 1-based
      // index, matching validateRequirementValue's byIndex path — checked
      // ahead of the raw body text so a truncated (long) option label still
      // resolves correctly instead of failing an exact-text match.
      const selectionText=typeof input.understanding.entities.selectionIndex==='number'?String(input.understanding.entities.selectionIndex):input.body;
      const validation=validateRequirementValue(selectionText,requirement);
      if(!validation.valid)return this.requirementPrompt(input.locale,requirement);
      return this.afterRequirementFilled(client,flow,input,this.applyRequirementValue(requirement,validation.value,flow.context));
    }
    if(flow.step==='awaiting_confirmation'){
      if(negative){
        if(flow.context.rescheduleAppointmentId){
          await client.query(`update app.conversation_workflows set status='cancelled',updated_at=now() where id=$1`,[flow.id]);
          return this.localizedReply(input.locale,'rescheduleUnchanged');
        }
        await client.query(`select app.transition_appointment($1,'cancel',null,null)`,[String(flow.context.appointmentId)]);
        await client.query(`update app.commercial_requests set status='cancelled',updated_at=now() where id=$1`,[flow.commercial_request_id]);
        await client.query(`update app.conversation_workflows set status='cancelled',updated_at=now() where id=$1`,[flow.id]);
        return this.localizedReply(input.locale,'bookingCancelled');
      }
      if(!affirmative)return this.yesNoReply(input.locale,'yesNo');
      if(flow.context.rescheduleAppointmentId){
        const slot=flow.context.selectedSlot as Slot;
        const appointmentId=String(flow.context.rescheduleAppointmentId);
        await client.query(`update app.appointments set resource_id=$2,starts_at=$3,ends_at=$4,timezone=$5,updated_at=now() where id=$1 and status='confirmed'`,[appointmentId,slot.resource_id,slot.starts_at,slot.ends_at,slot.timezone]);
        await client.query(`update app.conversation_workflows set status='completed',updated_at=now() where id=$1`,[flow.id]);
        await client.query(`insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload) values($1,$2,'appointment.rescheduled','appointment',$3,$4,1,jsonb_build_object('appointmentId',($3::uuid)::text))`,[uuidv7(),input.tenantId,appointmentId,uuidv7()]);
        return this.localizedReply(input.locale,'rescheduled',{slot:this.formatSlot(slot,input.locale),resource:slot.resource_name});
      }
      const appointmentId=String(flow.context.appointmentId);
      await client.query(`select app.transition_appointment($1,'confirm',null,null)`,[appointmentId]);
      await client.query(`update app.commercial_requests set status='ready',confirmed_at=now(),updated_at=now() where id=$1`,[flow.commercial_request_id]);
      await client.query(`update app.conversation_workflows set status='completed',updated_at=now() where id=$1`,[flow.id]);
      await client.query(
        `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
         values($1,$2,'appointment.confirmed','appointment',$3,$4,1,jsonb_build_object('appointmentId',($3::uuid)::text))`,
        [uuidv7(),input.tenantId,appointmentId,uuidv7()],
      );
      return this.localizedReply(input.locale,'confirmed',{reference:appointmentId.slice(-8).toUpperCase()});
    }
    return null;
  }

  private async upcoming(client:PoolClient,contactId:string){const result=await client.query<CancellableAppointment>(`select appointment.id,appointment.commercial_request_id,appointment.catalog_item_id,appointment.starts_at,appointment.ends_at,appointment.timezone,item.name item_name,resource.name resource_name from app.appointments appointment join app.catalog_items item on item.tenant_id=appointment.tenant_id and item.id=appointment.catalog_item_id left join app.booking_resources resource on resource.tenant_id=appointment.tenant_id and resource.id=appointment.resource_id where appointment.contact_id=$1 and appointment.status='confirmed' and appointment.ends_at>now() order by appointment.starts_at limit 1`,[contactId]);return result.rows[0]??null;}
  private async describeUpcomingAppointment(client:PoolClient,input:{contactId:string;locale:Locale}){const appointment=await this.upcoming(client,input.contactId);if(!appointment)return this.localizedReply(input.locale,'noUpcoming');const slot={starts_at:appointment.starts_at,ends_at:appointment.ends_at!,timezone:appointment.timezone,resource_id:'',resource_name:appointment.resource_name??''};const resourceSuffix=appointment.resource_name?this.copy(input.locale,'resourceSuffix',{resource:appointment.resource_name}):'';return this.localizedReply(input.locale,'upcoming',{item:appointment.item_name??'',slot:this.formatSlot(slot,input.locale),resourceSuffix});}
  private async startReschedule(client:PoolClient,input:{tenantId:string;conversationId:string;contactId:string;locale:Locale}){const appointment=await this.upcoming(client,input.contactId);if(!appointment)return this.localizedReply(input.locale,'noReschedulable');const workflowId=uuidv7();await client.query(`insert into app.conversation_workflows(id,tenant_id,conversation_id,contact_id,commercial_request_id,operation_type,step,context) values($1,$2,$3,$4,$5,'appointment','awaiting_date',$6::jsonb)`,[workflowId,input.tenantId,input.conversationId,input.contactId,appointment.commercial_request_id,JSON.stringify({catalogItemId:appointment.catalog_item_id,itemName:appointment.item_name,rescheduleAppointmentId:appointment.id})]);return this.localizedReply(input.locale,'requestNewDate');}

  private async cancelUpcomingAppointment(client:PoolClient,input:{tenantId:string;contactId:string;locale:Locale}) {
    const result=await client.query<CancellableAppointment>(
      `select appointment.id,appointment.commercial_request_id,appointment.starts_at,appointment.timezone,
        item.name item_name,resource.name resource_name
       from app.appointments appointment
       left join app.booking_resources resource
         on resource.tenant_id=appointment.tenant_id and resource.id=appointment.resource_id
       left join lateral(
         select catalog.name
         from app.request_lines line
         join app.item_variants variant on variant.tenant_id=line.tenant_id and variant.id=line.item_variant_id
         join app.catalog_items catalog on catalog.tenant_id=variant.tenant_id and catalog.id=variant.catalog_item_id
         where line.commercial_request_id=appointment.commercial_request_id and line.status='active'
         order by line.created_at limit 1
       ) item on true
       where appointment.contact_id=$1 and appointment.status in('held','confirmed')
         and appointment.ends_at>now()
       order by appointment.starts_at limit 1 for update of appointment`,
      [input.contactId],
    );
    const appointment=result.rows[0];
    if(!appointment)return this.localizedReply(input.locale,'noCancellable');

    await client.query(`select app.transition_appointment($1,'cancel',null,null)`,[appointment.id]);
    await client.query(
      `update app.commercial_requests set status='cancelled',updated_at=now(),version=version+1
       where id=$1 and status not in('completed','cancelled','rejected')`,
      [appointment.commercial_request_id],
    );
    await client.query(
      `update app.conversation_workflows set status='cancelled',updated_at=now()
       where commercial_request_id=$1 and operation_type='appointment'`,
      [appointment.commercial_request_id],
    );
    await client.query(
      `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
       values($1,$2,'appointment.cancelled','appointment',$3,$4,1,jsonb_build_object('appointmentId',($3::uuid)::text))`,
      [uuidv7(),input.tenantId,appointment.id,uuidv7()],
    );
    const label=appointment.item_name??this.copy(input.locale,'appointmentLabel');
    const resourceSuffix=appointment.resource_name?this.copy(input.locale,'resourceSuffix',{resource:appointment.resource_name}):'';
    const when=new Intl.DateTimeFormat(normalizeLocale(input.locale),{weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',timeZone:appointment.timezone}).format(new Date(appointment.starts_at));
    return this.localizedReply(input.locale,'cancelledDetails',{item:label,resourceSuffix,when});
  }

  private async matchBookableItem(client:PoolClient,input:UnderstoodFlowInput):Promise<BookableItem|null>{
    const result=await client.query<BookableItem>(
      `select item.id item_id,variant.id variant_id,item.name,variant.name variant_name,
        variant.price_minor::text,variant.currency,item.duration_minutes
       from app.catalog_items item join app.item_variants variant
         on variant.tenant_id=item.tenant_id and variant.catalog_item_id=item.id
       where item.status='active' and variant.status='active' and variant.availability_status='available'
         and (item.booking_required or item.offering_type='appointment') order by item.name`,
    );
    const value=input.understanding.entities.searchTerms;
    const tokens=new Set((Array.isArray(value)?value.filter((term):term is string=>typeof term==='string'):[]).map(singularize));
    const scored=result.rows.map(item=>({item,score:normalize(item.name).split(' ').map(singularize).filter(token=>tokens.has(token)).length})).sort((a,b)=>b.score-a.score);
    const best=scored[0];
    if(!best||best.score===0)return null;
    // Same conservative tie-break as matchItem (commercial-flow.service.ts):
    // never guess between two equally-scored services.
    const equallyRelevant=scored.filter(candidate=>candidate.score===best.score);
    return equallyRelevant.length===1?best.item:null;
  }

  private async compatibleResources(client:PoolClient,catalogItemId:string):Promise<BookingResource[]>{
    const result=await client.query<BookingResource>(
      `select resource.id,resource.name from app.service_resource_links link
       join app.booking_resources resource on resource.tenant_id=link.tenant_id and resource.id=link.resource_id
       where link.catalog_item_id=$1 and link.status='active' and resource.status='active'
       order by link.priority,resource.name`,[catalogItemId]);
    return result.rows;
  }
  private async availableSlots(client:PoolClient,catalogItemId:string,requestedDate:string,resourceId:string|null):Promise<Slot[]>{
    const result=await client.query<Slot>(
      `select slot.resource_id,slot.resource_name,slot.starts_at,slot.ends_at,slot.timezone
       from (
         select distinct rule.timezone
         from app.service_resource_links link
         join app.resource_availability_rules rule
           on rule.tenant_id=link.tenant_id and rule.resource_id=link.resource_id and rule.status='active'
         where link.catalog_item_id=$1 and link.status='active'
       ) boundary
       cross join lateral app.find_available_slots(
         $1,
         ($2::date::timestamp at time zone boundary.timezone),
         (($2::date+1)::timestamp at time zone boundary.timezone),
         40
       ) slot
       where slot.timezone=boundary.timezone
         and (slot.starts_at at time zone slot.timezone)::date=$2::date
         and ($3::uuid is null or slot.resource_id=$3)
       order by starts_at,resource_name limit 8`,
      [catalogItemId,requestedDate,resourceId],
    );
    return result.rows;
  }
  private async offerSlots(client:PoolClient,flow:AppointmentWorkflow,context:Record<string,unknown>,locale:Locale){
    const slots=await this.availableSlots(client,String(context.catalogItemId),String(context.requestedDate),context.resourceId?String(context.resourceId):null);
    if(!slots.length){
      await this.step(client,flow.id,'awaiting_date',{catalogItemId:context.catalogItemId,itemName:context.itemName});
      const resourceSuffix=context.resourceName?this.copy(locale,'resourceSuffix',{resource:String(context.resourceName)}):'';
      return this.localizedReply(locale,'noAvailability',{date:this.formatDate(String(context.requestedDate),locale),resourceSuffix});
    }
    await this.step(client,flow.id,'awaiting_slot',{...context,slots});
    return this.plannedReply(this.slotPrompt(String(context.itemName),String(context.requestedDate),slots,locale));
  }
  // WhatsApp list row titles are capped at 24 characters by Meta; resource
  // names in seed/tenant data routinely exceed that ("Laura — terapeuta de
  // bienestar", "Bahía 1 — motos y automóviles").
  private truncate(value:string,max:number):string{return value.length>max?`${value.slice(0,max-1)}…`:value;}
  private resourcePrompt(resources:BookingResource[],requestedDate:string,locale:Locale):PlannedContent{
    const segments:AppointmentSegment[]=[
      {kind:'template',template:{namespace:'appointment',key:'resourceHeading'},values:{date:this.formatDate(requestedDate,locale)}},
    ];
    const interactive:InteractiveMessage={
      type:'list',
      body:'',
      buttonLabel:this.copy(locale,'chooseButtonLabel'),
      options:[
        {id:'1',title:this.truncate(this.copy(locale,'anyResource'),24)},
        ...resources.map((resource,index)=>({id:String(index+2),title:this.truncate(resource.name,24)})),
      ],
    };
    return this.content(locale,segments,interactive);
  }
  private slotPrompt(item:string,requestedDate:string,slots:Slot[],locale:Locale):PlannedContent{
    const segments:AppointmentSegment[]=[{kind:'template',template:{namespace:'appointment',key:'slotsHeading'},values:{item,date:this.formatDate(requestedDate,locale)}}];
    const interactive:InteractiveMessage={
      type:'list',
      body:'',
      buttonLabel:this.copy(locale,'chooseButtonLabel'),
      options:slots.map((slot,index)=>({
        id:String(index+1),
        title:this.truncate(this.formatSlotTime(slot,locale),24),
        description:this.truncate(slot.resource_name,72),
      })),
    };
    return this.content(locale,segments,interactive);
  }
  private formatDate(value:string,locale:Locale){return new Intl.DateTimeFormat(normalizeLocale(locale),{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));}
  private formatSlot(slot:Slot,locale:Locale){return new Intl.DateTimeFormat(normalizeLocale(locale),{weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',timeZone:slot.timezone}).format(new Date(slot.starts_at));}
  private formatSlotTime(slot:Slot,locale:Locale){return new Intl.DateTimeFormat(normalizeLocale(locale),{hour:'numeric',minute:'2-digit',timeZone:slot.timezone}).format(new Date(slot.starts_at));}
  private step(client:PoolClient,id:string,step:string,context:Record<string,unknown>){return client.query(`update app.conversation_workflows set step=$2,context=$3::jsonb,updated_at=now() where id=$1`,[id,step,JSON.stringify(context)]);}
  // Checks for a still-unanswered configured requirement (D-039/D-040) after
  // the slot is held, or after answering one such requirement. With no active
  // requirement rows seeded for operation_type='appointment' (see migration
  // 056 §backfill), getPendingRequirements always returns [] today, so this
  // falls straight through to awaiting_confirmation exactly like before this
  // loop existed — behavior only changes once a tenant configures a field
  // from the admin panel.
  private applyRequirementValue(
    requirement:PendingRequirement,value:string,context:Record<string,unknown>,
  ):Record<string,unknown>{
    if(requirement.requiresConfirmation)
      return{
        ...context,
        pendingConfirmations:{
          ...((context.pendingConfirmations as Record<string,string>)??{}),
          [requirement.fieldKey]:value,
        },
      };
    return{
      ...context,
      values:{...((context.values as Record<string,string>)??{}),[requirement.fieldKey]:value},
    };
  }
  private confirmationPrompt(locale:Locale,requirement:PendingRequirement,value:string):DeterministicReply{
    return this.yesNoReply(locale,'requirementConfirm',{label:requirement.label??requirement.fieldKey,value});
  }
  private async afterRequirementFilled(
    client:PoolClient,flow:AppointmentWorkflow,input:UnderstoodFlowInput,context:Record<string,unknown>,
  ):Promise<DeterministicReply>{
    const pendingConfirmations={...((context.pendingConfirmations as Record<string,string>)??{})};
    const confirmationKeys=Object.keys(pendingConfirmations);
    if(confirmationKeys.length){
      const requirementsInOrder=await this.requirements.getPendingRequirements(
        client,input.tenantId,'appointment',null,[],input.locale,
      );
      const fieldKey=confirmationKeys.sort((a,b)=>
        (requirementsInOrder.find(r=>r.fieldKey===a)?.displayOrder??0)
        -(requirementsInOrder.find(r=>r.fieldKey===b)?.displayOrder??0),
      )[0];
      const requirement=requirementsInOrder.find(r=>r.fieldKey===fieldKey);
      await this.step(client,flow.id,`awaiting_requirement:${fieldKey}:confirm`,context);
      return requirement
        ?this.confirmationPrompt(input.locale,requirement,pendingConfirmations[fieldKey])
        :this.yesNoReply(input.locale,'yesNo');
    }
    const filledKeys=Object.keys((context.values as Record<string,string>)??{});
    const pending=await this.requirements.getPendingRequirements(
      client,input.tenantId,'appointment',null,filledKeys,input.locale,
    );
    // D-040: opportunistically fill other still-pending custom fields
    // mentioned in the same message. Recurses once if anything new was
    // extracted so a queued confirmation (branch above) or nextPendingStep
    // (below) each only live in one place.
    const extracted=extractPendingRequirementValues(input.body,input.understanding.entities,pending);
    if(extracted.length){
      let updatedContext=context;
      for(const{fieldKey,value}of extracted){
        const requirement=pending.find(r=>r.fieldKey===fieldKey);
        if(requirement)updatedContext=this.applyRequirementValue(requirement,value,updatedContext);
      }
      return this.afterRequirementFilled(client,flow,input,updatedContext);
    }
    const next=nextPendingStep(pending,filledKeys);
    if(next){
      await this.step(client,flow.id,`awaiting_requirement:${next.fieldKey}`,context);
      return this.requirementPrompt(input.locale,next);
    }
    await this.step(client,flow.id,'awaiting_confirmation',context);
    const slot=context.selectedSlot as Slot;
    return this.yesNoReply(input.locale,'confirmHold',{
      item:String(context.itemName),resource:slot.resource_name,slot:this.formatSlot(slot,input.locale),
    });
  }
  private async findRequirement(
    client:PoolClient,input:UnderstoodFlowInput,fieldKey:string,
  ):Promise<PendingRequirement|null>{
    const list=await this.requirements.getPendingRequirements(
      client,input.tenantId,'appointment',null,[],input.locale,
    );
    return list.find(item=>item.fieldKey===fieldKey)??null;
  }
  private requirementPrompt(locale:Locale,requirement:PendingRequirement):DeterministicReply{
    if(!requirement.label)
      throw unprocessable(
        'REQUIREMENT_MISSING_LOCALIZATION',
        `Active requirement ${requirement.fieldKey} has no localization for locale ${locale}`,
      );
    if(requirement.dataType==='boolean')
      return{...this.reply(requirement.label),responsePlan:{kind:'verified_content',body:requirement.label,interactive:this.yesNoButtons(locale)}};
    // A tenant could in principle configure more options than WhatsApp
    // supports in a single list (10); fall back to plain enumerated text
    // rather than send a request Meta would reject.
    if(requirement.dataType==='select'&&requirement.options.length&&requirement.options.length<=10){
      const interactive:InteractiveMessage=requirement.options.length<=3
        ?{type:'buttons',body:'',options:requirement.options.map((option,index)=>({id:String(index+1),title:this.truncate(option.label,20)}))}
        :{type:'list',body:'',buttonLabel:this.copy(locale,'chooseButtonLabel'),options:requirement.options.map((option,index)=>({id:String(index+1),title:this.truncate(option.label,24)}))};
      return{...this.reply(requirement.label),responsePlan:{kind:'verified_content',body:requirement.label,interactive}};
    }
    const text=requirement.dataType==='select'&&requirement.options.length
      ?`${requirement.label}\n${requirement.options.map((option,index)=>`${index+1}) ${option.label}`).join('\n')}`
      :requirement.label;
    return{...this.reply(text),responsePlan:{kind:'verified_content',body:text}};
  }
  private reply(body:string):DeterministicReply{return{intent:'appointment',body,handoff:false,sources:['appointment_availability']};}
  private localizedReply(locale:Locale,key:AppointmentCopyKey,values:Record<string,string|number>={}):DeterministicReply{return{...this.reply(this.copy(locale,key,values)),responsePlan:{kind:'localized_template',template:{namespace:'appointment',key},values}};}
  // Reusable WhatsApp reply buttons for any yes/no question this flow asks.
  // The id is checked directly by DeterministicUnderstandingProvider ahead
  // of matching the tapped title's reconstructed text, so it stays correct
  // even if the button label copy changes.
  private yesNoButtons(locale:Locale):InteractiveMessage{
    return{
      type:'buttons',
      // LocalizedResponseComposer.compose() always overwrites this with the
      // plan's own rendered text; the placeholder only satisfies the type.
      body:'',
      options:[
        {id:'confirm:yes',title:this.copy(locale,'yesButton')},
        {id:'confirm:no',title:this.copy(locale,'noButton')},
      ],
    };
  }
  private yesNoReply(locale:Locale,key:AppointmentCopyKey,values:Record<string,string|number>={}):DeterministicReply{
    return{...this.reply(this.copy(locale,key,values)),responsePlan:{kind:'localized_template',template:{namespace:'appointment',key},values,interactive:this.yesNoButtons(locale)}};
  }
  private plannedReply(content:PlannedContent):DeterministicReply{return{...this.reply(content.body),responsePlan:content.plan};}
  private content(locale:Locale,segments:AppointmentSegment[],interactive?:InteractiveMessage):PlannedContent{const body=segments.map(segment=>segment.kind==='line_break'?'\n':segment.kind==='verified_text'?segment.text:this.copy(locale,segment.template.key,segment.values)).join('');return{body,plan:{kind:'composite',segments,...(interactive?{interactive}:{})}};}
  private copy(locale:Locale,key:AppointmentCopyKey,values:Record<string,string|number>={}){return appointmentCopy(locale,key,values);}
}
