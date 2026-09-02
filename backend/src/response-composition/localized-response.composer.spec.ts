import { LocalizedResponseComposer } from './localized-response.composer';

describe('LocalizedResponseComposer',()=>{
  const composer=new LocalizedResponseComposer();

  it('renders a typed template with locale fallback and interpolation',()=>{
    expect(composer.compose({kind:'localized_template',template:{namespace:'commercial',key:'confirmed'},values:{reference:'ABC123'}},'es-CO'))
      .toMatchObject({locale:'es-CO',composition:'template',body:expect.stringContaining('ABC123')});
    expect(composer.compose({kind:'localized_template',template:{namespace:'appointment',key:'yesNo'}},'fr-FR').body)
      .toBe('Please answer yes or no.');
  });

  it('uses the complete composed body as the interactive body',()=>{
    const response=composer.compose({kind:'verified_content',body:'Cart summary and recommendation',interactive:{type:'buttons',body:'old body',options:[{id:'accept',title:'Yes'},{id:'reject',title:'No'}]}},'en');
    expect(response.interactive?.body).toBe(response.body);
  });

  it('composes localized and verified segments without losing domain facts',()=>{
    const response=composer.compose({kind:'composite',segments:[
      {kind:'template',template:{namespace:'commercial',key:'cartHeading'}},
      {kind:'line_break'},
      {kind:'verified_text',text:'• 2 × Product: $10'},
    ]},'en-US');
    expect(response).toMatchObject({composition:'composite',body:'Your order:\n• 2 × Product: $10'});
  });

  it('rejects responses that exceed WhatsApp limits',()=>{
    expect(()=>composer.compose({kind:'verified_content',body:'x'.repeat(4097)},'en')).toThrow('4096');
    expect(()=>composer.compose({kind:'verified_content',body:'x'.repeat(1025),interactive:{type:'buttons',body:'ignored',options:[{id:'ok',title:'OK'}]}},'en')).toThrow('1024');
  });
});
