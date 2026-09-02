import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  liveness() {
    return { status: 'alive' as const };
  }

  @Get('ready')
  async readiness() {
    try {
      return await this.health.readiness();
    } catch {
      throw new ServiceUnavailableException('Dependencies unavailable');
    }
  }
}
