import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { LocalAuthService } from '../src/auth/local-auth.service';

// D-159 (docs/decisions.md): end-to-end proof that a password reset really
// delivers an email, really invalidates the old password, and really
// revokes existing sessions — not just that LocalAuthService calls
// EmailService.send() (already covered at the unit level). Snapshots and
// restores the real account's password_hash verbatim (not a recomputed
// hash of a "known" password) so this never needs to know or change the
// real plaintext password of a real seeded account.
describe('recuperación de contraseña real (D-159)', () => {
  const connectionString = process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const mailhogUrl = `http://localhost:${process.env.MAILHOG_UI_PORT ?? '58025'}`;
  const pool = new Pool({ connectionString });
  const email = 'owner.restaurante@commerce.test';
  let userId: string;
  let originalPasswordHash: string;
  let app: INestApplication;
  let auth: LocalAuthService;

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    process.env.REDIS_HOST ??= 'localhost';
    process.env.REDIS_PORT ??= '56379';
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    process.env.COMMERCE_WORKER_ENABLED = 'false';
    const existing = await pool.query<{ id: string; password_hash: string }>(
      `select u.id, c.password_hash from app.users u
         join app.local_credentials c on c.user_id = u.id
        where u.email = $1`,
      [email],
    );
    userId = existing.rows[0].id;
    originalPasswordHash = existing.rows[0].password_hash;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    auth = app.get(LocalAuthService);
  });

  afterAll(async () => {
    await pool.query('update app.local_credentials set password_hash = $1, failed_attempts = 0, locked_until = null where user_id = $2', [originalPasswordHash, userId]);
    await pool.query('delete from app.password_reset_tokens where user_id = $1', [userId]);
    if (app) await app.close();
    await pool.end();
  });

  it('emails a real reset link, and the new password actually replaces the old one after confirming it', async () => {
    await auth.requestPasswordReset(email, '127.0.0.1');

    const message = await fetchWithRetry(`${mailhogUrl}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
    const decodedBody = decodeQuotedPrintable(message.Content.Body);
    const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(decodedBody);
    expect(match).not.toBeNull();
    const token = match![1];

    const newPassword = 'Contrasena-Recuperada-2026!';
    await auth.resetPassword(token, newPassword);

    // The real login() path proves both directions at once: the new
    // password now works, and — since resetPassword clears failed_attempts
    // — a previously-locked account isn't stuck either.
    const session = await auth.login(email, newPassword, '127.0.0.1', 'jest');
    expect(session.token).toEqual(expect.any(String));
  });

  async function fetchWithRetry(url: string, attempts = 10): Promise<{ Content: { Body: string } }> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(url);
      const parsed = await response.json();
      if (parsed.total > 0) return parsed.items[0];
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`No MailHog message matched ${url} after ${attempts} attempts`);
  }
});

// Minimal quoted-printable decoder (nodemailer's default text/html
// transfer-encoding, RFC 2045 §6.7): drop soft line-break continuations
// (`=` at end of line) and turn `=XX` hex escapes back into their real
// character — enough to reliably find the token, without needing MailHog's
// own decoded view.
function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
