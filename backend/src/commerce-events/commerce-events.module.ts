import { Module } from "@nestjs/common";
import { CommerceEventsWorker } from "./commerce-events.worker";
import { MessageReceivedConsumer } from "./message-received.consumer";
import { SendRequestedConsumer } from "./send-requested.consumer";
import {
  EncryptedChannelSecretProvider,
  FixtureWhatsAppAdapter,
  MetaWhatsAppAdapter,
  WHATSAPP_ADAPTER,
} from "./whatsapp-adapter";
import { ConfigService } from "@nestjs/config";
import { SECRET_PROVIDER } from "../secrets/secret-provider";
import { DeterministicReplyService } from "./deterministic-reply.service";
import { CommercialFlowService } from "./commercial-flow.service";
import { AppointmentFlowService } from "./appointment-flow.service";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { RecommendationService } from "../recommendations/recommendation.service";
import { DeterministicUnderstandingProvider } from "../conversation-understanding/deterministic-understanding.provider";
import { CONVERSATION_UNDERSTANDING_PROVIDER } from "../conversation-understanding/conversation-understanding.types";
import { ConversationDecisionEngine } from "../conversation-decisions/conversation-decision.engine";
import { LocalizedResponseComposer } from "../response-composition/localized-response.composer";
import { NaturalResponseRewriter } from "../response-composition/natural-response.rewriter";
import { AiUsageBudgetService } from "../response-composition/ai-usage-budget.service";
import { ApprovedResponseVariantService } from "../response-composition/approved-response-variant.service";
import { ConversationLanguageService } from "../localization/conversation-language.service";
import { OperationalRequirementsModule } from "../operational-requirements/operational-requirements.module";

@Module({
  imports: [SchedulingModule, OperationalRequirementsModule],
  providers: [
    MessageReceivedConsumer,
    DeterministicReplyService,
    CommercialFlowService,
    AppointmentFlowService,
    RecommendationService,
    DeterministicUnderstandingProvider,
    {
      provide: CONVERSATION_UNDERSTANDING_PROVIDER,
      useExisting: DeterministicUnderstandingProvider,
    },
    ConversationDecisionEngine,
    LocalizedResponseComposer,
    NaturalResponseRewriter,
    AiUsageBudgetService,
    ApprovedResponseVariantService,
    ConversationLanguageService,
    SendRequestedConsumer,
    FixtureWhatsAppAdapter,
    EncryptedChannelSecretProvider,
    { provide: SECRET_PROVIDER, useExisting: EncryptedChannelSecretProvider },
    MetaWhatsAppAdapter,
    {
      provide: WHATSAPP_ADAPTER,
      inject: [ConfigService, FixtureWhatsAppAdapter, MetaWhatsAppAdapter],
      useFactory: (
        config: ConfigService,
        fixture: FixtureWhatsAppAdapter,
        meta: MetaWhatsAppAdapter,
      ) =>
        config.get<string>("WHATSAPP_ADAPTER_MODE", "fixture") === "meta"
          ? meta
          : fixture,
    },
    CommerceEventsWorker,
  ],
  exports: [
    MessageReceivedConsumer,
    SendRequestedConsumer,
    CommerceEventsWorker,
    WHATSAPP_ADAPTER,
    SECRET_PROVIDER,
  ],
})
export class CommerceEventsModule {}
