import { Module } from '@nestjs/common';
import { InboundMessagesModule } from '../inbound-messages/inbound-messages.module';
import { DeliveryStatusesModule } from '../delivery-statuses/delivery-statuses.module';
import { WebhookAuthService } from './webhook-auth.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [InboundMessagesModule, DeliveryStatusesModule],
  controllers: [WhatsAppWebhookController],
  providers: [WebhookAuthService, WhatsAppWebhookService],
})
export class WhatsAppWebhookModule {}
