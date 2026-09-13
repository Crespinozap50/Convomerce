import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Security review, this session: trivial framework fingerprinting
  // (X-Powered-By) and two headers that cost nothing and rule out whole
  // classes of browser-side attacks (MIME-sniffing a response into
  // executable content; the admin panel being framed by another site for
  // clickjacking). No HSTS here on purpose — this server isn't behind
  // HTTPS yet (see docs/decisions.md D-154's NODE_ENV note), and adding it
  // now would be a no-op at best, misleading at worst.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  const configuredOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  const developmentOrigins = new Set([
    configuredOrigin,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);

  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? configuredOrigin
        : (
            origin: string | undefined,
            callback: (error: Error | null, allow?: boolean) => void,
          ) => {
            if (!origin || developmentOrigins.has(origin)) {
              callback(null, true);
              return;
            }

            callback(new Error('Origin is not allowed by CORS'), false);
          },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
