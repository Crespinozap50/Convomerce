import { LoggroOrderSyncService } from '../pos-integrations/loggro-order-sync.service';
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { forbidden, notFound, badRequest } from '../observability/http-errors';
import { catalogFor, interpolate } from '../localization/localization';

export type CommercialRequestStatus='accepted'|'in_progress'|'completed'|'cancelled'|'rejected';
// Rows returned by the several SELECT statements this service maps from
// (list/changeStatus each project a different, overlapping column set) —
// not every field is present on every row, hence the broad optionality.
interface CommercialRequestRow{
  id:string;request_type:string;status:string;currency:string;
  subtotal_minor:string|number|null;total_minor:string|number|null;
  fulfillment_type?:string|null;customer_notes?:string|null;cancellation_note?:string|null;
  confirmed_at?:string|Date|null;created_at?:string|Date;updated_at?:string|Date;
  display_name?:string|null;provider_subject?:string|null;line_count?:string|number|null;
  appointment_id?:string|null;appointment_status?:string|null;
  appointment_starts_at?:string|Date|null;appointment_ends_at?:string|Date|null;
  appointment_timezone?:string|null;appointment_resource_id?:string|null;
  appointment_resource_name?:string|null;appointment_resource_type?:string|null;
  pos_sync_status?:string;pos_external_order_id?:string[]|null;pos_last_error_code?:string|null;
}
const transitions:Record<string,CommercialRequestStatus[]>={
  draft:['cancelled'],awaiting_confirmation:['cancelled','rejected'],ready:['accepted','rejected','cancelled'],
  accepted:['in_progress','cancelled'],in_progress:['completed','cancelled'],
};

@Injectable()
export class CommercialRequestsService {
  constructor(private readonly db:DatabaseService,private readonly orderSync:LoggroOrderSyncService) {}
  list(tenantId:string,userId:string){return this.db.withTenantTransaction(tenantId,async client=>{
    const actor=await this.actor(client,userId);
    const unread=await client.query<{count:number}>(`select count(*)::integer count
      from app.commercial_requests request
      where request.status='ready' and request.updated_at>coalesce(
        (select read.last_seen_at from app.commercial_request_reads read where read.user_id=$1),'-infinity'::timestamptz
      )`,[userId]);
    const result=await client.query(`select request.id,request.request_type,request.status,request.currency,
      request.subtotal_minor::text,request.total_minor::text,request.fulfillment_type,request.customer_notes,
      request.cancellation_note,request.pos_sync_status,request.pos_external_order_id,request.pos_last_error_code,
      request.confirmed_at,request.created_at,request.updated_at,contact.display_name,
      identity.provider_subject,count(line.id) filter(where line.status='active')::integer line_count,
      appointment.id appointment_id,appointment.status appointment_status,appointment.starts_at appointment_starts_at,
      appointment.ends_at appointment_ends_at,appointment.timezone appointment_timezone,
      resource.id appointment_resource_id,resource.name appointment_resource_name,resource.resource_type appointment_resource_type
      from app.commercial_requests request
      join app.contacts contact on contact.tenant_id=request.tenant_id and contact.id=request.contact_id
      left join lateral(select provider_subject from app.contact_identities where tenant_id=request.tenant_id and contact_id=contact.id order by created_at limit 1) identity on true
      left join app.request_lines line on line.tenant_id=request.tenant_id and line.commercial_request_id=request.id
      left join app.appointments appointment on appointment.tenant_id=request.tenant_id and appointment.commercial_request_id=request.id
      left join app.booking_resources resource on resource.tenant_id=appointment.tenant_id and resource.id=appointment.resource_id
      group by request.id,contact.display_name,identity.provider_subject,appointment.id,resource.id
      order by case request.status when 'ready' then 0 when 'accepted' then 1 when 'in_progress' then 2 else 3 end,request.updated_at desc limit 200`);
    return{canManage:actor.role!=='viewer',canCancelSent:['owner','admin','platform_admin'].includes(actor.role),newCount:Number(unread.rows[0]?.count??0),requests:result.rows.map(this.map)};
  })}
  markSeen(tenantId:string,userId:string){return this.db.withTenantTransaction(tenantId,async client=>{
    await this.actor(client,userId);
    await client.query(`insert into app.commercial_request_reads(tenant_id,user_id,last_seen_at)
      values(app.current_tenant_id(),$1,now())
      on conflict(tenant_id,user_id) do update set last_seen_at=excluded.last_seen_at,updated_at=now()`,[userId]);
    return{seen:true};
  })}
  detail(tenantId:string,userId:string,requestId:string){return this.db.withTenantTransaction(tenantId,async client=>{
    const actor=await this.actor(client,userId);
    const request=await client.query(`select request.*,contact.display_name,identity.provider_subject,
      appointment.id appointment_id,appointment.status appointment_status,appointment.starts_at appointment_starts_at,
      appointment.ends_at appointment_ends_at,appointment.timezone appointment_timezone,
      resource.id appointment_resource_id,resource.name appointment_resource_name,resource.resource_type appointment_resource_type
      from app.commercial_requests request join app.contacts contact on contact.tenant_id=request.tenant_id and contact.id=request.contact_id
      left join lateral(select provider_subject from app.contact_identities where tenant_id=request.tenant_id and contact_id=contact.id order by created_at limit 1) identity on true
      left join app.appointments appointment on appointment.tenant_id=request.tenant_id and appointment.commercial_request_id=request.id
      left join app.booking_resources resource on resource.tenant_id=appointment.tenant_id and resource.id=appointment.resource_id
      where request.id=$1`,[requestId]);
    if(!request.rows[0])throw notFound('COMMERCIAL_REQUEST_NOT_FOUND','Commercial request was not found');
    const lines=await client.query(`select id,description_snapshot,unit_price_minor_snapshot::text,currency,quantity::text,line_total_minor::text,attributes_snapshot,status from app.request_lines where commercial_request_id=$1 order by created_at`,[requestId]);
    // Found live reviewing a real conversation (Santiago, Santos Tacos):
    // a paid addition ("Guacamole", +$3.000) never appeared in this panel
    // at all — this query only ever read app.request_lines, never joined
    // app.request_line_modifiers, even though the modifier is correctly
    // priced into line_total_minor/total_minor and (since D-189) sent to
    // Loggro with its own real price. Nested per line, same convention as
    // the WhatsApp confirmation's own "+ Guacamole: $3.000" summary.
    const modifiers=await client.query(`select request_line_id,description_snapshot,unit_price_delta_minor_snapshot::text,quantity::text,total_delta_minor::text from app.request_line_modifiers where request_line_id=any($1::uuid[]) order by created_at`,[lines.rows.map(row=>row.id)]);
    const modifiersByLine=new Map<string,{description:string;unitPriceDeltaMinor:number;quantity:number;totalDeltaMinor:number}[]>();
    for(const row of modifiers.rows){
      const list=modifiersByLine.get(row.request_line_id)??[];
      list.push({description:row.description_snapshot,unitPriceDeltaMinor:Number(row.unit_price_delta_minor_snapshot),quantity:Number(row.quantity),totalDeltaMinor:Number(row.total_delta_minor)});
      modifiersByLine.set(row.request_line_id,list);
    }
    return{canManage:actor.role!=='viewer',canCancelSent:['owner','admin','platform_admin'].includes(actor.role),request:this.map(request.rows[0]),lines:lines.rows.map(row=>({id:row.id,description:row.description_snapshot,unitPriceMinor:Number(row.unit_price_minor_snapshot),currency:row.currency,quantity:Number(row.quantity),lineTotalMinor:Number(row.line_total_minor),attributes:row.attributes_snapshot,status:row.status,modifiers:modifiersByLine.get(row.id)??[]}))};
  })}
  changeStatus(tenantId:string,userId:string,requestId:string,status:CommercialRequestStatus){return this.db.withTenantTransaction(tenantId,async client=>{
    await this.actor(client,userId,true);
    const current=await client.query<{status:string;request_type:string;appointment_id:string|null;appointment_status:string|null}>(
      `select request.status,request.request_type,appointment.id appointment_id,appointment.status appointment_status
       from app.commercial_requests request
       left join app.appointments appointment on appointment.tenant_id=request.tenant_id and appointment.commercial_request_id=request.id
       where request.id=$1 for update of request`,[requestId]);
    if(!current.rows[0])throw notFound('COMMERCIAL_REQUEST_NOT_FOUND','Commercial request was not found');
    if(!transitions[current.rows[0].status]?.includes(status))throw badRequest('INVALID_STATUS_TRANSITION',`Cannot move commercial request from ${current.rows[0].status} to ${status}`);
    // D-202 (docs/decisions.md): an 'order' already 'accepted' was already
    // pushed to Loggro (see the 'accepted' branch below) — the kitchen is
    // already preparing it. The project owner confirmed there's no real
    // cancel from there, only a direct call outside the app, so this stays
    // stricter than the generic `transitions` map above (which still
    // allows accepted/in_progress -> cancelled — a reservation/appointment
    // has no POS/kitchen step and keeps being cancellable after
    // acceptance, so this check is deliberately scoped to request_type
    // 'order' only, never a blanket rule).
    if(status==='cancelled'&&current.rows[0].request_type==='order'&&['accepted','in_progress'].includes(current.rows[0].status))
      throw badRequest('ORDER_ALREADY_IN_PREPARATION','This order was already sent to the POS and is being prepared — it can no longer be cancelled from here');
    if(status==='cancelled'&&current.rows[0].appointment_id&&['held','confirmed'].includes(current.rows[0].appointment_status??'')){
      await client.query(`select app.transition_appointment($1,'cancel',null,null)`,[current.rows[0].appointment_id]);
    }
    const result=await client.query(`update app.commercial_requests set status=$2,updated_at=now(),version=version+1 where id=$1 returning *`,[requestId,status]);
    // Found live: the customer was never told their order got accepted —
    // "Aceptar pedido" only ever changed the panel's own status, no
    // message went back to WhatsApp at all. Only for 'order' (a
    // reservation/appointment has its own separate confirmation copy,
    // out of scope here) and only on the specific transition into
    // 'accepted' — re-accepting isn't a real transition (see `transitions`
    // above, 'accepted' only reachable from 'ready') so this never fires
    // twice for the same order.
    if(status==='accepted'&&current.rows[0].request_type==='order'){
      await this.notifyOrderAccepted(client,tenantId,requestId);
      await this.pushToLoggro(client,tenantId,requestId);
    }
    // Only 'draft'/'awaiting_confirmation' can still have an active
    // conversation_workflow at this point — every later transition
    // (ready/accepted/in_progress) already had its own workflow closed by
    // commercial-flow.service.ts once the customer finished building the
    // order. Without this, an admin cancelling a draft/pending order from
    // the panel while the customer is still mid-chat leaves their workflow
    // dangling in whatever step it was in, permanently trapping every
    // later message they send against a now-dead request — the same
    // failure class already fixed for the chat's own "Cancelar pedido"
    // command (see the sibling update a few lines above this file's
    // 'cancelled' branch in commercial-flow.service.ts). Found live
    // testing D-099.
    if(status==='cancelled'||status==='rejected'){
      // app.conversation_workflows.status has no 'rejected' value (only
      // active/completed/cancelled/expired) — a rejected order is, from the
      // customer's chat-side perspective, exactly the same "this order is
      // dead, stop offering to continue it" as a cancelled one.
      await client.query(
        `update app.conversation_workflows set status='cancelled',updated_at=now() where commercial_request_id=$1 and status='active'`,
        [requestId],
      );
    }
    return{request:this.map(result.rows[0])};
  })}
  // D-202 reversed (docs/decisions.md): an administrator can cancel an order
  // that was already sent to Loggro, from the panel, with a mandatory note
  // (Loggro's own `causeCancel`). Loggro is cancelled FIRST — if it refuses
  // (or the order isn't on a "Bot Convomerce N" table) nothing changes here.
  // Then, in one transaction: status/note/workflows and the customer's
  // WhatsApp notice commit together. The note is internal — the customer's
  // message never includes it.
  async cancelSentOrder(tenantId:string,userId:string,requestId:string,note:string){
    const externalIds=await this.db.withTenantTransaction(tenantId,async client=>{
      const actor=await this.actor(client,userId,true);
      if(!['owner','admin','platform_admin'].includes(actor.role))
        throw forbidden('CANCEL_SENT_ORDER_FORBIDDEN','Only administrators can cancel an order already sent to the kitchen');
      const row=await client.query<{status:string;request_type:string;pos_external_order_id:string[]|null}>(
        `select status,request_type,pos_external_order_id from app.commercial_requests where id=$1`,[requestId]);
      if(!row.rows[0])throw notFound('COMMERCIAL_REQUEST_NOT_FOUND','Commercial request was not found');
      if(row.rows[0].request_type!=='order'||!['accepted','in_progress'].includes(row.rows[0].status))
        throw badRequest('ORDER_NOT_CANCELLABLE_HERE','Only accepted or in-preparation orders can be cancelled this way');
      return row.rows[0].pos_external_order_id??[];
    });
    if(externalIds.length>0)await this.orderSync.cancelOrder(tenantId,requestId,note);
    return this.db.withTenantTransaction(tenantId,async client=>{
      const result=await client.query(
        `update app.commercial_requests set status='cancelled',cancellation_note=$2,updated_at=now(),version=version+1
          where id=$1 and status in ('accepted','in_progress') returning *`,[requestId,note]);
      if(!result.rows[0])throw badRequest('ORDER_NOT_CANCELLABLE_HERE','The order changed status while it was being cancelled');
      await client.query(`update app.conversation_workflows set status='cancelled',updated_at=now() where commercial_request_id=$1 and status='active'`,[requestId]);
      await this.notifyCustomer(client,tenantId,requestId,'orderCancelledByBusiness');
      return{request:this.map(result.rows[0])};
    });
  }
  // D-1xx (docs/decisions.md): Loggro POS push tracks its own outcome
  // directly on this row (pos_sync_status/pos_external_order_id/
  // pos_last_error_code — see database/sql/085_loggro_pos_integration.sql)
  // rather than a generic job-outcome table, same pattern as this file's
  // own appointment fields. 'not_applicable' (the default for every tenant
  // without loggro_pos enabled) is surfaced as-is, not hidden — the panel
  // only needs to react to 'failed'.
  retryPosSync(tenantId:string,userId:string,requestId:string){return this.db.withTenantTransaction(tenantId,async client=>{
    await this.actor(client,userId,true);
    const current=await client.query<{request_type:string;pos_sync_status:string}>(
      `select request_type,pos_sync_status from app.commercial_requests where id=$1`,[requestId]);
    if(!current.rows[0])throw notFound('COMMERCIAL_REQUEST_NOT_FOUND','Commercial request was not found');
    if(current.rows[0].request_type!=='order')throw badRequest('LOGGRO_RETRY_NOT_APPLICABLE','Only orders can be pushed to Loggro');
    await client.query(`update app.commercial_requests set pos_sync_status='pending',pos_last_error_code=null where id=$1`,[requestId]);
    await client.query(
      `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
       values($1,$2,'order.confirmed','commercial_request',$3,$4,1,jsonb_build_object('commercialRequestId',($3::uuid)::text))`,
      [uuidv7(),tenantId,requestId,uuidv7()],
    );
    return{retried:true};
  })}
  // Same 'message.send_requested' outbox pattern already used by
  // conversations.service.ts's own manual-send and this file's own
  // retryPosSync — inserted in the SAME transaction/client as the status
  // update above (never a nested withTenantTransaction call) so the
  // notification and the status change commit or roll back together.
  // sender_type='system' (not 'user'): this is a bot-generated
  // notification, not a human agent's typed message, so it must not flip
  // the conversation into human-handling mode the way conversations.
  // service.ts's send() deliberately does for a real agent reply.
  private notifyOrderAccepted(client:PoolClient,tenantId:string,requestId:string){return this.notifyCustomer(client,tenantId,requestId,'orderAccepted')}
  private async notifyCustomer(client:PoolClient,tenantId:string,requestId:string,copyKey:'orderAccepted'|'orderCancelledByBusiness'){
    const conversation=await client.query<{conversation_id:string;channel_id:string;locale:string|null}>(
      `select request.conversation_id,conv.channel_id,coalesce(conv.language_locale,tenant.default_locale) locale
         from app.commercial_requests request
         join app.conversations conv on conv.tenant_id=request.tenant_id and conv.id=request.conversation_id
         join app.tenants tenant on tenant.id=request.tenant_id
        where request.id=$1`,[requestId]);
    if(!conversation.rows[0])return;
    const {conversation_id,channel_id,locale}=conversation.rows[0];
    const reference=requestId.slice(-8).toUpperCase();
    const text=interpolate(catalogFor(locale).bot[copyKey],{reference});
    const messageId=uuidv7();
    await client.query(
      `insert into app.messages(id,tenant_id,conversation_id,channel_id,direction,sender_type,message_type,content,delivery_status,occurred_at)
       values($1,$2,$3,$4,'outbound','system','text',jsonb_build_object('body',$5::text),'queued',now())`,
      [messageId,tenantId,conversation_id,channel_id,text],
    );
    await client.query(
      `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
       values($1,$2,'message.send_requested','message',$3,$4,1,jsonb_build_object('messageId',($3::uuid)::text))`,
      [uuidv7(),tenantId,messageId,uuidv7()],
    );
  }
  // D-191 (docs/decisions.md): moved here from commercial-flow.service.ts's
  // handleAwaitingConfirmation() — a real pedido used to reach Loggro the
  // moment the customer confirmed by WhatsApp, before any human at the
  // restaurant had actually seen it. Same outbox pattern as before
  // (order.confirmed → CommerceEventsWorker → LoggroOrderSyncService),
  // just triggered by the admin's own "Aceptar pedido" action instead —
  // read-only and inserts nothing for any tenant without loggro_pos
  // enabled (every tenant but Santos Tacos today).
  private async pushToLoggro(client:PoolClient,tenantId:string,requestId:string){
    const posEnabled=await client.query<{enabled:boolean}>(
      `select enabled from app.tenant_capabilities where tenant_id=$1 and capability='loggro_pos'`,[tenantId]);
    if(!posEnabled.rows[0]?.enabled)return;
    await client.query(`update app.commercial_requests set pos_sync_status='pending' where id=$1`,[requestId]);
    await client.query(
      `insert into app.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,correlation_id,payload_schema_version,payload)
       values($1,$2,'order.confirmed','commercial_request',$3,$4,1,jsonb_build_object('commercialRequestId',($3::uuid)::text))`,
      [uuidv7(),tenantId,requestId,uuidv7()],
    );
  }
  private async actor(client:PoolClient,userId:string,manage=false){const result=await client.query(`select role from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active'`,[userId]);if(result.rows[0]){if(manage&&result.rows[0].role==='viewer')throw forbidden('COMMERCIAL_REQUESTS_FORBIDDEN','Actor cannot manage commercial requests');return result.rows[0]}const platform=await client.query(`select app.can_manage_channel_connections($1) allowed`,[userId]);if(!platform.rows[0]?.allowed)throw forbidden('COMMERCIAL_REQUESTS_FORBIDDEN','Actor cannot access commercial requests');return{role:'platform_admin'}}
  private map=(row:CommercialRequestRow)=>({id:row.id,type:row.request_type,status:row.status,currency:row.currency,subtotalMinor:Number(row.subtotal_minor??0),totalMinor:Number(row.total_minor??0),fulfillmentType:row.fulfillment_type,customerNotes:row.customer_notes,cancellationNote:row.cancellation_note??null,confirmedAt:row.confirmed_at,createdAt:row.created_at,updatedAt:row.updated_at,customerName:row.display_name||row.provider_subject||'Unknown customer',customerAddress:row.provider_subject??null,lineCount:Number(row.line_count??0),posSyncStatus:row.pos_sync_status??'not_applicable',posExternalOrderId:row.pos_external_order_id?.[0]??null,posLastErrorCode:row.pos_last_error_code??null,appointment:row.appointment_id?{id:row.appointment_id,status:row.appointment_status,startsAt:row.appointment_starts_at,endsAt:row.appointment_ends_at,timezone:row.appointment_timezone,resource:{id:row.appointment_resource_id,name:row.appointment_resource_name,type:row.appointment_resource_type}}:null});
}
