import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { createHmac,createHash,timingSafeEqual } from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { badRequest,forbidden } from '../observability/http-errors';
import { CredentialEncryptionService } from '../secrets/credential-encryption.service';
@Injectable()
export class GoogleCalendarService{
 constructor(private readonly db:DatabaseService,private readonly config:ConfigService,private readonly credentials:CredentialEncryptionService){}
 async authorizationUrl(tenantId:string,userId:string){await this.db.withTenantTransaction(tenantId,async client=>{const member=await client.query(`select role from app.tenant_users where user_id=$1 and status='active'`,[userId]);const allowed=member.rows[0]?member.rows[0].role!=='viewer':(await client.query(`select app.can_manage_channel_connections($1) allowed`,[userId])).rows[0]?.allowed;if(!allowed)throw forbidden('GOOGLE_CALENDAR_FORBIDDEN','Actor cannot connect calendars')});const clientId=this.required('GOOGLE_CALENDAR_CLIENT_ID');const payload=Buffer.from(JSON.stringify({tenantId,userId,expiresAt:Date.now()+600000})).toString('base64url');const state=`${payload}.${this.sign(payload)}`;const query=new URLSearchParams({client_id:clientId,redirect_uri:this.redirectUri(),response_type:'code',access_type:'offline',prompt:'consent',include_granted_scopes:'true',scope:'https://www.googleapis.com/auth/calendar',state});return{authorizationUrl:`https://accounts.google.com/o/oauth2/v2/auth?${query}`}}
 async callback(code:string,state:string){const[payload,signature]=state.split('.');if(!payload||!signature||!this.valid(payload,signature))throw badRequest('GOOGLE_OAUTH_STATE_INVALID','OAuth state is invalid');const context=JSON.parse(Buffer.from(payload,'base64url').toString()) as {tenantId:string;expiresAt:number};if(context.expiresAt<Date.now())throw badRequest('GOOGLE_OAUTH_STATE_EXPIRED','OAuth state expired');const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:this.required('GOOGLE_CALENDAR_CLIENT_ID'),client_secret:this.required('GOOGLE_CALENDAR_CLIENT_SECRET'),redirect_uri:this.redirectUri(),grant_type:'authorization_code'})});const tokens=await response.json() as {refresh_token?:string;error?:string};if(!response.ok||!tokens.refresh_token)throw badRequest('GOOGLE_TOKEN_EXCHANGE_FAILED',tokens.error??'Google did not return a refresh token');await this.db.withTenantTransaction(context.tenantId,async client=>{const existing=await client.query<{id:string}>(`select id from app.calendar_sources where provider='google_calendar' order by created_at limit 1`);const secret=this.credentials.encrypt(tokens.refresh_token!);if(existing.rows[0])await client.query(`update app.calendar_sources set secret_reference=$2,status='connected',last_error_code=null,updated_at=now() where id=$1`,[existing.rows[0].id,secret]);else await client.query(`insert into app.calendar_sources(id,tenant_id,provider,display_name,secret_reference,status) values($1,$2,'google_calendar','Google Calendar',$3,'connected')`,[uuidv7(),context.tenantId,secret])});return this.config.get<string>('FRONTEND_ORIGIN','http://localhost:5173')}
 async calendars(tenantId:string,userId:string,sourceId:string){
  const refreshToken=await this.db.withTenantTransaction(tenantId,async client=>{
   await this.ensureAccess(client,userId);
   const result=await client.query<{secret_reference:string|null}>(`select secret_reference from app.calendar_sources where id=$1 and provider='google_calendar' and status='connected'`,[sourceId]);
   if(!result.rows[0]?.secret_reference)throw badRequest('GOOGLE_CALENDAR_NOT_CONNECTED','Google Calendar is not connected');
   return this.credentials.decrypt(result.rows[0].secret_reference);
  });
  const accessToken=await this.accessToken(refreshToken);
  const response=await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&showHidden=false',{headers:{authorization:`Bearer ${accessToken}`}});
  const body=await response.json() as {items?:Array<{id:string;summary?:string;description?:string;primary?:boolean;accessRole?:string;timeZone?:string;backgroundColor?:string}>;error?:{message?:string}};
  if(!response.ok)throw badRequest('GOOGLE_CALENDAR_LIST_FAILED',body.error?.message??'Google calendars could not be loaded');
  return{calendars:(body.items??[]).map(item=>({id:item.id,name:item.summary??item.id,description:item.description??null,primary:Boolean(item.primary),accessRole:item.accessRole??null,timezone:item.timeZone??null,color:item.backgroundColor??null})).sort((a,b)=>Number(b.primary)-Number(a.primary)||a.name.localeCompare(b.name))};
 }
 async syncAppointment(tenantId:string,appointmentId:string,action:'confirmed'|'rescheduled'|'cancelled'){
  const context=await this.db.withTenantTransaction(tenantId,async client=>{
   const result=await client.query<{
    id:string;status:string;starts_at:string;ends_at:string;timezone:string;external_reference:string|null;
    calendar_source_id:string|null;source_id:string|null;secret_reference:string|null;external_calendar_id:string|null;
    item_name:string;contact_name:string;resource_name:string|null;
   }>(`select appointment.id,appointment.status,appointment.starts_at,appointment.ends_at,appointment.timezone,
      appointment.external_reference,appointment.calendar_source_id,item.name item_name,
      coalesce(contact.display_name,'Cliente') contact_name,resource.name resource_name,
      source.id source_id,source.secret_reference,
      case when source.scheduling_mode='global' then source.global_external_calendar_id else link.external_calendar_id end external_calendar_id
     from app.appointments appointment
     join app.catalog_items item on item.tenant_id=appointment.tenant_id and item.id=appointment.catalog_item_id
     join app.contacts contact on contact.tenant_id=appointment.tenant_id and contact.id=appointment.contact_id
     left join app.booking_resources resource on resource.tenant_id=appointment.tenant_id and resource.id=appointment.resource_id
     left join lateral(
       select candidate.* from app.calendar_sources candidate
       where candidate.provider='google_calendar' and candidate.status='connected'
         and (appointment.calendar_source_id is null or candidate.id=appointment.calendar_source_id)
       order by (candidate.id=appointment.calendar_source_id) desc,candidate.created_at limit 1
     ) source on true
     left join app.resource_calendar_links link on link.calendar_source_id=source.id
       and link.resource_id=appointment.resource_id and link.status='active'
     where appointment.id=$1`,[appointmentId]);
   const row=result.rows[0];
   if(!row)throw new Error('Appointment was not found for Google Calendar synchronization');
   if(!row.source_id||!row.secret_reference||!row.external_calendar_id)throw new Error('Google Calendar destination is not configured for this appointment');
   return row;
  });
  const accessToken=await this.accessToken(this.credentials.decrypt(context.secret_reference!));
  const eventId=context.external_reference??context.id.replaceAll('-','');
  const calendarId=encodeURIComponent(context.external_calendar_id!);
  const eventUrl=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`;
  if(action==='cancelled'){
   const response=await fetch(eventUrl,{method:'DELETE',headers:{authorization:`Bearer ${accessToken}`}});
   if(!response.ok&&![404,410].includes(response.status))throw new Error(`Google Calendar event cancellation failed with HTTP ${response.status}`);
   return{synced:true,action,eventId};
  }
  const event={id:eventId,summary:`${context.item_name} — ${context.contact_name}`,description:`Reserva ${context.id}${context.resource_name?`\nRecurso: ${context.resource_name}`:''}`,start:{dateTime:new Date(context.starts_at).toISOString(),timeZone:context.timezone},end:{dateTime:new Date(context.ends_at).toISOString(),timeZone:context.timezone},extendedProperties:{private:{tenantId,appointmentId:context.id}}};
  let response:Response;
  if(context.external_reference||action==='rescheduled')response=await fetch(eventUrl,{method:'PUT',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(event)});
  else response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,{method:'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(event)});
  if(response.status===409)response=await fetch(eventUrl,{method:'PUT',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(event)});
  const body=await response.json().catch(()=>({})) as {id?:string;error?:{message?:string}};
  if(!response.ok||!body.id)throw new Error(body.error?.message??`Google Calendar event synchronization failed with HTTP ${response.status}`);
  await this.db.withTenantTransaction(tenantId,async client=>{await client.query(`update app.appointments set calendar_source_id=$2,external_reference=$3,updated_at=now() where id=$1`,[appointmentId,context.source_id,body.id])});
  return{synced:true,action,eventId:body.id};
 }
 private async ensureAccess(client:PoolClient,userId:string){const member=await client.query(`select role from app.tenant_users where user_id=$1 and status='active'`,[userId]);const allowed=member.rows[0]?member.rows[0].role!=='viewer':(await client.query(`select app.can_manage_channel_connections($1) allowed`,[userId])).rows[0]?.allowed;if(!allowed)throw forbidden('GOOGLE_CALENDAR_FORBIDDEN','Actor cannot manage calendars')}
 private async accessToken(refreshToken:string){const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:refreshToken,client_id:this.required('GOOGLE_CALENDAR_CLIENT_ID'),client_secret:this.required('GOOGLE_CALENDAR_CLIENT_SECRET'),grant_type:'refresh_token'})});const body=await response.json() as {access_token?:string;error_description?:string;error?:string};if(!response.ok||!body.access_token)throw badRequest('GOOGLE_TOKEN_REFRESH_FAILED',body.error_description??body.error??'Google access token could not be refreshed');return body.access_token}
 private redirectUri(){return this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI')??'http://localhost:3000/v1/integrations/google-calendar/callback'}private required(name:string){const value=this.config.get<string>(name);if(!value)throw badRequest('GOOGLE_CALENDAR_NOT_CONFIGURED',`${name} is not configured`);return value}private key(){return createHash('sha256').update(this.required('CREDENTIAL_ENCRYPTION_KEY')).digest()}private sign(value:string){return createHmac('sha256',this.key()).update(value).digest('base64url')}private valid(value:string,signature:string){const expected=Buffer.from(this.sign(value)),actual=Buffer.from(signature);return expected.length===actual.length&&timingSafeEqual(expected,actual)}
}
