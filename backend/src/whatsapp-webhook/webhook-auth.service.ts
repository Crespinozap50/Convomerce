import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WebhookAuthService {
  constructor(private readonly config: ConfigService) {}

  verifyChallenge(mode?: string, token?: string): boolean {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    return Boolean(expected && mode === 'subscribe' && token === expected);
  }

  assertSignature(rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret || !rawBody || !signature?.startsWith('sha256=')) {
      throw new UnauthorizedException('Missing or invalid webhook signature');
    }
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const receivedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (receivedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(receivedBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
