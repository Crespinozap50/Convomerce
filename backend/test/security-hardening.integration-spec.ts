import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';

// D-154 (docs/decisions.md): /v1/auth/login had an account lockout (5
// attempts) but no per-IP request-volume limit at all, letting an attacker
// relock a known admin account indefinitely at near-zero cost, or spray one
// guess each across many accounts without ever tripping a single lockout.
// The other D-154 finding (the dev message-injection harness closing on
// NODE_ENV alone) is covered at the unit level instead — ConfigModule
// validates and freezes DEV_HARNESS_ENABLED once at bootstrap, so toggling
// process.env mid-test against one already-compiled app can't exercise
// both the open and closed cases the way this file's login test can.
describe('security hardening (D-154): login throttling', () => {
  const connectionString = process.env.DATABASE_URL ??
    'postgresql://postgres:local_postgres_only@localhost:54329/whatsapp_commerce';
  const pool = new Pool({ connectionString });
  const throttledEmail = `security-review-${Date.now()}@commerce.test`;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = connectionString;
    process.env.REDIS_HOST ??= 'localhost';
    process.env.REDIS_PORT ??= '56379';
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    process.env.COMMERCE_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await pool.query('delete from app.login_attempts where normalized_email = $1', [throttledEmail]);
    if (app) await app.close();
    await pool.end();
  });

  it('throttles rapid login attempts from the same client instead of allowing unlimited volume', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: throttledEmail, password: 'wrong-password-attempt' });
      expect(response.status).toBe(401);
    }
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: throttledEmail, password: 'wrong-password-attempt' })
      .expect(429);
  });
});
