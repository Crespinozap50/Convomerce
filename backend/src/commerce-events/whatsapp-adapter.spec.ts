import { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from '../secrets/credential-encryption.service';
import {
  EncryptedChannelSecretProvider,
  MetaWhatsAppAdapter,
} from './whatsapp-adapter';

describe('MetaWhatsAppAdapter', () => {
  const originalFetch = global.fetch;
  const credentials = new CredentialEncryptionService(
    new ConfigService({ CREDENTIAL_ENCRYPTION_KEY: 'test-encryption-key' }),
  );
  const encryptedToken = credentials.encrypt('token-ficticio-suficientemente-largo');

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('envía el contrato de texto y retorna el wamid sin exponer el token', async () => {
    const config = new ConfigService({ WHATSAPP_GRAPH_API_VERSION: 'v99.0' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.fixture.meta-response' }] }),
    });
    const adapter = new MetaWhatsAppAdapter(
      config,
      new EncryptedChannelSecretProvider(credentials),
    );

    await expect(adapter.send({
      idempotencyKey: 'event-id',
      messageId: 'message-id',
      phoneNumberId: 'phone-number-id',
      recipient: 'recipient-wa-id',
      secretReference: encryptedToken,
      content: { type: 'text', body: 'Mensaje ficticio' },
    })).resolves.toEqual({ externalMessageId: 'wamid.fixture.meta-response' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v99.0/phone-number-id/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer token-ficticio-suficientemente-largo',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: 'recipient-wa-id',
          type: 'text',
          text: { preview_url: false, body: 'Mensaje ficticio' },
        }),
      }),
    );
  });

  it('incluye el cuerpo real de la respuesta de Meta en el error, no solo el código HTTP', async () => {
    // Regression: el error solo decía "Meta rejected the request with HTTP
    // 400", sin el cuerpo real de Meta (que trae el motivo — parámetro
    // inválido, botones duplicados, etc.) — imposible de diagnosticar sin
    // ese detalle. Mismo patrón que el fix de http-error.filter.ts para 500s.
    const config = new ConfigService({ WHATSAPP_GRAPH_API_VERSION: 'v99.0' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({ error: { message: 'Param text.body is too long', code: 100 } }),
      ),
    });
    const adapter = new MetaWhatsAppAdapter(config, new EncryptedChannelSecretProvider(credentials));

    await expect(adapter.send({
      idempotencyKey: 'event-id', messageId: 'message-id', phoneNumberId: 'phone-number-id',
      recipient: 'recipient-wa-id', secretReference: encryptedToken,
      content: { type: 'text', body: 'Mensaje ficticio' },
    })).rejects.toThrow(/HTTP 400.*Param text\.body is too long/);
  });

  it('sigue reportando el código HTTP aunque no se pueda leer el cuerpo de la respuesta', async () => {
    const config = new ConfigService({ WHATSAPP_GRAPH_API_VERSION: 'v99.0' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockRejectedValue(new Error('stream already consumed')),
    });
    const adapter = new MetaWhatsAppAdapter(config, new EncryptedChannelSecretProvider(credentials));

    await expect(adapter.send({
      idempotencyKey: 'event-id', messageId: 'message-id', phoneNumberId: 'phone-number-id',
      recipient: 'recipient-wa-id', secretReference: encryptedToken,
      content: { type: 'text', body: 'Mensaje ficticio' },
    })).rejects.toThrow(/HTTP 500/);
  });

  it('traduce botones del dominio al contrato de Meta', async () => {
    const config = new ConfigService({ WHATSAPP_GRAPH_API_VERSION: 'v99.0' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.fixture.interactive' }] }),
    });
    const adapter = new MetaWhatsAppAdapter(config, new EncryptedChannelSecretProvider(credentials));
    await adapter.send({
      idempotencyKey: 'event-id', messageId: 'message-id', phoneNumberId: 'phone-number-id',
      recipient: 'recipient-wa-id', secretReference: encryptedToken,
      content: { type: 'interactive', interactive: { type: 'buttons', body: '¿La agrego?', options: [
        { id: 'rec:add:1', title: 'Sí, agregar' }, { id: 'rec:reject:1', title: 'No, gracias' },
      ] } },
    });
    const request = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      type: 'interactive',
      interactive: expect.objectContaining({ type: 'button' }),
    }));
  });

  it('descifra el token guardado por tenant, no uno global compartido', () => {
    const provider = new EncryptedChannelSecretProvider(credentials);
    expect(provider.resolve(encryptedToken)).toBe('token-ficticio-suficientemente-largo');
  });

  it('rechaza un valor que no tiene el formato cifrado esperado, en vez de exponerlo tal cual', () => {
    const provider = new EncryptedChannelSecretProvider(credentials);
    expect(() => provider.resolve('plain-text-not-encrypted')).toThrow(
      'Stored credential format is invalid',
    );
  });
});
