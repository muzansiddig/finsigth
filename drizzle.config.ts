import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/finsight';

export default {
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
