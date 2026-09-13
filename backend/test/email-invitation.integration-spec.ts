import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { TenantUsersService } from '../src/tenant-users/tenant-users.service';

// D-157 (docs/decisions.md): end-to-end proof that a tenant-user invitation
// actually delivers a real email — not just that TenantUsersService calls
// EmailService.send() (already covered at the unit level), but that the
// real SMTP transport really hands it to a real mail server (MailHog,
// docker-compose.yml) and a real message with the real accept link lands
// there. Exercises the service directly (not through the HTTP layer/a real
// login session), same pattern already used by inbound-message.
// integration-spec.ts for a service that needs a real actor identity more
// than it needs a real cookie.
describe('invitación por correo real (D-157)', () => {
  const connectionString = process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const mailhogUrl = `http://localhost:${process.env.MAILHOG_UI_PORT ?? '58025'}`;
  const pool = new Pool({ connectionString });
  const tenantId = '0194f000-0000-7000-8000-000000000001'; // Santos Tacos Robledo (Demo)
  const actorUserId = '0194f000-0000-7000-8000-000000000102'; // owner.restaurante@commerce.test
  const inviteeEmail = `security-review-invite-${Date.now()}@example.com`;
  let app: INestApplication;
  let users: TenantUsersService;
  let invitationId: string | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    process.env.REDIS_HOST ??= 'localhost';
    process.env.REDIS_PORT ??= '56379';
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    process.env.COMMERCE_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    users = app.get(TenantUsersService);
  });

  afterAll(async () => {
    if (invitationId) {
      await pool.query('delete from app.tenant_user_invitations where id = $1', [invitationId]);
    }
    if (app) await app.close();
    await pool.end();
  });

  it('sends a real email through MailHog with a working accept link, naming the real tenant and role', async () => {
    const result = await users.invite(tenantId, actorUserId, inviteeEmail, 'operator');
    invitationId = result.invitationId;

    const messages = await fetchWithRetry(
      `${mailhogUrl}/api/v2/search?kind=to&query=${encodeURIComponent(inviteeEmail)}`,
    );
    expect(messages.total).toBeGreaterThanOrEqual(1);
    const message = messages.items[0];
    expect(message.Content.Headers.Subject[0]).toContain('Santos Tacos Robledo');
    const body: string = message.Content.Body;
    expect(body).toContain('accept-invite?token=');
    expect(body).toContain('operator');
  });

  async function fetchWithRetry(url: string, attempts = 10): Promise<{ total: number; items: { Content: { Headers: { Subject: string[] }; Body: string } }[] }> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(url);
      const body = await response.json();
      if (body.total > 0) return body;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`No MailHog message matched ${url} after ${attempts} attempts`);
  }
});
