import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : 'postgresql://postgres:postgres@127.0.0.1:55432/finsight');
if (!databaseUrl) throw new Error('DATABASE_URL is required for production migrations.');

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
