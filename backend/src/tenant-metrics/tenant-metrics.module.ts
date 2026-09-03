import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantMetricsController } from './tenant-metrics.controller';
import { TenantMetricsService } from './tenant-metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantMetricsController],
  providers: [TenantMetricsService],
})
export class TenantMetricsModule {}
