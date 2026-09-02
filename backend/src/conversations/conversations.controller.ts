import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { validate as uuid } from 'uuid';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { badRequest } from '../observability/http-errors';
import { ConversationAction, ConversationsService } from './conversations.service';

@Controller('v1/admin/tenants/:tenantId/conversations')
@UseGuards(SessionAuthGuard, PasswordReadyGuard)
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}
  @Get() list(@Param('tenantId') tenantId:string,@Req() req:AuthenticatedRequest){ids(tenantId);return this.service.list(tenantId,req.actor.userId)}
  @Get(':conversationId/messages') messages(@Param('tenantId') tenantId:string,@Param('conversationId') conversationId:string,@Req() req:AuthenticatedRequest){ids(tenantId,conversationId);return this.service.messages(tenantId,req.actor.userId,conversationId)}
  @Post(':conversationId/read') read(@Param('tenantId') tenantId:string,@Param('conversationId') conversationId:string,@Req() req:AuthenticatedRequest){ids(tenantId,conversationId);return this.service.markRead(tenantId,req.actor.userId,conversationId)}
  @Post(':conversationId/actions') act(@Param('tenantId') tenantId:string,@Param('conversationId') conversationId:string,@Body() body:unknown,@Req() req:AuthenticatedRequest){ids(tenantId,conversationId);return this.service.act(tenantId,req.actor.userId,conversationId,action(body))}
  @Post(':conversationId/messages') reply(@Param('tenantId') tenantId:string,@Param('conversationId') conversationId:string,@Body() body:unknown,@Req() req:AuthenticatedRequest){ids(tenantId,conversationId);return this.service.reply(tenantId,req.actor.userId,conversationId,text(body))}
  @Post(':conversationId/messages/:messageId/retry') retry(@Param('tenantId') tenantId:string,@Param('conversationId') conversationId:string,@Param('messageId') messageId:string,@Req() req:AuthenticatedRequest){ids(tenantId,conversationId,messageId);return this.service.retry(tenantId,req.actor.userId,conversationId,messageId)}
}
function ids(...values:string[]){if(values.some(value=>!uuid(value)))throw badRequest('VALIDATION_ERROR','Identifiers must be UUIDs')}
function action(body:unknown):ConversationAction{const value=(body as {action?:unknown})?.action;if(value!=='take'&&value!=='bot'&&value!=='close')throw badRequest('VALIDATION_ERROR','Invalid conversation action');return value}
function text(body:unknown):string{const value=(body as {text?:unknown})?.text;if(typeof value!=='string'||!value.trim()||value.trim().length>4000)throw badRequest('VALIDATION_ERROR','Message text is required and must not exceed 4000 characters');return value.trim()}
