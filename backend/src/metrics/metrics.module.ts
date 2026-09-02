import { Global, Module } from '@nestjs/common';
import { MetricsAuthService } from './metrics-auth.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAuthService],
  exports: [MetricsService],
})
export class MetricsModule {}
