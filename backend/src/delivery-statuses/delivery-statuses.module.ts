import { Module } from '@nestjs/common';
import { DeliveryStatusesService } from './delivery-statuses.service';

@Module({ providers: [DeliveryStatusesService], exports: [DeliveryStatusesService] })
export class DeliveryStatusesModule {}
