import { ConversationDecisionEngine } from './conversation-decision.engine';

describe('ConversationDecisionEngine',()=>{
  const input={body:'hello',understanding:{requestedAction:null,confidence:0.9}} as never;
  const bot={} as never;
  const client=(capabilities=['appointments','orders'])=>({
    query:jest.fn().mockResolvedValue({rows:capabilities.map(capability=>({capability}))}),
  });

  it('gives appointment decisions priority over commerce',async()=>{
    const appointment={intent:'appointment',body:'date?',handoff:false,sources:['availability'],responsePlan:{kind:'localized_template',template:{namespace:'appointment',key:'requestNewDate'}}};
    const appointments={resolve:jest.fn().mockResolvedValue(appointment)};
    const commerce={resolve:jest.fn()};
    const knowledge={resolve:jest.fn()};
    const result=await new ConversationDecisionEngine(appointments as never,commerce as never,knowledge as never).decide(client() as never,input,bot);
    expect(result).toMatchObject({capability:'appointment',outcome:'respond',reason:'appointment_flow_matched',responsePlan:{kind:'localized_template'}});
    expect(commerce.resolve).not.toHaveBeenCalled();
  });

  it('uses commerce before general knowledge',async()=>{
    const appointments={resolve:jest.fn().mockResolvedValue(null)};
    const commerce={resolve:jest.fn().mockResolvedValue({intent:'order',body:'cart',handoff:false,sources:['request'],responsePlan:{kind:'localized_template',template:{namespace:'commercial',key:'moreItems'}}})};
    const knowledge={resolve:jest.fn()};
    const result=await new ConversationDecisionEngine(appointments as never,commerce as never,knowledge as never).decide(client() as never,input,bot);
    expect(result.capability).toBe('commerce');
    expect(knowledge.resolve).not.toHaveBeenCalled();
  });

  it('returns a structured handoff decision',async()=>{
    const appointments={resolve:jest.fn().mockResolvedValue(null)};
    const commerce={resolve:jest.fn().mockResolvedValue(null)};
    const knowledge={resolve:jest.fn().mockResolvedValue({intent:'handoff',body:'A person will help.',handoff:true,sources:[]})};
    const result=await new ConversationDecisionEngine(appointments as never,commerce as never,knowledge as never).decide(client() as never,input,bot);
    expect(result).toMatchObject({capability:'knowledge',outcome:'handoff',intent:'handoff'});
  });

  it('rejects domain responses that bypass structured composition',async()=>{
    const appointments={resolve:jest.fn().mockResolvedValue({intent:'appointment',body:'date?',handoff:false,sources:[]})};
    const engine=new ConversationDecisionEngine(appointments as never,{resolve:jest.fn()} as never,{resolve:jest.fn()} as never);
    await expect(engine.decide(client() as never,input,bot)).rejects.toThrow('appointment capability returned a response without a structured plan');
  });

  it('does not execute capabilities disabled for the tenant',async()=>{
    const appointments={resolve:jest.fn()};
    const commerce={resolve:jest.fn()};
    const knowledge={resolve:jest.fn().mockResolvedValue({intent:'fallback',body:'Help',handoff:false,sources:[]})};
    const result=await new ConversationDecisionEngine(appointments as never,commerce as never,knowledge as never)
      .decide(client(['commercial_offerings']) as never,input,bot);
    expect(result.capability).toBe('knowledge');
    expect(result.reason).toBe('no_domain_capability_matched');
    expect(appointments.resolve).not.toHaveBeenCalled();
    expect(commerce.resolve).not.toHaveBeenCalled();
  });

  it('reports a "fallback" intent as matched, not unresolved, when a knowledge entry actually answered it (D-078 regression)',async()=>{
    // classifyMessage's fixed intents no longer cover every FAQ topic
    // (D-078) — a message can be tagged 'fallback' and still be answered
    // via a tenant's own knowledge_entries. The reason label (persisted for
    // observability, and previously also gated unresolved-question logging
    // in message-received.consumer.ts) must reflect that it WAS answered.
    const appointments={resolve:jest.fn().mockResolvedValue(null)};
    const commerce={resolve:jest.fn().mockResolvedValue(null)};
    const knowledge={resolve:jest.fn().mockResolvedValue({intent:'fallback',body:'Answer',handoff:false,sources:['knowledge_entry:1']})};
    const result=await new ConversationDecisionEngine(appointments as never,commerce as never,knowledge as never)
      .decide(client() as never,input,bot);
    expect(result.reason).toBe('knowledge_intent_matched');
  });
});
