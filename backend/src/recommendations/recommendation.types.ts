import { InteractiveMessage } from '../interactive-messages/interactive-message.types';

export interface RecommendedItem {
  eventId: string;
  variantId: string;
  itemName: string;
  variantName: string;
  priceMinor: string;
  currency: string;
  interactive: InteractiveMessage;
}

export type AcceptedRecommendation = Omit<RecommendedItem, 'interactive'>;
