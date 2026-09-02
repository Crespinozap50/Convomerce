import { hashSessionToken, readSessionToken, SESSION_COOKIE } from './session-cookie';

describe('session cookie', () => {
  it('extrae únicamente la cookie de sesión esperada', () => {
    const request = { header: () => `theme=dark; ${SESSION_COOKIE}=token%20local; other=value` } as never;
    expect(readSessionToken(request)).toBe('token local');
  });

  it('produce un hash SHA-256 estable sin conservar el token', () => {
    const hash = hashSessionToken('token-secreto');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashSessionToken('token-secreto'));
    expect(hash).not.toContain('token-secreto');
  });
});
