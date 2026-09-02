import { AiUsageBudgetService } from './ai-usage-budget.service';

describe('AiUsageBudgetService',()=>{
  const context={tenantId:'tenant-1',conversationId:'conversation-1',messageId:'message-1'};
  const database=(query:jest.Mock)=>({withTenantTransaction:jest.fn((_tenantId:string,work:(client:{query:jest.Mock})=>unknown)=>work({query}))});

  it('fails closed when the tenant has no enabled policy',async()=>{
    const query=jest.fn().mockResolvedValue({rows:[]});
    const service=new AiUsageBudgetService(database(query) as never);
    await expect(service.reserve(context)).resolves.toEqual({allowed:false,reason:'tenant_disabled'});
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('atomically reserves daily and monthly capacity',async()=>{
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{enabled:true,rollout_percentage:100,daily_request_limit:10,monthly_cost_limit_minor:'500',reservation_cost_minor:'1',cost_currency:'USD'}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[
        {reserved_requests:0,completed_requests:2,reserved_cost_minor:'0',actual_cost_minor:'2'},
        {reserved_requests:0,completed_requests:20,reserved_cost_minor:'0',actual_cost_minor:'20'},
      ]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]});
    const service=new AiUsageBudgetService(database(query) as never);
    const decision=await service.reserve(context);
    expect(decision).toMatchObject({allowed:true,reservation:{tenantId:'tenant-1',reservedCostMinor:1,currency:'USD'}});
    expect(String(query.mock.calls[4][0])).toContain('reserved_requests=reserved_requests+1');
    expect(String(query.mock.calls[5][0])).toContain('ai_usage_reservations');
  });

  it('stops before reservation when the daily limit is exhausted',async()=>{
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{enabled:true,rollout_percentage:100,daily_request_limit:2,monthly_cost_limit_minor:'500',reservation_cost_minor:'1',cost_currency:'USD'}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[
        {reserved_requests:1,completed_requests:1,reserved_cost_minor:'1',actual_cost_minor:'1'},
        {reserved_requests:1,completed_requests:10,reserved_cost_minor:'1',actual_cost_minor:'10'},
      ]});
    const service=new AiUsageBudgetService(database(query) as never);
    await expect(service.reserve(context)).resolves.toEqual({allowed:false,reason:'daily_limit'});
    expect(query).toHaveBeenCalledTimes(4);
  });
});
