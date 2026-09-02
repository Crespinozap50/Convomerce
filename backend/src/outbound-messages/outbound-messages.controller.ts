import { BadRequestException, Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { CreateFixtureOutboundMessageCommand } from './outbound-message.types';
import { RequestOutboundMessageCommand } from './outbound-message.types';
import { OutboundMessagesService } from './outbound-messages.service';

@Controller('v1/dev/outbound-messages')
export class OutboundMessagesController {
  constructor(private readonly messages: OutboundMessagesService) {}

  @Post()
  create(@Body() body: CreateFixtureOutboundMessageCommand) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
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
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    for (const field of ['tenantId', 'channelId', 'conversationId'] as const) {
      if (!body[field] || !isUuid(body[field])) throw new BadRequestException(`${field} must be a UUID`);
    }
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    return this.messages.requestSend(body);
  }
}
