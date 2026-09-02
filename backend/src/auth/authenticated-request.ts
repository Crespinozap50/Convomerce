import { Request } from 'express';

export interface AuthenticatedActor {
  userId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  mustChangePassword: boolean;
}

export type AuthenticatedRequest = Request & { actor: AuthenticatedActor };
