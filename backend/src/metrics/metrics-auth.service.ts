import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetricsAuthService {
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    this.expected = Buffer.from(`Bearer ${config.getOrThrow<string>('METRICS_BEARER_TOKEN')}`);
  }

  assertAuthorized(authorization?: string): void {
    const received = Buffer.from(authorization ?? '');
    if (received.length !== this.expected.length || !timingSafeEqual(received, this.expected)) {
      throw new UnauthorizedException('Invalid metrics credentials');
    }
  }
}
