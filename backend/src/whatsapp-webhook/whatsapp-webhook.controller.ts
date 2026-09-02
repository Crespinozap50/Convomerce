import {
  Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, RawBodyRequest, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookAuthService } from './webhook-auth.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { MetricsService } from '../metrics/metrics.service';

@Controller('v1/webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly auth: WebhookAuthService,
    private readonly webhook: WhatsAppWebhookService,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (!challenge || !this.auth.verifyChallenge(mode, token)) throw new ForbiddenException();
    return challenge;
  }

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    try {
      this.auth.assertSignature(request.rawBody, signature);
    } catch (error) {
      this.metrics.recordWebhook('rejected_signature');
      throw error;
    }
    return this.webhook.receive(request.body)
      .then((result) => {
        this.metrics.recordWebhook('accepted');
        return result;
      })
      .catch((error) => {
        this.metrics.recordWebhook('rejected_payload');
        throw error;
      });
  }
}
