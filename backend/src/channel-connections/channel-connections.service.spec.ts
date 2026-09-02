import { ConfigService } from '@nestjs/config';
import { ChannelConnectionsService } from './channel-connections.service';
import { CredentialEncryptionService } from '../secrets/credential-encryption.service';

describe('ChannelConnectionsService', () => {
  const credentials = new CredentialEncryptionService(
    new ConfigService({ CREDENTIAL_ENCRYPTION_KEY: 'test-encryption-key' }),
  );

  const service = (client: { query: jest.Mock }) =>
    new ChannelConnectionsService(
      { withTenantTransaction: (_tenantId: string, operation: (client: unknown) => unknown) => operation(client) } as never,
      {} as never,
      {} as never,
      credentials,
    );

  it('encrypts a freshly pasted access token before it ever reaches configure_channel_connection', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ connection_id: 'connection-1' }] }) };

    await service(client).connect({
      tenantId: 'tenant-1', actorUserId: 'user-1', channelId: 'channel-1',
      phoneNumberId: 'phone-1', wabaId: 'waba-1', accessToken: 'EAAG-plaintext-token',
    });

    const [, params] = client.query.mock.calls[0];
    const encryptedSecret = params[6];
    expect(encryptedSecret).not.toContain('EAAG-plaintext-token');
    expect(encryptedSecret).toMatch(/^enc:v1:/);
    expect(credentials.decrypt(encryptedSecret)).toBe('EAAG-plaintext-token');
  });

  it('reuses the already-encrypted token on file when accessToken is omitted (editing phoneNumberId only)', async () => {
    const existingEncrypted = credentials.encrypt('already-stored-token');
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ secret_reference: existingEncrypted }] })
      .mockResolvedValueOnce({ rows: [{ connection_id: 'connection-1' }] }) };

    await service(client).connect({
      tenantId: 'tenant-1', actorUserId: 'user-1', channelId: 'channel-1',
      phoneNumberId: 'new-phone-id', wabaId: 'waba-1',
    });

    expect(client.query.mock.calls[0][0]).toContain('select secret_reference from app.channels');
    const [, params] = client.query.mock.calls[1];
    expect(params[6]).toBe(existingEncrypted);
  });

  it('reports a clear conflict when the Phone Number ID is already connected to another tenant', async () => {
    // channels_provider_external_account_uidx is global across tenants, so
    // configure_channel_connection() raises a raw 23505 unique_violation
    // instead of a domain error — this used to bubble up as a generic
    // "Internal server error" with no useful message.
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "channels_provider_external_account_uidx"'), { code: '23505' });
    const client = { query: jest.fn().mockRejectedValue(pgError) };

    await expect(
      service(client).connect({
        tenantId: 'tenant-1', actorUserId: 'user-1', channelId: 'channel-1',
        phoneNumberId: 'phone-already-taken', wabaId: 'waba-1', accessToken: 'EAAG-token',
      }),
    ).rejects.toThrow('This Phone Number ID is already connected to another business on the platform');
  });

  it('rejects connecting for the first time with no access token and nothing already on file', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [{ secret_reference: null }] }) };

    await expect(
      service(client).connect({
        tenantId: 'tenant-1', actorUserId: 'user-1', channelId: 'channel-1',
        phoneNumberId: 'phone-1', wabaId: 'waba-1',
      }),
    ).rejects.toThrow('An access token is required to connect this channel for the first time');
    // Never reaches configure_channel_connection with an empty/missing secret.
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
