import { readFile } from 'node:fs/promises';
import { getPool } from '../db/index';

// Run with DATABASE_URL supplied by the hosting environment, or paste
// db/schema.sql into Neon's SQL editor. No public bootstrap endpoint exists.
async function main() {
  const pool = getPool();
  try {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    console.log('Parkes Rummy database schema is ready.');
  } finally { await pool.end(); }
}
main().catch(() => { console.error('Database setup did not complete. Check the database connection and permissions.'); process.exitCode = 1; });
