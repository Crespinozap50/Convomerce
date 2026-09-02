import { CredentialEncryptionService } from './credential-encryption.service';

describe('CredentialEncryptionService', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'CREDENTIAL_ENCRYPTION_KEY' ? 'test-encryption-key' : undefined,
    ),
  };
  const service = new CredentialEncryptionService(config as never);

  it('round-trips a value through encrypt then decrypt', () => {
    const encrypted = service.encrypt('EAAG-real-looking-whatsapp-token');
    expect(encrypted).not.toContain('EAAG-real-looking-whatsapp-token');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(service.decrypt(encrypted)).toBe('EAAG-real-looking-whatsapp-token');
  });

  it('produces a different ciphertext each time (random IV), even for the same input', () => {
    const first = service.encrypt('same-secret');
    const second = service.encrypt('same-secret');
    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe('same-secret');
    expect(service.decrypt(second)).toBe('same-secret');
  });

  it('rejects a tampered ciphertext instead of silently returning garbage', () => {
    const encrypted = service.encrypt('secret-value');
    const [marker, version, iv, tag, ciphertext] = encrypted.split(':');
    const tamperedLastChar = ciphertext.slice(0, -1) + (ciphertext.at(-1) === 'A' ? 'B' : 'A');
    const tampered = [marker, version, iv, tag, tamperedLastChar].join(':');
    expect(() => service.decrypt(tampered)).toThrow('Stored credential could not be decrypted');
  });

  it('rejects a value that is not in the enc:v1:... format', () => {
    expect(() => service.decrypt('not-an-encrypted-value')).toThrow(
      'Stored credential format is invalid',
    );
  });

  it('throws when CREDENTIAL_ENCRYPTION_KEY is not configured', () => {
    const missingConfig = { get: jest.fn().mockReturnValue(undefined) };
    const unconfigured = new CredentialEncryptionService(missingConfig as never);
    expect(() => unconfigured.encrypt('value')).toThrow(
      'CREDENTIAL_ENCRYPTION_KEY is not configured',
    );
  });
});
