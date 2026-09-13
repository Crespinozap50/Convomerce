import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { validate as isUuid } from "uuid";
import { InboundMessagesService } from "./inbound-messages.service";
import {
  ReceiveInboundMessageCommand,
  ReprocessInboundMessageCommand,
} from "./inbound-message.types";

@Controller("v1/dev/inbound-messages")
export class InboundMessagesController {
  constructor(
    private readonly messages: InboundMessagesService,
    private readonly config: ConfigService,
  ) {}

  // Security finding, this session: gating purely on NODE_ENV!=='production'
  // left this unauthenticated fake-inbound-message endpoint open on the
  // live pilot server, whose own .env has NODE_ENV=development (required
  // elsewhere — no HTTPS yet, see environment.validation.ts). Closed by
  // default regardless of NODE_ENV; see docs/decisions.md.
  private assertEnabled(): void {
    if (this.config.get<string>("DEV_HARNESS_ENABLED") !== "true") {
      throw new NotFoundException();
    }
  }

  @Post()
  async receive(@Body() body: ReceiveInboundMessageCommand) {
    this.assertEnabled();
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
    this.assertEnabled();
    for (const field of ["tenantId", "conversationId", "messageId"] as const) {
      if (!body[field] || !isUuid(body[field])) {
        throw new BadRequestException(`${field} must be a UUID`);
      }
    }
    return this.messages.reprocess(body);
  }
}
