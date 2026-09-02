import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { forbidden, notFound, badRequest } from '../observability/http-errors';

export type CommercialRequestStatus='accepted'|'in_progress'|'completed'|'cancelled'|'rejected';
// Rows returned by the several SELECT statements this service maps from
// (list/changeStatus each project a different, overlapping column set) —
// not every field is present on every row, hence the broad optionality.
interface CommercialRequestRow{
  id:string;request_type:string;status:string;currency:string;
  subtotal_minor:string|number|null;total_minor:string|number|null;
  fulfillment_type?:string|null;customer_notes?:string|null;
  confirmed_at?:string|Date|null;created_at?:string|Date;updated_at?:string|Date;
  display_name?:string|null;provider_subject?:string|null;line_count?:string|number|null;
  appointment_id?:string|null;appointment_status?:string|null;
  appointment_starts_at?:string|Date|null;appointment_ends_at?:string|Date|null;
  appointment_timezone?:string|null;appointment_resource_id?:string|null;
  appointment_resource_name?:string|null;appointment_resource_type?:string|null;
}
const transitions:Record<string,CommercialRequestStatus[]>={
  draft:['cancelled'],awaiting_confirmation:['cancelled','rejected'],ready:['accepted','rejected','cancelled'],
  accepted:['in_progress','cancelled'],in_progress:['completed','cancelled'],
};

@Injectable()
export class CommercialRequestsService {
  constructor(private readonly db:DatabaseService) {}
  list(tenantId:string,userId:string){return this.db.withTenantTransaction(tenantId,async client=>{
    const actor=await this.actor(client,userId);
    const unread=await client.query<{count:number}>(`select count(*)::integer count
      from app.commercial_requests request
      where request.status='ready' and request.updated_at>coalesce(
        (select read.last_seen_at from app.commercial_request_reads read where read.user_id=$1),'-infinity'::timestamptz
      )`,[userId]);
    const result=await client.query(`select request.id,request.request_type,request.status,request.currency,
      request.subtotal_minor::text,request.total_minor::text,request.fulfillment_type,request.customer_notes,
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
    return{canManage:actor.role!=='viewer',newCount:Number(unread.rows[0]?.count??0),requests:result.rows.map(this.map)};
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
    return{canManage:actor.role!=='viewer',request:this.map(request.rows[0]),lines:lines.rows.map(row=>({id:row.id,description:row.description_snapshot,unitPriceMinor:Number(row.unit_price_minor_snapshot),currency:row.currency,quantity:Number(row.quantity),lineTotalMinor:Number(row.line_total_minor),attributes:row.attributes_snapshot,status:row.status}))};
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
    if(status==='cancelled'&&current.rows[0].appointment_id&&['held','confirmed'].includes(current.rows[0].appointment_status??'')){
      await client.query(`select app.transition_appointment($1,'cancel',null,null)`,[current.rows[0].appointment_id]);
    }
    const result=await client.query(`update app.commercial_requests set status=$2,updated_at=now(),version=version+1 where id=$1 returning *`,[requestId,status]);
    return{request:this.map(result.rows[0])};
  })}
  private async actor(client:PoolClient,userId:string,manage=false){const result=await client.query(`select role from app.tenant_users where tenant_id=app.current_tenant_id() and user_id=$1 and status='active'`,[userId]);if(result.rows[0]){if(manage&&result.rows[0].role==='viewer')throw forbidden('COMMERCIAL_REQUESTS_FORBIDDEN','Actor cannot manage commercial requests');return result.rows[0]}const platform=await client.query(`select app.can_manage_channel_connections($1) allowed`,[userId]);if(!platform.rows[0]?.allowed)throw forbidden('COMMERCIAL_REQUESTS_FORBIDDEN','Actor cannot access commercial requests');return{role:'platform_admin'}}
  private map=(row:CommercialRequestRow)=>({id:row.id,type:row.request_type,status:row.status,currency:row.currency,subtotalMinor:Number(row.subtotal_minor??0),totalMinor:Number(row.total_minor??0),fulfillmentType:row.fulfillment_type,customerNotes:row.customer_notes,confirmedAt:row.confirmed_at,createdAt:row.created_at,updatedAt:row.updated_at,customerName:row.display_name||row.provider_subject||'Unknown customer',customerAddress:row.provider_subject??null,lineCount:Number(row.line_count??0),appointment:row.appointment_id?{id:row.appointment_id,status:row.appointment_status,startsAt:row.appointment_starts_at,endsAt:row.appointment_ends_at,timezone:row.appointment_timezone,resource:{id:row.appointment_resource_id,name:row.appointment_resource_name,type:row.appointment_resource_type}}:null});
}
