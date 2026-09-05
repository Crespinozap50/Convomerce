import { AppointmentFlowService } from './appointment-flow.service';
import { DeterministicUnderstandingProvider } from '../conversation-understanding/deterministic-understanding.provider';

describe('AppointmentFlowService',()=>{
  const understand=(message:string,interactiveSelectionId?:string)=>new DeterministicUnderstandingProvider().understand({message,configuredLocale:'es',handoffKeywords:[],timezone:'America/Bogota',interactiveSelectionId});
  it('routes any bookable offering to an appointment instead of an order',async()=>{
    const slot={resource_id:'0194f006-0000-7000-8000-000000000031',resource_name:'Valentina Ruiz',starts_at:'2026-08-07T14:00:00.000Z',ends_at:'2026-08-07T15:15:00.000Z',timezone:'America/Bogota'};
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{item_id:'0194f005-0000-7000-8000-000000000032',variant_id:'0194f005-1000-7000-8000-000000000032',name:'Corte y barba',variant_name:'Servicio completo',price_minor:'5200000',currency:'COP',duration_minutes:75}]})
      .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[slot]}).mockResolvedValueOnce({rows:[]})};

    const reply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(client as never,{
      tenantId:'0194f000-0000-7000-8000-000000000003',conversationId:'0194f003-0000-7000-8000-000000000003',contactId:'0194f002-0000-7000-8000-000000000003',body:'Quiero corte y barba',locale:'es',displayName:'Carlos',
      understanding:await understand('Quiero corte y barba'),
    });

    expect(reply).toEqual(expect.objectContaining({intent:'appointment',sources:['appointment_availability'],responsePlan:expect.objectContaining({kind:'localized_template'})}));
    expect(reply?.body).toContain('¿Para qué día quieres reservar?');
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("'reservation','draft'"))).toBe(true);
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("'appointment',$6"))).toBe(true);
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("'order','draft'"))).toBe(false);
  });

  it('defers to the knowledge capability for a menu-pagination tap instead of matching it against an active appointment step (D-115, same class of bug found live on the order-flow side for D-115)',async()=>{
    // deterministic-reply.service.ts's "Siguiente"/"Anterior" rows
    // (D-114, id "menu:<category>:page:<n>") have no meaning to this file —
    // returns null before even checking for an active workflow, so a
    // customer mid-booking who taps a menu pagination row still gets the
    // pagination reply, not this file's own step matching misfiring on it.
    const client={query:jest.fn()};
    const reply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(client as never,{
      tenantId:'0194f000-0000-7000-8000-000000000003',conversationId:'0194f003-0000-7000-8000-000000000003',contactId:'0194f002-0000-7000-8000-000000000003',body:'Siguiente',locale:'es',displayName:'Carlos',
      interactiveSelectionId:'menu:Tacos:page:2',
      understanding:await understand('Siguiente','menu:Tacos:page:2'),
    });
    expect(reply).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('does not match an unrelated service through a shared preposition like "para" (regression)',async()=>{
    // "Quiero una manicura para mañana" has no real keyword overlap with any
    // catalog item, but before itemStopWords included "para", the word
    // "para" (from "para dos") alone scored a false-positive match against
    // "Experiencia de relajación para dos" and silently started booking it.
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{item_id:'0194f005-0000-7000-8000-000000000044',variant_id:'0194f005-1000-7000-8000-000000000044',name:'Experiencia de relajación para dos',variant_name:'Servicio estándar',price_minor:'18000000',currency:'COP',duration_minutes:90}]})};

    const reply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(client as never,{
      tenantId:'0194f000-0000-7000-8000-000000000004',conversationId:'0194f003-0000-7000-8000-000000000004',contactId:'0194f002-0000-7000-8000-000000000004',body:'Quiero una manicura para mañana',locale:'es',displayName:'Carlos',
      understanding:await understand('Quiero una manicura para mañana'),
    });

    expect(reply).toBeNull();
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("'reservation','draft'"))).toBe(false);
  });

  it('cancels an upcoming confirmed appointment from the chat and releases its slot',async()=>{
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:'0194f007-0000-7000-8000-000000000001',commercial_request_id:'0194f008-0000-7000-8000-000000000001',starts_at:'2026-08-07T18:00:00.000Z',timezone:'America/Bogota',item_name:'Corte y barba',resource_name:'Juan'}]})
      .mockResolvedValue({rows:[]})};

    const reply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(client as never,{
      tenantId:'0194f000-0000-7000-8000-000000000003',conversationId:'0194f003-0000-7000-8000-000000000003',contactId:'0194f002-0000-7000-8000-000000000003',body:'Cancela mi cita',locale:'es',displayName:'Carlos',
      understanding:await understand('Cancela mi cita'),
    });

    expect(reply?.body).toContain('cancelé Corte y barba');
    expect(reply?.body).toContain('disponible nuevamente');
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("transition_appointment($1,'cancel'"))).toBe(true);
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("'appointment.cancelled'"))).toBe(true);
  });

  it('asks for a professional after the date and filters slots by the selected resource',async()=>{
    const resources=[{id:'0194f006-0000-7000-8000-000000000031',name:'Juan'},{id:'0194f006-0000-7000-8000-000000000032',name:'Valentina'}];
    const dateClient={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_date',context:{catalogItemId:'0194f005-0000-7000-8000-000000000032',itemName:'Corte y barba'}}]})
      .mockResolvedValueOnce({rows:resources})
      .mockResolvedValue({rows:[]})};
    const dateReply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(dateClient as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'mañana',locale:'es',displayName:'Carlos',
      understanding:await understand('mañana'),
    });
    // D-046: resource selection is a tappable WhatsApp list, not enumerated
    // text — the options live on responsePlan.interactive, not the body.
    expect(dateReply?.responsePlan).toEqual(expect.objectContaining({
      kind:'composite',
      interactive:expect.objectContaining({
        type:'list',
        options:[
          expect.objectContaining({id:'1',title:'Cualquiera disponible'}),
          expect.objectContaining({id:'2',title:'Juan'}),
          expect.objectContaining({id:'3',title:'Valentina'}),
        ],
      }),
    }));

    const slot={resource_id:resources[1].id,resource_name:'Valentina',starts_at:'2026-08-07T14:00:00.000Z',ends_at:'2026-08-07T15:15:00.000Z',timezone:'America/Bogota'};
    const slotClient={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_resource',context:{catalogItemId:'0194f005-0000-7000-8000-000000000032',itemName:'Corte y barba',requestedDate:'2026-08-07',resources}}]})
      .mockResolvedValueOnce({rows:[slot]})
      .mockResolvedValue({rows:[]})};
    const slotReply=await new AppointmentFlowService({ getPendingRequirements: jest.fn().mockResolvedValue([]) } as never).resolve(slotClient as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'3',locale:'es',displayName:'Carlos',
      understanding:await understand('3'),
    });
    // D-046: slot selection is a tappable WhatsApp list too — the resource
    // name lives in the row's description, not the plain-text body.
    expect(slotReply?.responsePlan).toEqual(expect.objectContaining({
      kind:'composite',
      interactive:expect.objectContaining({
        type:'list',
        options:[expect.objectContaining({id:'1',description:'Valentina'})],
      }),
    }));
    expect(slotClient.query.mock.calls[1][0]).toContain('slot.timezone');
    expect(slotClient.query.mock.calls[1][1][2]).toBe(resources[1].id);
  });

  it('confirms the hold directly when no operational requirement is pending (regression)',async()=>{
    const slot={resource_id:'0194f006-0000-7000-8000-000000000031',resource_name:'Valentina',starts_at:'2026-08-07T14:00:00.000Z',ends_at:'2026-08-07T15:15:00.000Z',timezone:'America/Bogota'};
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_slot',context:{catalogItemId:'0194f005-0000-7000-8000-000000000032',itemName:'Corte y barba',slots:[slot]}}]})
      .mockResolvedValueOnce({rows:[{id:'0194f007-0000-7000-8000-000000000009'}]})
      .mockResolvedValue({rows:[]})};

    const reply=await new AppointmentFlowService({getPendingRequirements:jest.fn().mockResolvedValue([])} as never).resolve(client as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'1',locale:'es',displayName:'Carlos',
      understanding:await understand('1'),
    });

    expect(reply?.body).toContain('Valentina');
    expect(reply?.responsePlan).toEqual(expect.objectContaining({
      kind:'localized_template',
      template:{namespace:'appointment',key:'confirmHold'},
      // D-046: the confirmation question ships as tappable WhatsApp
      // buttons, not just text asking the customer to type sí/no.
      interactive:expect.objectContaining({
        type:'buttons',
        options:[
          expect.objectContaining({id:'confirm:yes',title:'Sí'}),
          expect.objectContaining({id:'confirm:no',title:'No'}),
        ],
      }),
    }));
    expect(
      client.query.mock.calls.some(([sql,params])=>String(sql).includes('update app.conversation_workflows')&&(params as unknown[])?.[1]==='awaiting_confirmation'),
    ).toBe(true);
  });

  it('confirms the appointment when the customer taps the "Sí" button instead of typing (D-046)',async()=>{
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_confirmation',context:{appointmentId:'0194f007-0000-7000-8000-000000000009'}}]})
      .mockResolvedValueOnce({rows:[{event_type:'appointment.confirmed'}]})
      .mockResolvedValue({rows:[]})};

    const reply=await new AppointmentFlowService({getPendingRequirements:jest.fn().mockResolvedValue([])} as never).resolve(client as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'Sí',locale:'es',displayName:'Carlos',
      understanding:await understand('Sí','confirm:yes'),
    });

    expect(reply?.body).toContain('Cita confirmada');
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes("transition_appointment($1,'confirm'"))).toBe(true);
  });

  it('asks for a configured requirement instead of confirming when one is pending',async()=>{
    const slot={resource_id:'0194f006-0000-7000-8000-000000000031',resource_name:'Valentina',starts_at:'2026-08-07T14:00:00.000Z',ends_at:'2026-08-07T15:15:00.000Z',timezone:'America/Bogota'};
    const vehicleRequirement={
      id:'req-vehicle',fieldKey:'vehicle_type',dataType:'select' as const,isRequired:true,displayOrder:0,
      validationRule:{},sensitivity:'none' as const,requiresConfirmation:false,reuseFromContactMemory:false,
      label:'¿Qué tipo de vehículo tienes?',helpText:null,
      options:[{value:'car',label:'Carro'},{value:'motorcycle',label:'Moto'}],
    };
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_slot',context:{catalogItemId:'0194f005-0000-7000-8000-000000000032',itemName:'Corte y barba',slots:[slot]}}]})
      .mockResolvedValueOnce({rows:[{id:'0194f007-0000-7000-8000-000000000009'}]})
      .mockResolvedValue({rows:[]})};

    const reply=await new AppointmentFlowService({getPendingRequirements:jest.fn().mockResolvedValue([vehicleRequirement])} as never).resolve(client as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'1',locale:'es',displayName:'Carlos',
      understanding:await understand('1'),
    });

    // D-046 phase 2: a select requirement with <=3 options ships as
    // tappable WhatsApp buttons, not enumerated text.
    expect(reply?.body).toBe('¿Qué tipo de vehículo tienes?');
    expect(reply?.responsePlan).toEqual(expect.objectContaining({
      kind:'verified_content',
      body:reply?.body,
      interactive:expect.objectContaining({
        type:'buttons',
        options:[
          expect.objectContaining({id:'1',title:'Carro'}),
          expect.objectContaining({id:'2',title:'Moto'}),
        ],
      }),
    }));
    expect(
      client.query.mock.calls.some(([sql,params])=>String(sql).includes('update app.conversation_workflows')&&(params as unknown[])?.[1]==='awaiting_requirement:vehicle_type'),
    ).toBe(true);
  });

  it('fills two custom requirements from one message right after holding the slot (D-040)',async()=>{
    const slot={resource_id:'0194f006-0000-7000-8000-000000000031',resource_name:'Valentina',starts_at:'2026-08-07T14:00:00.000Z',ends_at:'2026-08-07T15:15:00.000Z',timezone:'America/Bogota'};
    const vehicleRequirement={
      id:'req-vehicle',fieldKey:'vehicle_type',dataType:'select' as const,isRequired:true,displayOrder:0,
      validationRule:{},sensitivity:'none' as const,requiresConfirmation:false,reuseFromContactMemory:false,
      label:'¿Qué tipo de vehículo tienes?',helpText:null,
      options:[{value:'car',label:'Carro'},{value:'truck',label:'Camioneta'}],
    };
    const waxRequirement={
      id:'req-wax',fieldKey:'wants_wax',dataType:'boolean' as const,isRequired:true,displayOrder:10,
      validationRule:{},sensitivity:'none' as const,requiresConfirmation:false,reuseFromContactMemory:false,
      label:'¿Deseas encerado?',helpText:null,options:[],
    };
    const allRequirements=[vehicleRequirement,waxRequirement];
    const getPendingRequirements=jest.fn(
      (_c:unknown,_t:string,_op:string,_ft:string|null,alreadyFilled:string[])=>
        Promise.resolve(allRequirements.filter(r=>!alreadyFilled.includes(r.fieldKey))),
    );
    const client={query:jest.fn()
      .mockResolvedValueOnce({rows:[{id:'workflow-1',commercial_request_id:'request-1',step:'awaiting_slot',context:{catalogItemId:'0194f005-0000-7000-8000-000000000032',itemName:'Corte y barba',slots:[slot]}}]})
      .mockResolvedValueOnce({rows:[{id:'0194f007-0000-7000-8000-000000000009'}]})
      .mockResolvedValue({rows:[]})};

    const reply=await new AppointmentFlowService({getPendingRequirements} as never).resolve(client as never,{
      tenantId:'tenant-1',conversationId:'conversation-1',contactId:'contact-1',body:'1 camioneta sin cera',locale:'es',displayName:'Carlos',
      understanding:{
        locale:'es',localeSource:'tenant_default',intent:'appointment',confidence:1,
        entities:{selectionIndex:1,response:'negative'},
        requestedAction:null,missingInformation:[],requiresHuman:false,
        provider:'deterministic',providerVersion:'test',
      } as never,
    });

    // Both custom fields resolved from one message; no more questions, the
    // flow goes straight to the confirmHold prompt.
    expect(reply?.body).toContain('Valentina');
    expect(
      client.query.mock.calls.some(([sql,params])=>String(sql).includes('update app.conversation_workflows')&&(params as unknown[])?.[1]==='awaiting_confirmation'),
    ).toBe(true);
  });
});
