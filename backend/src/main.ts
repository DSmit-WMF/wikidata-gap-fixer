import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import type { Store } from 'express-session';
import { ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('express-session') as typeof import('express-session');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const connectPgSimple = require('connect-pg-simple') as (
  s: typeof session,
) => new (options: {
  conObject: { connectionString: string };
  createTableIfMissing?: boolean;
}) => Store;

const PG_SESSION_DEFAULT_URL =
  'postgres://wikidata_gap_fixer:secret@localhost:5432/wikidata_gap_fixer';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  const PgSessionStore = connectPgSimple(session);
  const store: Store = new PgSessionStore({
    conObject: {
      connectionString: process.env.DATABASE_URL ?? PG_SESSION_DEFAULT_URL,
    },
    createTableIfMissing: true,
  });

  app.use(
    session({
      store,
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
    }),
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
void bootstrap();
