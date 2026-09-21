import { CommercialRequestsService } from './commercial-requests.service';

describe('CommercialRequestsService',()=>{
  it('lists tenant-scoped requests for viewers without management permission',async()=>{
    const client={query:jest.fn(async(sql:string)=>{
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'viewer'}]};
      if(sql.includes('count(*)::integer count'))return{rows:[{count:1}]};
      return{rows:[{id:'request-1',request_type:'order',status:'ready',currency:'COP',subtotal_minor:'2500000',total_minor:'2500000',display_name:'Customer',line_count:2}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).list('tenant-1','user-1');
    expect(result.canManage).toBe(false);
    expect(result.newCount).toBe(1);
    expect(result.requests[0]).toMatchObject({id:'request-1',type:'order',totalMinor:2500000,lineCount:2});
  });

  it('nests each line\'s modifiers so a paid addition is visible, not just folded into the total (live finding, Santiago, Santos Tacos)',async()=>{
    // Found live: "Guacamole" (+$3.000) never appeared in this panel at
    // all — detail() only ever queried app.request_lines, never joined
    // app.request_line_modifiers, even though the addition is correctly
    // priced into the request's own total_minor.
    const client={query:jest.fn(async(sql:string)=>{
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
      if(sql.includes('from app.commercial_requests request'))return{rows:[{id:'request-1',request_type:'order',status:'ready',currency:'COP',subtotal_minor:'1250000',total_minor:'1250000',display_name:'Santiago'}]};
      if(sql.includes('from app.request_lines'))return{rows:[{id:'line-1',description_snapshot:'Dorado de Pollo (Unidad)',unit_price_minor_snapshot:'950000',currency:'COP',quantity:'1',line_total_minor:'950000',attributes_snapshot:null,status:'active'}]};
      if(sql.includes('from app.request_line_modifiers'))return{rows:[{request_line_id:'line-1',description_snapshot:'Guacamole',unit_price_delta_minor_snapshot:'300000',quantity:'1',total_delta_minor:'300000'}]};
      return{rows:[]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).detail('tenant-1','user-1','request-1');
    expect(result.lines[0].modifiers).toEqual([{description:'Guacamole',unitPriceDeltaMinor:300000,quantity:1,totalDeltaMinor:300000}]);
  });

  it('stores the current user read position when opening the inbox',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);return sql.includes('from app.tenant_users')?{rows:[{role:'operator'}]}:{rows:[]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).markSeen('tenant-1','user-1');
    expect(queries.some(sql=>sql.includes('insert into app.commercial_request_reads'))).toBe(true);
  });

  it('accepts a ready request using a locked transition',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update'))return{rows:[{status:'ready'}]};return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(result.request.status).toBe('accepted');
    expect(queries.some(sql=>sql.includes('for update'))).toBe(true);
  });

  it('rejects an invalid lifecycle transition',async()=>{
    const client={query:jest.fn(async(sql:string)=>sql.includes('from app.tenant_users')?{rows:[{role:'operator'}]}:{rows:[{status:'completed'}]})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await expect(new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted')).rejects.toThrow('Cannot move commercial request from completed to accepted');
  });

  // D-202 (docs/decisions.md): once an order reaches 'accepted' it was
  // already pushed to Loggro/the kitchen — the project owner confirmed
  // there's no real cancel from there, only a direct call outside the app.
  it.each(['accepted' as const,'in_progress' as const])(
    'rejects cancelling an order already %s — already sent to the POS/kitchen',
    async(status)=>{
      const client={query:jest.fn(async(sql:string)=>sql.includes('from app.tenant_users')?{rows:[{role:'operator'}]}:{rows:[{status,request_type:'order'}]})};
      const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
      await expect(new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','cancelled'))
        .rejects.toMatchObject({response:{code:'ORDER_ALREADY_IN_PREPARATION'}});
    },
  );

  it('still allows cancelling a reservation/appointment already accepted — no POS/kitchen step involved',async()=>{
    const client={query:jest.fn(async(sql:string)=>{if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update of request'))return{rows:[{status:'accepted',request_type:'reservation',appointment_id:null,appointment_status:null}]};return{rows:[{id:'request-1',request_type:'reservation',status:'cancelled',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','cancelled');
    expect(result.request.status).toBe('cancelled');
  });

  it('cancels the linked appointment when an administrator cancels a reservation',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update of request'))return{rows:[{status:'accepted',request_type:'reservation',appointment_id:'appointment-1',appointment_status:'confirmed'}]};return{rows:[{id:'request-1',request_type:'reservation',status:'cancelled',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    const result=await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','cancelled');
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
      await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1',status);
      const workflowUpdate=queries.find(({sql})=>sql.includes('update app.conversation_workflows'));
      expect(workflowUpdate).toBeDefined();
      // Always 'cancelled', even for a 'rejected' request — the workflow's
      // own status column has no 'rejected' value.
      expect(workflowUpdate?.sql).toContain("status='cancelled'");
      expect(workflowUpdate?.params).toEqual(['request-1']);
    },
  );

  it('notifies the customer over WhatsApp when an order is accepted (live finding: "Aceptar pedido" never told the customer anything)',async()=>{
    const queries:{sql:string;params:unknown[]}[]=[];
    const client={query:jest.fn(async(sql:string,params:unknown[]=[])=>{
      queries.push({sql,params});
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
      if(sql.includes('for update'))return{rows:[{status:'ready',request_type:'order'}]};
      if(sql.includes('from app.commercial_requests request') && sql.includes('conv.channel_id'))
        return{rows:[{conversation_id:'conv-1',channel_id:'channel-1',locale:'es'}]};
      return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    const messageInsert=queries.find(q=>q.sql.includes('insert into app.messages'));
    expect(messageInsert?.params).toEqual(expect.arrayContaining(['conv-1','channel-1']));
    expect(JSON.stringify(messageInsert?.params)).toContain('está en preparación');
    expect(queries.some(q=>q.sql.includes("insert into app.outbox_events") && q.sql.includes("'message.send_requested'"))).toBe(true);
  });

  it('pushes to Loggro when an order is accepted and loggro_pos is enabled (D-191: moved from WhatsApp confirmation to admin acceptance)',async()=>{
    const queries:{sql:string;params:unknown[]}[]=[];
    const client={query:jest.fn(async(sql:string,params:unknown[]=[])=>{
      queries.push({sql,params});
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
      if(sql.includes('for update'))return{rows:[{status:'ready',request_type:'order'}]};
      if(sql.includes("capability='loggro_pos'"))return{rows:[{enabled:true}]};
      if(sql.includes('from app.commercial_requests request') && sql.includes('conv.channel_id'))
        return{rows:[{conversation_id:'conv-1',channel_id:'channel-1',locale:'es'}]};
      return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    const outboxInsert=queries.find(q=>q.sql.includes('insert into app.outbox_events') && q.sql.includes("'order.confirmed'"));
    expect(outboxInsert).toBeDefined();
    expect(outboxInsert?.params[2]).toBe('request-1');
    expect(queries.some(q=>q.sql.includes("pos_sync_status='pending'"))).toBe(true);
  });

  it('never pushes to Loggro when loggro_pos is disabled (the default for every tenant but Santos Tacos)',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{
      queries.push(sql);
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
      if(sql.includes('for update'))return{rows:[{status:'ready',request_type:'order'}]};
      if(sql.includes("capability='loggro_pos'"))return{rows:[{enabled:false}]};
      return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(queries.some(sql=>sql.includes("insert into app.outbox_events") && sql.includes("'order.confirmed'"))).toBe(false);
    expect(queries.some(sql=>sql.includes("pos_sync_status='pending'"))).toBe(false);
  });

  it('never notifies for a reservation/appointment accepted (order-only copy)',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{
      queries.push(sql);
      if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};
      if(sql.includes('for update'))return{rows:[{status:'ready',request_type:'reservation'}]};
      return{rows:[{id:'request-1',request_type:'reservation',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]};
    })};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(queries.some(sql=>sql.includes('insert into app.messages'))).toBe(false);
    expect(queries.some(sql=>sql.includes("insert into app.outbox_events") && sql.includes("'order.confirmed'"))).toBe(false);
    expect(queries.some(sql=>sql.includes("pos_sync_status='pending'"))).toBe(false);
  });

  it('does not touch conversation_workflows for a non-terminal transition (accepted)',async()=>{
    const queries:string[]=[];
    const client={query:jest.fn(async(sql:string)=>{queries.push(sql);if(sql.includes('from app.tenant_users'))return{rows:[{role:'operator'}]};if(sql.includes('for update'))return{rows:[{status:'ready'}]};return{rows:[{id:'request-1',request_type:'order',status:'accepted',currency:'COP',subtotal_minor:'0',total_minor:'0'}]}})};
    const db={withTenantTransaction:(_tenant:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
    await new CommercialRequestsService(db,{cancelOrder:jest.fn()} as never).changeStatus('tenant-1','user-1','request-1','accepted');
    expect(queries.some(sql=>sql.includes('update app.conversation_workflows'))).toBe(false);
  });

  describe('cancelSentOrder (D-202 reversed)',()=>{
    const build=(role:string,row:{status:string;request_type:string;pos_external_order_id:string[]|null}|null,orderSync:{cancelOrder:jest.Mock})=>{
      const queries:{sql:string;params?:unknown[]}[]=[];
      const client={query:jest.fn(async(sql:string,params?:unknown[])=>{
        queries.push({sql,params});
        if(sql.includes('from app.tenant_users'))return{rows:[{role}]};
        if(sql.includes('select status,request_type,pos_external_order_id'))return{rows:row?[row]:[]};
        if(sql.includes("set status='cancelled',cancellation_note"))return{rows:[{id:'request-1',request_type:'order',status:'cancelled',currency:'COP',cancellation_note:params?.[1]}]};
        if(sql.includes('from app.commercial_requests request'))return{rows:[{conversation_id:'c1',channel_id:'ch1',locale:'es'}]};
        return{rows:[]};
      })};
      const db={withTenantTransaction:(_t:string,operation:(client:unknown)=>unknown)=>operation(client)} as never;
      return{service:new CommercialRequestsService(db,orderSync as never),queries};
    };
    const sent={status:'accepted',request_type:'order',pos_external_order_id:['o1','o2']};

    it('cancels in Loggro first, then records the note and tells the customer (without the internal note)',async()=>{
      const orderSync={cancelOrder:jest.fn().mockResolvedValue({cancelled:['o1','o2'],alreadyCancelled:[]})};
      const {service,queries}=build('admin',sent,orderSync);
      const result=await service.cancelSentOrder('tenant-1','user-1','request-1','Cliente pidió cancelar');
      expect(orderSync.cancelOrder).toHaveBeenCalledWith('tenant-1','request-1','Cliente pidió cancelar');
      expect(result.request.status).toBe('cancelled');
      const message=queries.find(q=>q.sql.includes('insert into app.messages'));
      expect(message).toBeDefined();
      expect(String(message?.params?.[4])).toContain('cancelado por el negocio');
      expect(String(message?.params?.[4])).not.toContain('Cliente pidió cancelar');
    });

    it('lets only administrators do it',async()=>{
      const orderSync={cancelOrder:jest.fn()};
      await expect(build('operator',sent,orderSync).service.cancelSentOrder('tenant-1','user-1','request-1','nota valida')).rejects.toMatchObject({status:403});
      expect(orderSync.cancelOrder).not.toHaveBeenCalled();
    });

    it('changes nothing and tells nobody when Loggro refuses',async()=>{
      const orderSync={cancelOrder:jest.fn().mockRejectedValue(new Error('not on a Bot table'))};
      const {service,queries}=build('owner',sent,orderSync);
      await expect(service.cancelSentOrder('tenant-1','user-1','request-1','nota valida')).rejects.toThrow('not on a Bot table');
      expect(queries.some(q=>q.sql.includes("set status='cancelled'"))).toBe(false);
      expect(queries.some(q=>q.sql.includes('insert into app.messages'))).toBe(false);
    });

    it('rejects orders that are not accepted/in preparation',async()=>{
      const orderSync={cancelOrder:jest.fn()};
      await expect(build('admin',{...sent,status:'ready'},orderSync).service.cancelSentOrder('tenant-1','user-1','request-1','nota valida')).rejects.toMatchObject({status:400});
      expect(orderSync.cancelOrder).not.toHaveBeenCalled();
    });

    it('skips Loggro when the order never reached it, but still cancels here',async()=>{
      const orderSync={cancelOrder:jest.fn()};
      const result=await build('admin',{...sent,pos_external_order_id:null},orderSync).service.cancelSentOrder('tenant-1','user-1','request-1','nota valida');
      expect(orderSync.cancelOrder).not.toHaveBeenCalled();
      expect(result.request.status).toBe('cancelled');
    });
  });
});
