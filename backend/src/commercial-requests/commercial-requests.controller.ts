import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { validate as uuid } from 'uuid';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { badRequest } from '../observability/http-errors';
import { CommercialRequestStatus, CommercialRequestsService } from './commercial-requests.service';

@Controller('v1/admin/tenants/:tenantId/commercial-requests')
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class CommercialRequestsController {
  constructor(private readonly service: CommercialRequestsService) {}
  @Get() list(@Param('tenantId') tenantId:string,@Req() req:AuthenticatedRequest){valid(tenantId);return this.service.list(tenantId,req.actor.userId)}
  @Post('seen') seen(@Param('tenantId') tenantId:string,@Req() req:AuthenticatedRequest){valid(tenantId);return this.service.markSeen(tenantId,req.actor.userId)}
  @Get(':requestId') detail(@Param('tenantId') tenantId:string,@Param('requestId') requestId:string,@Req() req:AuthenticatedRequest){valid(tenantId,requestId);return this.service.detail(tenantId,req.actor.userId,requestId)}
  @Patch(':requestId/status') status(@Param('tenantId') tenantId:string,@Param('requestId') requestId:string,@Body() body:unknown,@Req() req:AuthenticatedRequest){valid(tenantId,requestId);return this.service.changeStatus(tenantId,req.actor.userId,requestId,parseStatus(body))}
  @Post(':requestId/cancel-sent') cancelSent(@Param('tenantId') tenantId:string,@Param('requestId') requestId:string,@Body() body:unknown,@Req() req:AuthenticatedRequest){valid(tenantId,requestId);return this.service.cancelSentOrder(tenantId,req.actor.userId,requestId,parseCancelNote(body))}
  @Post(':requestId/retry-pos-sync') retryPosSync(@Param('tenantId') tenantId:string,@Param('requestId') requestId:string,@Req() req:AuthenticatedRequest){valid(tenantId,requestId);return this.service.retryPosSync(tenantId,req.actor.userId,requestId)}
}
function valid(...values:string[]){if(values.some(value=>!uuid(value)))throw badRequest('VALIDATION_ERROR','Identifiers must be UUIDs')}
function parseStatus(body:unknown):CommercialRequestStatus{const status=(body as {status?:unknown})?.status;const values:CommercialRequestStatus[]=['accepted','in_progress','completed','cancelled','rejected'];if(typeof status!=='string'||!values.includes(status as CommercialRequestStatus))throw badRequest('VALIDATION_ERROR','Invalid commercial request status');return status as CommercialRequestStatus}

function parseCancelNote(body:unknown):string{const note=(body as {note?:unknown})?.note;if(typeof note!=='string')throw badRequest('VALIDATION_ERROR','A cancellation note is required');const clean=note.trim();if(clean.length<5||clean.length>300)throw badRequest('VALIDATION_ERROR','The cancellation note must be between 5 and 300 characters');return clean}
