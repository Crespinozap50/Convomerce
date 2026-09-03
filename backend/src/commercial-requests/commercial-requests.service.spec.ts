import { CommercialRequestsService } from './commercial-requests.service';

describe('CommercialRequestsService',()=>{
  it('lists tenant-scoped requests for viewers without management permission',async()=>{
    const client={query:jest.fn(async(sql:string)=>{
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'viewer'}]};
      if(sql.includes('count(*)::integer count'))return{rows:[{count:1}]};
      return{rows:[{id:'request-1',request_type:'order',status:'ready',currency:'COP',subtotal_minor:'2500000',total_minor:'2500000',display_name:'Customer',line_count:2}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db).list('tenant-1','user-1');
    expect(result.canManage).toBe(false);
    expect(result.newCount).toBe(1);
    expect(result.requests[0]).toMatchObject({id:'request-1',type:'order',totalMinor:2500000,lineCount:2});
  });

  it('stores the current user read position when opening the inbox',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);return sql.includes('from app.tenant_users')?{rows:[{role:'operator'}]}:{rows:[]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db).markSeen('tenant-1','user-1');
    expect(queries.some(sql=>sql.includes('insert into app.commercial_request_reads'))).toBe(true);
  });

  it('accepts a ready request using a locked transition',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update'))return{rows:[{status:'ready'}]};return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(result.request.status).toBe('accepted');
    expect(queries.some(sql=>sql.includes('for update'))).toBe(true);
  });

  it('rejects an invalid lifecycle transition',async()=>{
    const client={query:jest.fn(async(sql:string)=>sql.includes('from app.tenant_users')?{rows:[{role:'operator'}]}:{rows:[{status:'completed'}]})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await expect(new CommercialRequestsService(db).changeStatus('tenant-1','user-1','request-1','accepted')).rejects.toThrow('Cannot move commercial request from completed to accepted');
  });

  it('cancels the linked appointment when an administrator cancels a reservation',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update of request'))return{rows:[{status:'accepted',request_type:'reservation',appointment_id:'appointment-1',appointment_status:'confirmed'}]};return{rows:[{id:'request-1',request_type:'reservation',status:'cancelled',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db).changeStatus('tenant-1','user-1','request-1','cancelled');
    expect(result.request.status).toBe('cancelled');
    expect(queries.some(sql=>sql.includes("transition_appointment($1,'cancel'"))).toBe(true);
  });

  // Found live testing D-099: an administrator cancelling a draft/pending
  // order from the panel left the customer's own conversation_workflow
  // (if they were still mid-chat building it) stuck 'active' in whatever
  // step it was in, permanently trapping every later message they sent —
  // the panel-side cancel never closed it, only the chat's own "Cancelar
  // pedido" command did.
  it.each([
    ['cancelled' as const, 'draft'],
    ['rejected' as const, 'awaiting_confirmation'],
  ])(
    'closes the customer\'s active conversation_workflow when an administrator transitions a request to %s',
    async (status, fromStatus) => {
      const queries:{sql:string;params:unknown[]}[]=[];
      const client={query:jest.fn(async(sql:string,params:unknown[]=[])=>{
        queries.push({sql,params});
        if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
        if(sql.includes('for update of request'))return{rows:[{status:fromStatus,request_type:'order',appointment_id:null,appointment_status:null}]};
        if(sql.includes('update app.commercial_requests'))return{rows:[{id:'request-1',request_type:'order',status,currency:'COP',subtotal_minor:'0',total_minor:'0'}]};
        return{rows:[]};
      })};
      const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
      await new CommercialRequestsService(db).changeStatus('tenant-1','user-1','request-1',status);
      const workflowUpdate=queries.find(({sql})=>sql.includes('update app.conversation_workflows'));
      expect(workflowUpdate).toBeDefined();
      // Always 'cancelled', even for a 'rejected' request — the workflow's
      // own status column has no 'rejected' value.
      expect(workflowUpdate?.sql).toContain("status='cancelled'");
      expect(workflowUpdate?.params).toEqual(['request-1']);
    },
  );

  it('does not touch conversation_workflows for a non-terminal transition (accepted)',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update'))return{rows:[{status:'ready'}]};return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(queries.some(sql=>sql.includes('update app.conversation_workflows'))).toBe(false);
  });
});
