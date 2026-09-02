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
    const service = new LocalAuthService(database, { get: () => 8 } as unknown as ConfigService);

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
    const service = new LocalAuthService(database, { get: () => 8 } as unknown as ConfigService);

    await expect(service.login('nadie@example.test', 'Password-Incorrecto-123', null, 'jest'))
      .rejects.toEqual(new UnauthorizedException('Invalid email or password'));
    expect(queries.some((query) => query.sql.includes('record_local_login') && query.values[3] === false)).toBe(true);
    expect(queries.some((query) => query.sql.includes('create_local_session'))).toBe(false);
  });
});
