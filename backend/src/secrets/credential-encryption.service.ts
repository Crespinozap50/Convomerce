import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { badRequest } from '../observability/http-errors';

// AES-256-GCM at rest for any third-party credential this platform must
// hold on the tenant's behalf (Google Calendar refresh tokens, WhatsApp
// access tokens, ...). The key is derived from CREDENTIAL_ENCRYPTION_KEY
// rather than used directly, so its length doesn't have to match AES-256's
// 32-byte requirement.
@Injectable()
export class CredentialEncryptionService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  decrypt(value: string): string {
    const [marker, version, ivValue, tagValue, ciphertext] = value.split(':');
    if (marker !== 'enc' || version !== 'v1' || !ivValue || !tagValue || !ciphertext) {
      throw badRequest('CREDENTIAL_FORMAT_INVALID', 'Stored credential format is invalid');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw badRequest('CREDENTIAL_DECRYPTION_FAILED', 'Stored credential could not be decrypted');
    }
  }

  private key(): Buffer {
    const value = this.config.get<string>('CREDENTIAL_ENCRYPTION_KEY');
    if (!value) {
      throw badRequest('CREDENTIAL_ENCRYPTION_KEY_MISSING', 'CREDENTIAL_ENCRYPTION_KEY is not configured');
    }
    return createHash('sha256').update(value).digest();
  }
}
