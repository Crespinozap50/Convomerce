export type MetaDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ApplyDeliveryStatusCommand {
  tenantId: string;
  channelId: string;
  externalMessageId: string;
  status: MetaDeliveryStatus;
  providerTimestamp?: Date;
  errorCode?: string;
}

export interface ApplyDeliveryStatusResult {
  outcome: 'applied' | 'duplicate' | 'stale' | 'unknown_message';
}
