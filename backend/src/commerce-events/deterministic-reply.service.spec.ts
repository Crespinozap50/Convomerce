import { classifyMessage, DeterministicReplyService } from './deterministic-reply.service';

describe('DeterministicReplyService', () => {
  it.each([
    ['Hola, buenas tardes', 'greeting'],
    ['¿Qué tacos tienen?', 'menu'],
    ['¿Qué servicios tienen?', 'menu'],
    ['¿Qué ofrecen?', 'menu'],
    ['What services do you offer?', 'menu'],
    ['Hola, ¿qué tacos tienen?', 'menu'],
    ['¿Cuánto cuesta la birria?', 'price'],
    ['¿Cuando cuesta la birria?', 'price'],
    ['¿A qué hora cierran?', 'hours'],
    ['¿Dónde están ubicados?', 'location'],
    ['¿Hacen domicilios en Robledo?', 'delivery'],
    ['¿Puedo pagar con tarjeta?', 'payments'],
    ['Quiero hablar con un humano', 'handoff'],
  ])('classifies “%s” as %s', (message, expected) => {
    expect(classifyMessage(message, ['humano'])).toBe(expected);
  });

  it.each([
    '¿Tienen algo vegetariano?',
    '¿Los tacos pican?',
    'Tengo alergia al gluten',
  ])('no longer intercepts "%s" as a fixed vertical-specific intent (D-078)', (message) => {
    // allergens/vegetarian/spicy/pickup/preparation_time used to be fixed,
    // globally-shared restaurant-shaped intents here. They're retired as
    // *classifications* — these messages now fall through to 'fallback',
    // which knowledgeReply() still answers from each tenant's own published
    // knowledge_entries (title or per-entry keywords), never from shared,
    // hardcoded, cross-tenant vocabulary.
    expect(classifyMessage(message, [])).toBe('fallback');
  });

  it('builds a COP menu from active database offerings (more than 10 items, no tappable list to fall back on)', async () => {
    // 11 rows exceeds WhatsApp's 10-row list limit, so no interactive list
    // is attached and the full text listing (with money formatting) is the
    // only way the customer sees the offering — see the "does not repeat"
    // test below for the ≤10-items case, where the list carries this info
    // instead and the body is just the heading.
    const filler = Array.from({ length: 10 }, (_, index) => ({
      item_id: `filler-${index}`, name: `Relleno ${index}`, category: 'Otros',
      variant_name: 'Unidad', price_minor: '100000', currency: 'COP',
    }));
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rowCount: 11,
          rows: [
            { item_id: 'item-1', name: 'Tacos de birria', category: 'Tacos', variant_name: 'Orden de 3 tacos con consomé', price_minor: '2290000', currency: 'COP' },
            ...filler,
          ],
        }),
    };
    const service = new DeterministicReplyService();
    const reply = await service.resolve(client as never, 'muéstrame el menú', {
      locale: 'es',
      welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.intent).toBe('menu');
    expect(reply.interactive).toBeUndefined();
    expect(reply.body).toContain('Tacos de birria');
    expect(reply.body).toContain('$ 22.900');
    expect(reply.sources).toContain('catalog_item:item-1');
  });

  it('attaches a tappable list of the menu items alongside the text', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rowCount: 2,
          rows: [
            { item_id: 'item-1', variant_id: 'variant-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Orden de 3 tacos', price_minor: '1890000', currency: 'COP' },
            { item_id: 'item-2', variant_id: 'variant-2', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso de 12 oz', price_minor: '700000', currency: 'COP' },
          ],
        }),
    };
    const reply = await new DeterministicReplyService().resolve(client as never, 'muéstrame el menú', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.interactive).toEqual({
      type: 'list',
      body: '',
      buttonLabel: 'Ver opciones',
      options: [
        { id: 'variant-1', title: 'Tacos al pastor', description: '$ 18.900' },
        { id: 'variant-2', title: 'Agua fresca', description: 'Vaso de 12 oz · $ 7.000' },
      ],
    });
  });

  it('does not repeat the tappable list items as text in the body (avoids duplication)', async () => {
    // The list itself already shows name, variant, and price per row —
    // repeating all of that as bullet lines in the body too is pure
    // duplication once WhatsApp renders both in the same message.
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rowCount: 2,
          rows: [
            { item_id: 'item-1', variant_id: 'variant-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Orden de 3 tacos', price_minor: '1890000', currency: 'COP' },
            { item_id: 'item-2', variant_id: 'variant-2', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso de 12 oz', price_minor: '700000', currency: 'COP' },
          ],
        }),
    };
    const reply = await new DeterministicReplyService().resolve(client as never, 'muéstrame el menú', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('Esta es nuestra oferta disponible:');
    expect(reply.interactive?.options).toHaveLength(2);
  });

  it('does not attach a list for a price question (a single filtered result)', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rowCount: 1, rows: [{ item_id: 'item-1', variant_id: 'variant-1', name: 'Tacos de birria', category: 'Tacos', variant_name: 'Orden', price_minor: '2290000', currency: 'COP' }] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿cuánto cuesta la birria?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.intent).toBe('price');
    expect(reply.interactive).toBeUndefined();
  });

  it('does not invent a price when the requested product is unknown', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rowCount: 1, rows: [{ item_id: 'item-1', name: 'Tacos de birria', category: 'Tacos', variant_name: 'Orden', price_minor: '2290000', currency: 'COP' }] }) };
    const service = new DeterministicReplyService();
    const reply = await service.resolve(client as never, '¿cuánto cuesta la hamburguesa?', {
      locale: 'es',
      welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toContain('¿De cuál producto');
    expect(reply.sources).toEqual([]);
  });

  it('returns only the best matching product instead of every item in a generic category', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rowCount: 2, rows: [
        { item_id: 'item-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Orden', price_minor: '1890000', currency: 'COP' },
        { item_id: 'item-2', name: 'Tacos de birria', category: 'Tacos', variant_name: 'Orden', price_minor: '2290000', currency: 'COP' },
      ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Cuánto cuestan los tacos de birria?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toContain('Tacos de birria');
    expect(reply.body).not.toContain('Tacos al pastor');
    expect(reply.sources).toEqual(['catalog_item:item-2']);
  });

  it('narrows a catalog question to the most specific matching offering', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rowCount: 3, rows: [
        { item_id: 'item-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Orden', price_minor: '1890000', currency: 'COP' },
        { item_id: 'item-2', name: 'Tacos de birria', category: 'Tacos', variant_name: 'Orden', price_minor: '2290000', currency: 'COP' },
        { item_id: 'item-3', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso', price_minor: '700000', currency: 'COP' },
      ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Qué tacos tienen de birria?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    // The filtered match narrows down to a single row, so it's shown via
    // the tappable list (not the body text, which is just the heading).
    expect(reply.interactive?.options).toEqual([
      expect.objectContaining({ title: 'Tacos de birria' }),
    ]);
  });

  it('returns the verified business address as the source of a location answer', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{ address: 'Calle 65 # 88-20, Robledo, Medellín' }] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Dónde quedan?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply).toEqual(expect.objectContaining({ intent: 'location', body: 'Calle 65 # 88-20, Robledo, Medellín', sources: ['business_profile'] }));
  });

  it('reads the business profile localization for the conversation language', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rows: [{ business_hours: 'Tuesday through Thursday from 5:00 p.m. to 10:00 p.m.' }],
        }),
    };
    const reply = await new DeterministicReplyService().resolve(
      client as never,
      'What are your opening hours?',
      {
        locale: 'en',
        welcomeMessage: 'Hello',
        fallbackMessage: 'Sorry',
        handoffKeywords: [], timezone: 'UTC',
      },
    );
    expect(reply.body).toContain('Tuesday through Thursday');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('business_profile_localizations'),
      ['en'],
    );
  });

  it('prefers an exact published FAQ over a general policy for the same intent', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'policy-1', title: 'Alergias y contaminación cruzada', content: 'La cocina manipula gluten.' },
      { id: 'faq-1', title: '¿Cuál taco no tiene gluten?', content: 'El taco de camarón es libre de gluten.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Cuál taco no tiene gluten?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('El taco de camarón es libre de gluten.');
    expect(reply.sources).toEqual(['knowledge_entry:faq-1']);
  });

  it('keeps the general policy as fallback when no specific FAQ matches', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'policy-1', title: 'Alergias y contaminación cruzada', content: 'La cocina manipula gluten y otros alérgenos.', keywords: ['alerg', 'gluten'] },
      { id: 'faq-1', title: '¿Cuál taco no tiene gluten?', content: 'El taco de camarón es libre de gluten.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, 'Tengo una alergia alimentaria', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('La cocina manipula gluten y otros alérgenos.');
    expect(reply.sources).toEqual(['knowledge_entry:policy-1']);
  });

  it('answers an exact cross-industry FAQ without a hardcoded intent', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'spa-faq-1', title: '¿Qué debo llevar?', content: 'Te recomendamos ropa cómoda.' },
      { id: 'spa-policy-1', title: 'Llegada a la cita', content: 'Llega 15 minutos antes.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Qué debo llevar?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('Te recomendamos ropa cómoda.');
    expect(reply.sources).toEqual(['knowledge_entry:spa-faq-1']);
  });

  it('finds a short, single-word FAQ title from a natural paraphrase, not just an exact match (regression)', async () => {
    // Bug found live testing a non-restaurant tenant (D-075): requiring 2+
    // shared words unconditionally made a one-word title ("Garantía")
    // practically unfindable — there was only ever one word to overlap
    // with. "¿Tienen garantía ficticia?" (echoing the title verbatim)
    // matched; "¿Cuál es la garantía?" (a real customer's phrasing) did not.
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'warranty-1', title: 'Garantía', content: 'Todos los equipos tienen 12 meses de garantía.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Cuál es la garantía?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('Todos los equipos tienen 12 meses de garantía.');
    expect(reply.sources).toEqual(['knowledge_entry:warranty-1']);
  });

  it('prefers a specific FAQ over the catalog listing when the question collides with a menu keyword (regression)', async () => {
    // "productos" is one of the keywords that classifies a message as the
    // 'menu' intent, so "¿Los productos vienen con garantía?" was showing
    // the catalog instead of this tenant's warranty FAQ. resolve() now
    // checks knowledge_entries for a specific title match before falling
    // back to the catalog/price listing for 'menu'/'price' intents.
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [
        { id: 'warranty-1', title: 'Garantía', content: 'Todos los equipos tienen 12 meses de garantía.' },
      ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Los productos vienen con garantía?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('Todos los equipos tienen 12 meses de garantía.');
    expect(reply.sources).toEqual(['knowledge_entry:warranty-1']);
    // Only the knowledge_entries pre-check should run — the catalog query
    // never happens once a specific match is found.
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('prefers a specific FAQ over the business profile when the question collides with an hours keyword (regression)', async () => {
    // Found live running the Fase 2 acceptance matrix: "atienden" is one of
    // the keywords that classifies a message as the 'hours' intent, so
    // "¿Atienden niños?" (a barbershop FAQ about kids' haircuts) showed the
    // opening-hours answer instead. Same fix as the menu/price case (D-077),
    // generalized to every fixed intent that can dispatch to something other
    // than knowledge_entries (menu, price, hours, location, delivery,
    // payments).
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [
        { id: 'kids-1', title: '¿Atienden niños?', content: 'Sí, ofrecemos corte infantil para niños de 4 a 12 años acompañados de un adulto.' },
      ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Atienden niños?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toBe('Sí, ofrecemos corte infantil para niños de 4 a 12 años acompañados de un adulto.');
    expect(reply.sources).toEqual(['knowledge_entry:kids-1']);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('still answers a genuine hours question with no matching FAQ from the business profile (regression)', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{ business_hours: 'Lunes a viernes de 9:00 a. m. a 7:00 p. m.' }] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿A qué hora abren?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply).toEqual(expect.objectContaining({
      intent: 'hours', body: 'Lunes a viernes de 9:00 a. m. a 7:00 p. m.', sources: ['business_profile'],
    }));
  });

  it('still shows the catalog for a genuine menu question with no matching FAQ (Santos Tacos regression)', async () => {
    // The safety requirement behind the fix above: a real "what products do
    // you have" question, with no specific knowledge entry to collide with,
    // must keep showing the catalog exactly as before.
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [
        { id: 'hours-1', title: 'Horario ficticio', content: 'Atención de demostración de 11:00 a 20:00.' },
      ] })
      .mockResolvedValue({ rowCount: 1, rows: [
        { item_id: 'item-1', variant_id: 'variant-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Orden de 3 tacos', price_minor: '1890000', currency: 'COP' },
      ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Qué productos tienen?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.intent).toBe('menu');
    expect(reply.sources).toEqual(['catalog_item:item-1']);
    expect(reply.interactive?.options).toEqual([
      expect.objectContaining({ title: 'Tacos al pastor' }),
    ]);
  });

  it('uses an entry\'s own keywords to find car-wash preparation guidance the title alone would miss', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { id: 'wash-faq-1', title: '¿Cuánto tarda el lavado?', content: 'Una camioneta toma entre 60 y 75 minutos.', keywords: ['demora', 'tarda', 'tiempo'] },
      { id: 'wash-policy-1', title: 'Objetos de valor', content: 'Retira objetos antes de entregar el vehículo.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(client as never, '¿Cuánto tarda una camioneta?', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    expect(reply.body).toContain('60 y 75 minutos');
    expect(reply.sources).toEqual(['knowledge_entry:wash-faq-1']);
  });

  it('uses English system copy when the bot locale is English', async () => {
    const client = { query: jest.fn() };
    const reply = await new DeterministicReplyService().resolve(client as never, 'I need a human', {
      locale: 'en', welcomeMessage: 'Hello', fallbackMessage: 'Sorry', handoffKeywords: ['human'], timezone: 'UTC',
    });
    expect(reply.body).toBe('Understood. A person will continue this conversation.');
  });

  it('greets a known customer by first name', async () => {
    const client = { query: jest.fn() };
    const reply = await new DeterministicReplyService().resolve(client as never, 'Hola', {
      locale: 'es', welcomeMessage: '¡Hola! Soy el asistente del negocio.', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC', customerName: 'Carlos Espinoza',
    });
    expect(reply.body).toBe('¡Hola, Carlos! Soy el asistente del negocio.');
  });
});
