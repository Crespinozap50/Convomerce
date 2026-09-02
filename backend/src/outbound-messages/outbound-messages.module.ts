import { Module } from '@nestjs/common';
import { OutboundMessagesController } from './outbound-messages.controller';
import { OutboundMessagesService } from './outbound-messages.service';

@Module({
  controllers: [OutboundMessagesController],
  providers: [OutboundMessagesService],
  exports: [OutboundMessagesService],
})
export class OutboundMessagesModule {}
