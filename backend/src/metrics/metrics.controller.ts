import { Controller, Get, Header, Headers, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsAuthService } from './metrics-auth.service';
import { MetricsService } from './metrics.service';

@Controller('internal/metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly auth: MetricsAuthService,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  async prometheus(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.assertAuthorized(authorization);
    response.setHeader('content-type', this.metrics.contentType);
    return this.metrics.prometheus();
  }

  @Get('status')
  @Header('cache-control', 'no-store')
  async status(@Headers('authorization') authorization?: string) {
    this.auth.assertAuthorized(authorization);
    const snapshot = await this.metrics.snapshot();
    return this.metrics.thresholds(snapshot);
  }
}
