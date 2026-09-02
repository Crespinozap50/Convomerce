import { ConfigService } from '@nestjs/config';
import { CommerceEventsWorker } from './commerce-events.worker';

describe('CommerceEventsWorker appointment synchronization', () => {
  const messageConsumer = { consume: jest.fn() };
  const sendConsumer = { consume: jest.fn(), markFailed: jest.fn() };
  const calendar = { syncAppointment: jest.fn().mockResolvedValue({ synced: true }) };
  const worker = new CommerceEventsWorker(
    messageConsumer as never,
    sendConsumer as never,
    new ConfigService({ COMMERCE_WORKER_ENABLED: 'false' }),
    calendar as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each(['confirmed', 'rescheduled', 'cancelled'] as const)(
    'synchronizes appointment.%s events with Google Calendar',
    async action => {
      const result = await (worker as unknown as { process: (job: unknown) => Promise<unknown> }).process({
        name: `appointment.${action}`,
        data: { tenantId: 'tenant-1', appointmentId: 'appointment-1' },
      });

      expect(calendar.syncAppointment).toHaveBeenCalledWith('tenant-1', 'appointment-1', action);
      expect(result).toEqual({ duplicate: false });
    },
  );
});
