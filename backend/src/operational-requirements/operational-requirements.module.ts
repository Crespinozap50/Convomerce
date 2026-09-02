import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperationalRequirementsController } from './operational-requirements.controller';
import { OperationalRequirementsService } from './operational-requirements.service';

@Module({
  imports: [AuthModule],
  controllers: [OperationalRequirementsController],
  providers: [OperationalRequirementsService],
  exports: [OperationalRequirementsService],
})
export class OperationalRequirementsModule {}
