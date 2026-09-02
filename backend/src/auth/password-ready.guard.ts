import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { forbidden } from '../observability/http-errors';
import { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class PasswordReadyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.actor.mustChangePassword) {
      throw forbidden('AUTH_PASSWORD_CHANGE_REQUIRED', 'You must change the temporary password before continuing');
    }
    return true;
  }
}
