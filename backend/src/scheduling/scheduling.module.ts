import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';
@Module({imports:[AuthModule],controllers:[SchedulingController,GoogleCalendarController],providers:[SchedulingService,GoogleCalendarService],exports:[GoogleCalendarService]})
export class SchedulingModule {}
