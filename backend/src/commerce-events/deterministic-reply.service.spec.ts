import { classifyMessage, DeterministicReplyService } from './deterministic-reply.service';

describe('DeterministicReplyService', () => {
  it.each([
    ['Hola, buenas tardes', 'greeting'],
    ['¿Qué tacos tienen?', 'menu'],
    ['¿Qué servicios tienen?', 'menu'],
    ['¿Qué ofrecen?', 'menu'],
    ['What services do you offer?', 'menu'],
    ['Hola, ¿qué tacos tienen?', 'menu'],
    // D-113: this is the exact title of the "menu"/"price" no-match fallback
    // button (copy.menuButtonLabel) — tapping it reconstructs as this text,
    // which must itself be recognized as a menu request or the tap dead-ends
    // at the tenant's generic fallback message instead of showing the menu.
    // Found live on Santos Tacos: classifyFlowCommand's separate "catalog"
    // rule already matched "opciones"/"options" (used to route the order
    // flow), but this classifier's own menu keyword list didn't, so the
    // fallback capability — the one that actually answers when there's no
    // active order — never recognized its own button being tapped.
    ['Ver opciones', 'menu'],
    ['View options', 'menu'],
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

  it('offers a tappable category picker instead of a wall of text when a generic menu question matches more than 10 items (D-102)', async () => {
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
    expect(reply.body).toBe('Tenemos varias categorías, elige una para ver las opciones:');
    expect(reply.interactive).toEqual({
      type: 'list',
      body: '',
      buttonLabel: 'Ver opciones',
      options: [
        { id: 'menu-category:Otros', title: 'Otros' },
        { id: 'menu-category:Tacos', title: 'Tacos' },
      ],
    });
    expect(reply.sources).toEqual([]);
  });

  it('prepends the tenant\'s own configured word to each category row instead of the default plain name (D-140)', async () => {
    // The project owner's own follow-up to D-139: removing "Menú" globally
    // was wrong for Santos Tacos, which should keep saying "Menú Tacos" —
    // this is a per-tenant opt-in (bot_configurations.category_label_prefix,
    // bot.categoryLabelPrefix here), not a global on/off. Absent (as in the
    // test right above this one), the row shows the plain category name;
    // set, it's prepended exactly as configured.
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
      categoryLabelPrefix: 'Menú',
    });
    expect(reply.interactive).toEqual({
      type: 'list',
      body: '',
      buttonLabel: 'Ver opciones',
      options: [
        { id: 'menu-category:Otros', title: 'Menú Otros' },
        { id: 'menu-category:Tacos', title: 'Menú Tacos' },
      ],
    });
  });

  describe('a narrowed category still over 10 items paginates instead of dropping items or dead-ending (D-113/D-114)', () => {
    // The category picker only ever applies to a *generic* "ver menu" with
    // no narrowing at all -- a customer who already asked about a specific
    // (unusually large) category gets that category's own items, not
    // another picker (which would show one lone category and loop back
    // into itself). Found live on Santos Tacos, whose real "Tacos" category
    // has 13 items -- over WhatsApp's 10-row list cap. Three rejected fixes
    // before this one, in order:
    // 1. Unbounded plain text (nothing tappable -- the "quoted instruction"
    //    anti-pattern D-095/D-104 already closed for the order flow).
    // 2. A bounce-back button to the category picker -- tappable, but showed
    //    zero products and looped straight back into the same dead end.
    // 3. (D-113 as first shipped) The first 9 items, no more -- real
    //    progress, but silently dropped the rest with no way to reach them.
    //    A 20-30 item category (not hypothetical -- just needs a bigger
    //    tenant than Santos Tacos) would lose most of itself this way.
    // D-114 is real pagination: 7 items/page, leaving room for up to 3 nav
    // rows (Anterior/Siguiente/Ver opciones) without exceeding WhatsApp's
    // 10-row cap. Page state travels in the tapped row's id
    // (menu:<category>:page:<n>), not its title -- a 24-character title has
    // nowhere near enough room to carry both reliably.
    const tacos = Array.from({ length: 13 }, (_, index) => ({
      item_id: `taco-${index}`, variant_id: `taco-variant-${index}`, name: `Taco ${index}`, category: 'Tacos',
      variant_name: 'Unidad', price_minor: '950000', currency: 'COP',
    }));

    it('page 1: shows the first 6 items plus Siguiente, not a truncated 9', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValue({ rowCount: tacos.length, rows: tacos }),
      };
      const reply = await new DeterministicReplyService().resolve(client as never, '¿Qué tacos tienen?', {
        locale: 'es',
        welcomeMessage: 'Hola', fallbackMessage: 'No se', handoffKeywords: [], timezone: 'UTC',
      });
      expect(reply.intent).toBe('menu');
      expect(reply.body).toBe('Esta es nuestra oferta disponible:');
      expect(reply.interactive).toEqual({
        type: 'list',
        body: '',
        buttonLabel: 'Ver opciones',
        options: [
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `taco-variant-${index}`, title: `Taco ${index}`, description: '$ 9.500',
          })),
          { id: 'details:menu:Tacos:page:1', title: 'Ficha técnica' },
          { id: 'menu:Tacos:page:2', title: 'Siguiente' },
          { id: 'cart:view_catalog', title: 'Ver opciones' },
        ],
      });
      expect(reply.sources).toHaveLength(13);
    });

    it('page 3 (last page, reached by tapping Siguiente twice): shows the remaining item plus Anterior, no Siguiente', async () => {
      // A pagination tap is routed straight to offeringReply's own catalog
      // query (skipping the specific-FAQ check) — only one query happens,
      // unlike the other tests here. 13 tacos at 6/page (D-138 shrank the
      // page size from 7 to make room for the new "Ficha técnica" row on
      // every page, including a middle one with both Anterior and
      // Siguiente already present) means 3 pages, not 2 — page 3 is now
      // the true last page.
      const client = {
        query: jest.fn().mockResolvedValue({ rowCount: tacos.length, rows: tacos }),
      };
      const reply = await new DeterministicReplyService().resolve(
        client as never, 'Siguiente',
        { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No se', handoffKeywords: [], timezone: 'UTC' },
        'menu:Tacos:page:3',
      );
      expect(reply.interactive).toEqual({
        type: 'list',
        body: '',
        buttonLabel: 'Ver opciones',
        options: [
          { id: 'taco-variant-12', title: 'Taco 12', description: '$ 9.500' },
          { id: 'details:menu:Tacos:page:3', title: 'Ficha técnica' },
          { id: 'menu:Tacos:page:2', title: 'Anterior' },
          { id: 'cart:view_catalog', title: 'Ver opciones' },
        ],
      });
    });

    it('a middle page of a genuinely large category (30 items) shows both Anterior and Siguiente, proving this scales beyond Santos Tacos', async () => {
      const bigCategory = Array.from({ length: 30 }, (_, index) => ({
        item_id: `item-${index}`, variant_id: `variant-${index}`, name: `Item ${index}`, category: 'Grande',
        variant_name: 'Unidad', price_minor: '100000', currency: 'COP',
      }));
      const client = {
        query: jest.fn().mockResolvedValue({ rowCount: bigCategory.length, rows: bigCategory }),
      };
      // Page 2 of ceil(30/6)=5: items 6-11, both directions available.
      const reply = await new DeterministicReplyService().resolve(
        client as never, 'Siguiente',
        { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No se', handoffKeywords: [], timezone: 'UTC' },
        'menu:Grande:page:2',
      );
      expect(reply.interactive).toEqual({
        type: 'list',
        body: '',
        buttonLabel: 'Ver opciones',
        options: [
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `variant-${index + 6}`, title: `Item ${index + 6}`, description: '$ 1.000',
          })),
          { id: 'details:menu:Grande:page:2', title: 'Ficha técnica' },
          { id: 'menu:Grande:page:1', title: 'Anterior' },
          { id: 'menu:Grande:page:3', title: 'Siguiente' },
          { id: 'cart:view_catalog', title: 'Ver opciones' },
        ],
      });
    });
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
        { id: 'cart:view_catalog', title: 'Ver opciones' },
      ],
    });
  });

  it('keeps two long, near-identical product names apart in the menu list instead of truncating both to the same prefix (live finding)', async () => {
    // Found live on Santos Tacos' real "Entradas" category: both rows
    // rendered as "Sandwich de queso y Sop…"/"Sandwich de queso y bir…",
    // dropping exactly the words that told them apart. Same rule
    // itemChoiceReply already follows (D-101/D-102) — the full name goes in
    // the 72-char description, ahead of the variant/price it already showed.
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rowCount: 2,
          rows: [
            { item_id: 'item-1', variant_id: 'variant-1', name: 'Sandwich de queso y Sopa MX', category: 'Entradas', variant_name: 'Unidad', price_minor: '2100000', currency: 'COP' },
            { item_id: 'item-2', variant_id: 'variant-2', name: 'Sandwich de queso y birria y Sopa MX', category: 'Entradas', variant_name: 'Unidad', price_minor: '2800000', currency: 'COP' },
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
        { id: 'variant-1', title: 'Sandwich de queso y Sop…', description: 'Sandwich de queso y Sopa MX · $ 21.000' },
        { id: 'variant-2', title: 'Sandwich de queso y bir…', description: 'Sandwich de queso y birria y Sopa MX · $ 28.000' },
        { id: 'cart:view_catalog', title: 'Ver opciones' },
      ],
    });
  });

  it('appends the variant name to the row title when two rows share the same (short enough) product name, not just an identical truncated prefix (D-145, found live on CrediCel Store)', async () => {
    // Found live: a product with two real variants (D-142/D-143's
    // multi-variant catalog) gets two rows with the IDENTICAL title —
    // only the description told them apart. Fixable at the title level
    // only when name+variant actually fit in 24 chars; a name already
    // past that on its own (see the "Sandwich..." test above) still
    // relies on the description, same limitation itemChoiceInteractive
    // already accepts for the same reason.
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({
          rowCount: 2,
          rows: [
            { item_id: 'item-1', variant_id: 'variant-1', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso de 12 oz', price_minor: '700000', currency: 'COP' },
            { item_id: 'item-1', variant_id: 'variant-2', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso de 16 oz', price_minor: '900000', currency: 'COP' },
          ],
        }),
    };
    const reply = await new DeterministicReplyService().resolve(client as never, 'muéstrame el menú', {
      locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC',
    });
    const titles = (reply.interactive?.options ?? []).map((option) => option.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toEqual(['Agua fresca (Vaso de 12…', 'Agua fresca (Vaso de 16…', 'Ver opciones']);
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
    expect(reply.interactive?.options).toHaveLength(3); // 2 items + the "Ver opciones" escape row
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
    // D-100/D-095 rule: no quoted "escribe ver catálogo" instruction — a
    // real button instead.
    expect(reply.interactive).toEqual({
      type: 'buttons',
      body: '',
      options: [{ id: 'cart:view_catalog', title: 'Ver opciones' }],
    });
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

  it('lists a whole category when a category row is tapped, not just the items repeating its word (live finding)', async () => {
    // Found live tapping "Menú Tacos" on Santos Tacos' real menu (back when
    // the row's title carried that word and the tap's reconstructed title
    // text was what classifyMessage narrowed on): only the two "Orden x 3
    // Tacos ..." packages came back, because their names repeat the
    // category word and outscored every individual taco. D-138 dropped
    // "Menú" from the title and moved tap resolution to the row's own id
    // (D-139: "menu-category:{name}", see menuCategoriesReply) — simulated
    // here the same way a real tap on that row now arrives.
    // A tap resolved by id (see resolve()'s id-based shortcut) never runs
    // the "specific FAQ" pre-check query classifyMessage's normal 'menu'
    // dispatch does — offeringReply's own catalog query is the only one.
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 3, rows: [
      { item_id: 'item-1', variant_id: 'variant-1', name: 'Orden x 3 Tacos', category: 'Tacos', variant_name: 'Unidad', price_minor: '2550000', currency: 'COP' },
      { item_id: 'item-2', variant_id: 'variant-2', name: 'Birria', category: 'Tacos', variant_name: 'Unidad', price_minor: '900000', currency: 'COP' },
      { item_id: 'item-3', variant_id: 'variant-3', name: 'Agua fresca', category: 'Bebidas', variant_name: 'Vaso', price_minor: '700000', currency: 'COP' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(
      client as never,
      'Tacos',
      { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC' },
      'menu-category:Tacos',
    );
    expect(reply.interactive?.options).toEqual([
      expect.objectContaining({ title: 'Orden x 3 Tacos' }),
      expect.objectContaining({ title: 'Birria' }),
      { id: 'details:menu:Tacos:page:1', title: 'Ficha técnica' },
      { id: 'cart:view_catalog', title: 'Ver opciones' },
    ]);
  });

  it('also lists a whole category for commercial-flow.service.ts\'s own "category:" id, not just "menu-category:" (D-143, found live on CrediCel Store)', async () => {
    // commercial-flow.service.ts's categoryPickerReply() (the "Otro
    // producto" mid-order picker) tags its own rows "category:{name}" —
    // its categoryItemsReply() returns null once the tapped category has
    // more than 10 items, deferring here the same way a "menu:"/
    // "menu-category:" tap always has. Before this, nothing here recognized
    // "category:" either, so that hand-off landed on nothing and the
    // customer saw the generic fallback instead of any real product list.
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 2, rows: [
      { item_id: 'item-1', variant_id: 'variant-1', name: 'Orden x 3 Tacos', category: 'Tacos', variant_name: 'Unidad', price_minor: '2550000', currency: 'COP' },
      { item_id: 'item-2', variant_id: 'variant-2', name: 'Birria', category: 'Tacos', variant_name: 'Unidad', price_minor: '900000', currency: 'COP' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(
      client as never,
      'Tacos',
      { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC' },
      'category:Tacos',
    );
    expect(reply.interactive?.options).toEqual([
      expect.objectContaining({ title: 'Orden x 3 Tacos' }),
      expect.objectContaining({ title: 'Birria' }),
      { id: 'details:menu:Tacos:page:1', title: 'Ficha técnica' },
      { id: 'cart:view_catalog', title: 'Ver opciones' },
    ]);
  });

  it('shows every product\'s full technical description untruncated, never cutting real spec text (D-144, found live on CrediCel Store)', async () => {
    // D-138's original fix split WhatsApp's 1024-char interactive-body cap
    // evenly across whichever items are on the page and truncated each to
    // its share — safe from crashing, but the project owner reported that
    // cutting real technical specs stops a customer from choosing well
    // between products. A text-only message (no interactive attached) gets
    // WhatsApp's much larger 4096-char limit instead, so ordinary
    // descriptions like these fit in one message with nothing cut — the
    // tappable list itself goes out as a second, separate message.
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 2, rows: [
      { item_id: 'item-1', variant_id: 'variant-1', name: 'Tacos al pastor', category: 'Tacos', variant_name: 'Unidad', price_minor: '1890000', currency: 'COP', description: 'Tortilla de maíz, cerdo marinado en achiote y piña, cebolla y cilantro al gusto.' },
      { item_id: 'item-2', variant_id: 'variant-2', name: 'Birria', category: 'Tacos', variant_name: 'Unidad', price_minor: '900000', currency: 'COP', description: 'Carne de res deshebrada en consomé, servida con tortilla aparte para remojar.' },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(
      client as never,
      'Ficha técnica',
      { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC' },
      'details:menu:Tacos:page:1',
    );
    expect(reply.body).toContain('Tortilla de maíz, cerdo marinado en achiote y piña, cebolla y cilantro al gusto.');
    expect(reply.body).toContain('Carne de res deshebrada en consomé, servida con tortilla aparte para remojar.');
    expect(reply.body).not.toContain('…');
    expect(reply.additionalMessages).toHaveLength(1);
    expect(reply.additionalMessages?.[0].interactive?.options).toEqual([
      expect.objectContaining({ title: 'Tacos al pastor' }),
      expect.objectContaining({ title: 'Birria' }),
      { id: 'details:menu:Tacos:page:1', title: 'Ficha técnica' },
      { id: 'cart:view_catalog', title: 'Ver opciones' },
    ]);
    // The list-carrying message has no technical text of its own, and
    // (D-145) a heading distinct from the technical-text message right
    // before it — repeating the same "Aquí tienes la ficha técnica..."
    // text on both made the second message read as a duplicate of the
    // first at a glance, easy to miss the tappable list inside it.
    expect(reply.additionalMessages?.[0].body).toBe('Toca un producto para elegirlo:');
  });

  it('splits into as many text-only messages as actually needed, never truncating, when descriptions genuinely exceed one message (D-144)', async () => {
    // Each description alone (~2475 chars) comfortably fits one 4096-char
    // text message — realistic, if unusually long — but the two combined
    // (plus heading/labels) don't fit in one, forcing a split *between*
    // items. Neither description itself should ever be cut.
    const descriptionA = 'Especificación técnica extensa de este portátil. '.repeat(50);
    const descriptionB = 'Especificación técnica extensa de este otro portátil. '.repeat(50);
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 2, rows: [
      { item_id: 'item-1', variant_id: 'variant-1', name: 'Portátil A', category: 'Computadores', variant_name: 'Único', price_minor: '100000000', currency: 'COP', description: descriptionA },
      { item_id: 'item-2', variant_id: 'variant-2', name: 'Portátil B', category: 'Computadores', variant_name: 'Único', price_minor: '200000000', currency: 'COP', description: descriptionB },
    ] }) };
    const reply = await new DeterministicReplyService().resolve(
      client as never,
      'Ficha técnica',
      { locale: 'es', welcomeMessage: 'Hola', fallbackMessage: 'No sé', handoffKeywords: [], timezone: 'UTC' },
      'details:menu:Computadores:page:1',
    );
    const textParts = [reply.body, ...(reply.additionalMessages ?? []).filter((m) => !m.interactive).map((m) => m.body)];
    expect(textParts.length).toBeGreaterThan(1);
    expect(textParts.join('')).toContain(descriptionA);
    expect(textParts.join('')).toContain(descriptionB);
    expect(textParts.join('')).not.toContain('…');
    for (const part of textParts) expect(part.length).toBeLessThanOrEqual(4096);
    // The interactive list still goes out as its own final message, with
    // no technical text attached to it either way.
    const listMessage = reply.additionalMessages?.find((m) => m.interactive);
    expect(listMessage).toBeDefined();
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
      { id: 'cart:view_catalog', title: 'Ver opciones' },
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
      { id: 'cart:view_catalog', title: 'Ver opciones' },
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
