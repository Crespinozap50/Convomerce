import { BadRequestException, Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate as isUuid } from 'uuid';
import { CreateFixtureOutboundMessageCommand } from './outbound-message.types';
import { RequestOutboundMessageCommand } from './outbound-message.types';
import { OutboundMessagesService } from './outbound-messages.service';

@Controller('v1/dev/outbound-messages')
export class OutboundMessagesController {
  constructor(
    private readonly messages: OutboundMessagesService,
    private readonly config: ConfigService,
  ) {}

  // Security finding, this session: see inbound-messages.controller.ts's
  // assertEnabled() comment — same fix, same reason (DEV_HARNESS_ENABLED
  // closed by default, independent of NODE_ENV).
  private assertEnabled(): void {
    if (this.config.get<string>('DEV_HARNESS_ENABLED') !== 'true') {
      throw new NotFoundException();
    }
  }

  @Post()
  create(@Body() body: CreateFixtureOutboundMessageCommand) {
    this.assertEnabled();
    for (const field of ['tenantId', 'channelId', 'conversationId'] as const) {
      if (!body[field] || !isUuid(body[field])) throw new BadRequestException(`${field} must be a UUID`);
    }
    if (!body.externalMessageId?.trim() || !body.text?.trim()) {
      throw new BadRequestException('externalMessageId and text are required');
    }
    return this.messages.createFixture(body);
  }

  @Post('send-requests')
  requestSend(@Body() body: RequestOutboundMessageCommand) {
    this.assertEnabled();
    for (const field of ['tenantId', 'channelId', 'conversationId'] as const) {
      if (!body[field] || !isUuid(body[field])) throw new BadRequestException(`${field} must be a UUID`);
    }
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    return this.messages.requestSend(body);
  }
}
