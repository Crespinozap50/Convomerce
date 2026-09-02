/** Interactive presentation independent from Meta and the commercial domain. */
export type InteractiveMessage = ReplyButtonsMessage | SelectionListMessage;

export interface InteractiveOption {
  /** Stable identifier for logic; it must not depend on visible copy. */
  id: string;
  title: string;
  description?: string;
}

export interface ReplyButtonsMessage {
  type: 'buttons';
  body: string;
  options: InteractiveOption[];
  footer?: string;
}

export interface SelectionListMessage {
  type: 'list';
  body: string;
  buttonLabel: string;
  options: InteractiveOption[];
  footer?: string;
}

export interface InboundInteractiveSelection {
  type: 'button' | 'list';
  id: string;
  title: string;
  description?: string;
}

export type OutboundMessageContent =
  | { type: 'text'; body: string }
  | { type: 'interactive'; interactive: InteractiveMessage };

export function validateInteractiveMessage(message: InteractiveMessage): void {
  const maximum = message.type === 'buttons' ? 3 : 10;
  if (!message.body.trim()) throw new Error('Interactive message body is required');
  if (message.options.length < 1 || message.options.length > maximum) {
    throw new Error(`${message.type} messages require between 1 and ${maximum} options`);
  }
  if (new Set(message.options.map((option) => option.id)).size !== message.options.length) {
    throw new Error('Interactive option identifiers must be unique');
  }
  if (message.type === 'list' && (!message.buttonLabel.trim() || message.buttonLabel.length > 20)) {
    throw new Error('List button labels are required and cannot exceed 20 characters');
  }
  for (const option of message.options) {
    if (!option.id.trim() || !option.title.trim()) throw new Error('Interactive options require id and title');
    if (message.type === 'buttons' && option.title.length > 20) {
      throw new Error('Reply button titles cannot exceed 20 characters');
    }
    if (message.type === 'list' && option.title.length > 24) {
      throw new Error('List row titles cannot exceed 24 characters');
    }
    if (message.type === 'list' && option.description && option.description.length > 72) {
      throw new Error('List row descriptions cannot exceed 72 characters');
    }
  }
}

export function selectionAsNaturalText(selection: InboundInteractiveSelection): string {
  return selection.title.trim();
}
