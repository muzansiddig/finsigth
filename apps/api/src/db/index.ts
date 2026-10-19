import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required. Add it to your .env file or environment variables.');
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });

export async function checkDatabaseHealth() {
  const result = await pool.query('SELECT 1 as ok');
  return result.rows[0]?.ok === 1;
}

export async function closeDatabase() {
  await pool.end();
}
