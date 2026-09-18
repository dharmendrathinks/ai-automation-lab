import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export async function migrate(pool: Pool) {
  const directory = new URL('../../migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(762901)');
    await client.query('CREATE TABLE IF NOT EXISTS lab_migrations (name text PRIMARY KEY, hash text NOT NULL)');
    for (const name of names) {
      const migration = await readFile(new URL(name, directory), 'utf8');
      const hash = createHash('sha256').update(migration).digest('hex');
      const legacyName = name.startsWith('0001_') ? '0001' : name;
      const previous = await client.query<{ hash: string }>('SELECT hash FROM lab_migrations WHERE name = $1 OR name = $2', [name, legacyName]);
      if (previous.rowCount) {
        if (previous.rows[0]?.hash !== hash) throw new Error(`Applied migration ${name} changed; add a new migration instead.`);
      } else {
        await client.query(migration);
        await client.query('INSERT INTO lab_migrations(name, hash) VALUES ($1, $2)', [name, hash]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
