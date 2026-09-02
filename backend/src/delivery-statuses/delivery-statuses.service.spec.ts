import { canApplyDeliveryStatus } from './delivery-statuses.service';

describe('canApplyDeliveryStatus', () => {
  it.each([
    ['sent', 'delivered', true],
    ['sent', 'read', true],
    ['delivered', 'read', true],
    ['read', 'delivered', false],
    ['delivered', 'sent', false],
    ['sent', 'failed', true],
    ['delivered', 'failed', false],
    ['failed', 'read', false],
    ['read', 'read', false],
  ] as const)('%s → %s = %s', (current, next, expected) => {
    expect(canApplyDeliveryStatus(current, next)).toBe(expected);
  });
});
