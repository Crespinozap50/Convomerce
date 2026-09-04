import { ConversationLanguageService } from './conversation-language.service';

describe('ConversationLanguageService', () => {
  const service = new ConversationLanguageService();

  it('detects a clear language when a conversation starts', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              language_locale: null,
              language_source: null,
              language_candidate_locale: null,
              language_candidate_count: 0,
              contact_locale: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(
      service.resolve(
        client as never,
        'conversation-1',
        'Hello, I would like to place an order',
        'es-CO',
      ),
    ).resolves.toEqual({ locale: 'en', source: 'detected' });
  });

  it('keeps the current language for ambiguous replies and addresses', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            language_locale: 'en',
            language_source: 'detected',
            language_candidate_locale: null,
            language_candidate_count: 0,
            contact_locale: null,
          },
        ],
      }),
    };

    await expect(
      service.resolve(client as never, 'conversation-1', '65 Street # 88-20', 'es'),
    ).resolves.toEqual({ locale: 'en', source: 'detected' });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  // Rule 4 (docs/internationalization.md): a contact's known language
  // preference takes precedence at conversation start — read from the code
  // (contactLocale ?? evidence ?? tenantLocale) but never exercised by a
  // test: contact_locale was null in every case above. Here the contact's
  // preference is English while the very first message is clearly Spanish
  // — the contact preference must still win over the detected evidence.
  it('prefers a known contact-language preference over the first message\'s own detected language', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              language_locale: null,
              language_source: null,
              language_candidate_locale: null,
              language_candidate_count: 0,
              contact_locale: 'en',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(
      service.resolve(
        client as never,
        'conversation-1',
        'Hola, quiero hacer un pedido por favor',
        'es',
      ),
    ).resolves.toEqual({ locale: 'en', source: 'contact_preference' });
  });

  it('requires two consecutive clear messages before changing language', async () => {
    const firstClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              language_locale: 'es-CO',
              language_source: 'tenant_default',
              language_candidate_locale: null,
              language_candidate_count: 0,
              contact_locale: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    await expect(
      service.resolve(
        firstClient as never,
        'conversation-1',
        'Hello, I need some help with my order',
        'es-CO',
      ),
    ).resolves.toEqual({ locale: 'es-CO', source: 'tenant_default' });

    const secondClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              language_locale: 'es-CO',
              language_source: 'tenant_default',
              language_candidate_locale: 'en',
              language_candidate_count: 1,
              contact_locale: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    await expect(
      service.resolve(
        secondClient as never,
        'conversation-1',
        'Please show me the available products',
        'es-CO',
      ),
    ).resolves.toEqual({ locale: 'en', source: 'detected' });
  });
});
