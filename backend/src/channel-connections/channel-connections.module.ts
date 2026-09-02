import { Module } from '@nestjs/common';
import { ChannelConnectionsService } from './channel-connections.service';
import { ChannelConnectionsController } from './channel-connections.controller';
import { AuthModule } from '../auth/auth.module';
import { CommerceEventsModule } from '../commerce-events/commerce-events.module';

@Module({
  imports: [AuthModule, CommerceEventsModule],
  controllers: [ChannelConnectionsController],
  providers: [ChannelConnectionsService],
  exports: [ChannelConnectionsService],
})
export class ChannelConnectionsModule {}
