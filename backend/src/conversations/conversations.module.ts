import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationInactivityService } from './conversation-inactivity.service';
import { MessageRetentionService } from './message-retention.service';
@Module({imports:[AuthModule],controllers:[ConversationsController],providers:[ConversationsService,ConversationInactivityService,MessageRetentionService]})
export class ConversationsModule {}
