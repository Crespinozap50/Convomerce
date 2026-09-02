import { RecommendationService } from './recommendation.service';

describe('RecommendationService',()=>{
  it('offers one configured available product with stable actions',async()=>{
    const client={query:jest.fn().mockResolvedValueOnce({rows:[{recommendation_id:'relation-1',variant_id:'drink-1',item_name:'Agua fresca',variant_name:'Vaso',price_minor:'500000',currency:'COP'}]}).mockResolvedValueOnce({rows:[]})};
    const result=await new RecommendationService().suggest(client as never,{tenantId:'tenant-1',conversationId:'conversation-1',requestId:'request-1',locale:'es'});
    expect(result?.interactive.type).toBe('buttons');
    expect(result?.interactive.options[0].id).toMatch(/^rec:add:/);
    expect(result?.interactive.options[1].title).toBe('No, gracias');
    expect(result?.interactive.body).toContain('Agua fresca');
    expect(result?.interactive.body).toContain('$ 5.000');
  });

  it('does not fabricate a recommendation without a configured candidate',async()=>{
    const client={query:jest.fn().mockResolvedValue({rows:[]})};
    await expect(new RecommendationService().suggest(client as never,{tenantId:'tenant-1',conversationId:'conversation-1',requestId:'request-1',locale:'es'})).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
