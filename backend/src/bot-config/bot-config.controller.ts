import { Body,Controller,Get,Put,Param,Req,UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PasswordReadyGuard } from '../auth/password-ready.guard';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { badRequest } from '../observability/http-errors';
import { BotConfigService, BotConfigInput } from './bot-config.service';
import { isValidLocale, normalizeLocale } from '../localization/localization';
@Controller('v1/admin/tenants/:tenantId/bot') @UseGuards(SessionAuthGuard,PasswordReadyGuard)
export class BotConfigController {
 constructor(private readonly service:BotConfigService){}
 @Get() get(@Param('tenantId') id:string,@Req() req:AuthenticatedRequest){valid(id);return this.service.get(id,req.actor.userId)}
 @Put() save(@Param('tenantId') id:string,@Body() body:unknown,@Req() req:AuthenticatedRequest){valid(id);return this.service.save(id,req.actor.userId,parse(body))}
}
function valid(id:string){if(!isUuid(id))throw badRequest('VALIDATION_ERROR','tenantId must be a UUID')}
function parse(body:unknown):BotConfigInput{const x=body as Record<string,unknown>;if(!x||typeof x!=='object')throw badRequest('VALIDATION_ERROR','Invalid configuration');const s=(v:unknown,n:string)=>{if(typeof v!=='string'||!v.trim())throw badRequest('VALIDATION_ERROR',`${n} is required`);return v.trim()};const integer=(v:unknown,n:string,min:number,max:number)=>{if(!Number.isInteger(v)||Number(v)<min||Number(v)>max)throw badRequest('VALIDATION_ERROR',`${n} must be an integer between ${min} and ${max}`);return Number(v)};const locale=s(x.locale,'locale');if(!isValidLocale(locale))throw badRequest('VALIDATION_ERROR','locale must be a valid BCP 47 language tag');const policy=(x.aiResponsePolicy??{}) as Record<string,unknown>;const conversationTimeoutMinutes=x.conversationTimeoutMinutes===null||x.conversationTimeoutMinutes===undefined?null:integer(x.conversationTimeoutMinutes,'conversationTimeoutMinutes',1,10080);const messageRetentionDays=x.messageRetentionDays===null||x.messageRetentionDays===undefined?null:integer(x.messageRetentionDays,'messageRetentionDays',7,3650);return {enabled:x.enabled===true,assistantName:s(x.assistantName,'assistantName'),locale:normalizeLocale(locale),welcomeMessage:s(x.welcomeMessage,'welcomeMessage'),fallbackMessage:s(x.fallbackMessage,'fallbackMessage'),handoffKeywords:Array.isArray(x.handoffKeywords)?x.handoffKeywords.filter(v=>typeof v==='string').map(v=>(v as string).trim()).filter(Boolean):[],conversationTimeoutMinutes,messageRetentionDays,aiResponsePolicy:{enabled:policy.enabled===true,rolloutPercentage:integer(policy.rolloutPercentage??0,'aiResponsePolicy.rolloutPercentage',0,100),dailyRequestLimit:integer(policy.dailyRequestLimit??100,'aiResponsePolicy.dailyRequestLimit',0,100000),monthlyCostLimitMinor:integer(policy.monthlyCostLimitMinor??500,'aiResponsePolicy.monthlyCostLimitMinor',0,100000000)}}}
