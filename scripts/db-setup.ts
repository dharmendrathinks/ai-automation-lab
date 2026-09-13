import { connect } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { db, pool } = connect(process.env.DATABASE_URL);
try {
  await migrate(pool);
  await seed(db);
  console.log('Applied migrations and synthetic baseline fixtures.');
} finally { await pool.end(); }
