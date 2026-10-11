import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';

export class DatabaseUnavailableError extends Error {
  constructor() { super('The game server is being set up. Please try again shortly.'); this.name = 'DatabaseUnavailableError'; }
}
export interface SqlConnection {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
export interface SqlDatabase extends SqlConnection {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T>;
}
let pool: Pool | undefined;
export function getPool() {
  if (!process.env.DATABASE_URL?.trim()) throw new DatabaseUnavailableError();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL, max: 5,
      idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000, allowExitOnIdle: true,
    });
    pool.on('error', () => { console.error('Parkes Rummy database connection interrupted'); });
  }
  return pool;
}
/** Keep transactions on one connection; a pool.query sequence is not a transaction. */
export const database: SqlDatabase = {
  query: (sql, values) => getPool().query(sql, values),
  async transaction(work) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  },
};
