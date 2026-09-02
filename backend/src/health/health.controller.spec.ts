import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('mantiene liveness aunque una dependencia esté caída', () => {
    const controller = new HealthController({ readiness: jest.fn() } as never);
    expect(controller.liveness()).toEqual({ status: 'alive' });
  });

  it('responde 503 cuando falla una dependencia de readiness', async () => {
    const controller = new HealthController({
      readiness: jest.fn().mockRejectedValue(new Error('detalle interno sensible')),
    } as never);
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
