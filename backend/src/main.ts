import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
