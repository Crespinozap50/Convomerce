import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PasswordReadyGuard } from './password-ready.guard';

describe('PasswordReadyGuard', () => {
  const context = (mustChangePassword: boolean) => ({
    switchToHttp: () => ({ getRequest: () => ({ actor: { mustChangePassword } }) }),
  }) as unknown as ExecutionContext;

  it('bloquea el panel mientras la contraseña sea temporal', () => {
    expect(() => new PasswordReadyGuard().canActivate(context(true)))
      .toThrow(new ForbiddenException('You must change the temporary password before continuing'));
  });

  it('permite continuar después del cambio', () => {
    expect(new PasswordReadyGuard().canActivate(context(false))).toBe(true);
  });
});
