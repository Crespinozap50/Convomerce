import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { LocalAuthService } from './local-auth.service';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$+pGXH5M5N3CKAIQlJwnPDQ$u/GrIcaoDXLcTDdxm153dSH2Xw+xriyEIM2A3bj7mUA';

describe('LocalAuthService', () => {
  it('crea una sesión opaca después de verificar Argon2id', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, values: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes('get_local_login')) return { rows: [{
          user_id: '0194f000-0000-7000-8000-000000000101',
          password_hash: PASSWORD_HASH,
          must_change_password: true,
          locked_until: null,
        }] };
        return { rows: [] };
      }),
    };
    const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation(client) } as never;
    const service = new LocalAuthService(
      database, { send: jest.fn() } as never, { get: () => 8 } as unknown as ConfigService,
    );

    const result = await service.login(
      'ADMIN@COMMERCE.TEST', 'LocalDemo-ChangeMe-2026!', '127.0.0.1', 'jest',
    );

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.mustChangePassword).toBe(true);
    expect(queries.some((query) => query.sql.includes('record_local_login') && query.values[3] === true)).toBe(true);
    const create = queries.find((query) => query.sql.includes('create_local_session'));
    expect(create?.values[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(create?.values[2]).not.toBe(result.token);
  });

  it('registra el fallo y devuelve un error indistinguible', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, values: unknown[]) => {
        queries.push({ sql, values });
        return { rows: [] };
      }),
    };
    const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation(client) } as never;
    const service = new LocalAuthService(
      database, { send: jest.fn() } as never, { get: () => 8 } as unknown as ConfigService,
    );

    await expect(service.login('nadie@example.test', 'Password-Incorrecto-123', null, 'jest'))
      .rejects.toEqual(new UnauthorizedException('Invalid email or password'));
    expect(queries.some((query) => query.sql.includes('record_local_login') && query.values[3] === false)).toBe(true);
    expect(queries.some((query) => query.sql.includes('create_local_session'))).toBe(false);
  });

  // D-159 (docs/decisions.md): before this, there was no self-service way
  // to recover a forgotten password at all — only hand-editing a hash
  // directly in the database.
  describe('requestPasswordReset', () => {
    it('emails a real reset link when the account exists', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ created: true }] });
      const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation({ query }) } as never;
      const send = jest.fn().mockResolvedValue(undefined);
      const service = new LocalAuthService(
        database, { send } as never,
        { get: (key: string) => (key === 'FRONTEND_ORIGIN' ? 'http://localhost:5173' : 8) } as unknown as ConfigService,
      );

      await service.requestPasswordReset('ADMIN@COMMERCE.TEST', '127.0.0.1');

      expect(send).toHaveBeenCalledTimes(1);
      const [to, , text] = send.mock.calls[0];
      expect(to).toBe('admin@commerce.test');
      expect(text).toContain('http://localhost:5173/reset-password?token=');
    });

    it('never emails anything when the account does not exist, and still resolves normally', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ created: false }] });
      const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation({ query }) } as never;
      const send = jest.fn().mockResolvedValue(undefined);
      const service = new LocalAuthService(database, { send } as never, { get: () => 8 } as unknown as ConfigService);

      await expect(service.requestPasswordReset('nadie@example.test', null)).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('hashes the new password and applies it through the real function', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation({ query }) } as never;
      const service = new LocalAuthService(database, { send: jest.fn() } as never, { get: () => 8 } as unknown as ConfigService);

      await service.resetPassword('a-real-reset-token-value', 'Nueva-Contrasena-Segura-2026!');

      const call = query.mock.calls.find((c) => (c[0] as string).includes('reset_password'));
      expect(call).toBeDefined();
      expect(call?.[1][1]).not.toBe('Nueva-Contrasena-Segura-2026!');
      expect(call?.[1][1]).toMatch(/^\$argon2id\$/);
    });

    it('maps an invalid/expired token (pg 28000) to AUTH_RESET_TOKEN_INVALID, not a raw error', async () => {
      const query = jest.fn().mockRejectedValue(Object.assign(new Error('pg error'), { code: '28000' }));
      const database = { withRuntimeTransaction: (operation: (client: unknown) => unknown) => operation({ query }) } as never;
      const service = new LocalAuthService(database, { send: jest.fn() } as never, { get: () => 8 } as unknown as ConfigService);

      await expect(
        service.resetPassword('an-expired-or-forged-token', 'Nueva-Contrasena-Segura-2026!'),
      ).rejects.toMatchObject({ response: { code: 'AUTH_RESET_TOKEN_INVALID' } });
    });
  });
});
