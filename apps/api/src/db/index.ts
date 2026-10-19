import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;
const localDevelopmentDatabaseUrl = 'postgresql://postgres:postgres@127.0.0.1:55432/finsight';
const effectiveConnectionString = connectionString ??
  (process.env.NODE_ENV === 'production' ? undefined : localDevelopmentDatabaseUrl);

export const pool = new Pool({
  ...(effectiveConnectionString ? { connectionString: effectiveConnectionString } : {}),
  max: 10,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });

export async function checkDatabaseHealth() {
  if (!effectiveConnectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  }
  const result = await pool.query('SELECT 1 as ok');
  return result.rows[0]?.ok === 1;
}

export async function closeDatabase() {
  await pool.end();
}
