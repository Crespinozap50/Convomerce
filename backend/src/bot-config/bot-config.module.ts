import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BotConfigController } from './bot-config.controller';
import { BotConfigService } from './bot-config.service';
@Module({imports:[AuthModule],controllers:[BotConfigController],providers:[BotConfigService]})
export class BotConfigModule{}
