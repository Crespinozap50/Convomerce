import { ConfigService } from '@nestjs/config';
import { CommerceEventsWorker } from './commerce-events.worker';

describe('CommerceEventsWorker appointment synchronization', () => {
  const messageConsumer = { consume: jest.fn() };
  const sendConsumer = { consume: jest.fn(), markFailed: jest.fn() };
  const calendar = { syncAppointment: jest.fn().mockResolvedValue({ synced: true }) };
  const loggroOrderSync = { pushOrder: jest.fn().mockResolvedValue({ externalOrderId: 'ext-1' }), markFailed: jest.fn() };
  const worker = new CommerceEventsWorker(
    messageConsumer as never,
    sendConsumer as never,
    new ConfigService({ COMMERCE_WORKER_ENABLED: 'false' }),
    calendar as never,
    loggroOrderSync as never,
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

  it('dispatches order.confirmed events to LoggroOrderSyncService.pushOrder', async () => {
    const result = await (worker as unknown as { process: (job: unknown) => Promise<unknown> }).process({
      name: 'order.confirmed',
      data: { tenantId: 'tenant-1', commercialRequestId: 'request-1' },
    });

    expect(loggroOrderSync.pushOrder).toHaveBeenCalledWith('tenant-1', 'request-1');
    expect(result).toEqual({ duplicate: false });
  });

  it('rejects an incomplete order.confirmed event instead of calling pushOrder with missing data', async () => {
    await expect(
      (worker as unknown as { process: (job: unknown) => Promise<unknown> }).process({
        name: 'order.confirmed',
        data: { tenantId: 'tenant-1' },
      }),
    ).rejects.toThrow(/Incomplete order.confirmed event/);
    expect(loggroOrderSync.pushOrder).not.toHaveBeenCalled();
  });
});
