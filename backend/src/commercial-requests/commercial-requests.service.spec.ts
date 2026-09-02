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
});
