import { Module } from '@nestjs/common';
import { InboundMessagesController } from './inbound-messages.controller';
import { InboundMessagesService } from './inbound-messages.service';

@Module({ controllers: [InboundMessagesController], providers: [InboundMessagesService], exports: [InboundMessagesService] })
export class InboundMessagesModule {}
