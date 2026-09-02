import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { unauthorized } from '../observability/http-errors';
import { AuthenticatedRequest } from './authenticated-request';
import { LocalAuthService } from './local-auth.service';
import { readSessionToken } from './session-cookie';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly auth: LocalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(request);
    if (!token) throw unauthorized('AUTH_SESSION_REQUIRED', 'Authentication session required');
    const session = await this.auth.resolve(token);
    if (!session) throw unauthorized('AUTH_SESSION_INVALID', 'Invalid or expired session');
    request.actor = {
      userId: session.user_id,
      sessionId: session.session_id,
      sessionExpiresAt: session.expires_at,
      mustChangePassword: session.must_change_password,
    };
    return true;
  }
}
