import { createHash } from 'node:crypto';
import { Request, Response } from 'express';

export const SESSION_COOKIE = 'wc_session';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function readSessionToken(request: Request): string | null {
  const header = request.header('cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookie(
  response: Response, token: string, expiresAt: Date, secure: boolean,
): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
  });
}
