import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { AcceptedRecommendation, RecommendedItem } from './recommendation.types';
import { catalogFor, ConversationLocale, formatMoney, interpolate } from '../localization/localization';
interface CandidateRow { recommendation_id:string; variant_id:string; item_name:string; variant_name:string; price_minor:string; currency:string }

@Injectable()
export class RecommendationService {
  async suggest(client:PoolClient,input:{tenantId:string;conversationId:string;requestId:string;locale:ConversationLocale}):Promise<RecommendedItem|null>{
    const result=await client.query<CandidateRow>(
      `select recommendation.id::text recommendation_id,target.id::text variant_id,
              item.name item_name,target.name variant_name,target.price_minor::text,target.currency
         from app.request_lines line
         join app.product_recommendations recommendation
           on recommendation.tenant_id=line.tenant_id and recommendation.source_variant_id=line.item_variant_id
          and recommendation.status='active'
         join app.item_variants target
           on target.tenant_id=recommendation.tenant_id and target.id=recommendation.target_variant_id
         join app.catalog_items item on item.tenant_id=target.tenant_id and item.id=target.catalog_item_id
        where line.commercial_request_id=$1 and line.status='active'
          and target.status='active' and target.availability_status='available' and item.status='active'
          and not exists(select 1 from app.request_lines existing where existing.commercial_request_id=$1 and existing.item_variant_id=target.id and existing.status='active')
          and not exists(select 1 from app.recommendation_events previous where previous.commercial_request_id=$1 and previous.target_variant_id=target.id and previous.status in('shown','accepted','rejected'))
          -- Suggesting another item from a category already in the cart
          -- ("you have Nachos, want more Nachos?") isn't a useful cross-sell
          -- — excluded regardless of which specific product/variant it is.
          -- A candidate with no category set is never excluded this way
          -- (item.category is not null below), so tenants that never
          -- categorized their catalog keep the exact previous behavior.
          and not exists(
            select 1
              from app.request_lines cart_line
              join app.item_variants cart_variant
                on cart_variant.tenant_id=cart_line.tenant_id and cart_variant.id=cart_line.item_variant_id
              join app.catalog_items cart_item
                on cart_item.tenant_id=cart_variant.tenant_id and cart_item.id=cart_variant.catalog_item_id
             where cart_line.commercial_request_id=$1 and cart_line.status='active'
               and cart_item.category is not null and item.category is not null
               and cart_item.category=item.category
          )
        order by recommendation.priority desc,recommendation.id limit 1`,[input.requestId]);
    const candidate=result.rows[0];
    if(!candidate)return null;
    const eventId=uuidv7();
    await client.query(`insert into app.recommendation_events(id,tenant_id,conversation_id,commercial_request_id,recommendation_id,target_variant_id,status) values($1,$2,$3,$4,$5,$6,'shown')`,[eventId,input.tenantId,input.conversationId,input.requestId,candidate.recommendation_id,candidate.variant_id]);
    const copy=catalogFor(input.locale).bot;
    const price=formatMoney(candidate.price_minor,candidate.currency,input.locale);
    const body=interpolate(copy.recommendation,{item:candidate.item_name,price});
    return{eventId,variantId:candidate.variant_id,itemName:candidate.item_name,variantName:candidate.variant_name,priceMinor:candidate.price_minor,currency:candidate.currency,interactive:{type:'buttons',body,options:[{id:`rec:add:${eventId}`,title:copy.recommendationAccept},{id:`rec:reject:${eventId}`,title:copy.recommendationReject}]}};
  }

  async accept(client:PoolClient,eventId:string):Promise<AcceptedRecommendation|null>{
    const result=await client.query<CandidateRow&{event_id:string}>(`update app.recommendation_events event set status='accepted',responded_at=now() from app.item_variants target,app.catalog_items item where event.id=$1 and event.status='shown' and target.tenant_id=event.tenant_id and target.id=event.target_variant_id and target.status='active' and target.availability_status='available' and item.tenant_id=target.tenant_id and item.id=target.catalog_item_id returning event.id::text event_id,target.id::text variant_id,item.name item_name,target.name variant_name,target.price_minor::text,target.currency`,[eventId]);
    const row=result.rows[0];
    return row?{eventId:row.event_id,variantId:row.variant_id,itemName:row.item_name,variantName:row.variant_name,priceMinor:row.price_minor,currency:row.currency}:null;
  }

  async reject(client:PoolClient,eventId:string):Promise<boolean>{
    const result=await client.query(`update app.recommendation_events set status='rejected',responded_at=now() where id=$1 and status='shown' returning id`,[eventId]);
    return result.rowCount===1;
  }
}
