import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosIntegrationsModule } from '../pos-integrations/pos-integrations.module';
import { CommercialRequestsController } from './commercial-requests.controller';
import { CommercialRequestsService } from './commercial-requests.service';
import { OperationalLifecycleService } from './operational-lifecycle.service';

@Module({ imports: [AuthModule, PosIntegrationsModule], controllers: [CommercialRequestsController], providers: [CommercialRequestsService,OperationalLifecycleService] })
export class CommercialRequestsModule {}
