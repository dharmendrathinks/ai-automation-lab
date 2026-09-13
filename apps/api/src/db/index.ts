import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export function connect(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
export type Database = ReturnType<typeof connect>['db'];
