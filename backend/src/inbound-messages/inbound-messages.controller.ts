import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { validate as isUuid } from "uuid";
import { InboundMessagesService } from "./inbound-messages.service";
import {
  ReceiveInboundMessageCommand,
  ReprocessInboundMessageCommand,
} from "./inbound-message.types";

@Controller("v1/dev/inbound-messages")
export class InboundMessagesController {
  constructor(private readonly messages: InboundMessagesService) {}

  @Post()
  async receive(@Body() body: ReceiveInboundMessageCommand) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    for (const field of ["tenantId", "channelId"] as const) {
      if (!body[field] || !isUuid(body[field]))
        throw new BadRequestException(`${field} must be a UUID`);
    }
    if (body.contactId && !isUuid(body.contactId)) {
      throw new BadRequestException("contactId must be a UUID");
    }
    if (!body.contactId && !body.providerSubject?.trim()) {
      throw new BadRequestException("contactId or providerSubject is required");
    }
    if (
      !body.externalEventId?.trim() ||
      !body.externalMessageId?.trim() ||
      !body.text?.trim()
    ) {
      throw new BadRequestException(
        "externalEventId, externalMessageId, and text are required",
      );
    }
    return this.messages.receive(body);
  }

  @Post("reprocess")
  async reprocess(@Body() body: ReprocessInboundMessageCommand) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    for (const field of ["tenantId", "conversationId", "messageId"] as const) {
      if (!body[field] || !isUuid(body[field])) {
        throw new BadRequestException(`${field} must be a UUID`);
      }
    }
    return this.messages.reprocess(body);
  }
}
