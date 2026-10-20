/**
 * Real PostgreSQL concurrency acceptance, deliberately separate from PGlite.
 *
 * Run: PARKES_SCHEMA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
 *      node --import tsx tests/schema-startup-postgres.mjs
 *
 * The explicit URL must address a local test service with CREATEDB permission.
 * DATABASE_URL is never read. Only randomly named databases created by this
 * process are bootstrapped or dropped; the connection database is untouched.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { RECORDS_SCHEMA, RecordsRepository } from '../db/records.ts';
import { COMPETITION_SCHEMA, CompetitionRepository } from '../db/competition.ts';
import { LADDER_SCHEMA, ensureLadderSchema } from '../db/ladder.ts';

const LOCK = [1346458187, 1];
const WORKERS = 12;
const reportPath = resolve(process.env.PARKES_SCHEMA_TEST_REPORT || 'schema-startup-results/checks.json');
const started = performance.now();
const report = {
  startedAt: new Date().toISOString(), node: process.version, kind: 'real-postgresql-local-only',
  caveat: 'Isolated PostgreSQL fixtures. This reproduces a startup race, but the suppressed production SQLSTATE means the production incident cause remains an inference.',
  checks: [], temporaryDatabases: [], cleanup: [],
};

function serviceConfig() {
  const input = process.env.PARKES_SCHEMA_TEST_DATABASE_URL;
  assert(input, 'Set PARKES_SCHEMA_TEST_DATABASE_URL to an isolated localhost PostgreSQL test service. DATABASE_URL is intentionally ignored.');
  const url = new URL(input);
  assert(['postgresql:', 'postgres:'].includes(url.protocol), 'Expected a PostgreSQL test URL.');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Refusing a non-local PostgreSQL host.');
  assert(!url.search && !url.hash, 'Test URLs may not override connection settings using query parameters or fragments.');
  assert(url.username, 'An explicit local test database user is required.');
  const port = Number(url.port || 5432);
  assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid local test port.');
  return {
    // Resolve localhost ourselves rather than accepting environment or DNS host overrides.
    host: url.hostname === '[::1]' ? '::1' : '127.0.0.1', port,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres', ssl: false,
    application_name: 'parkes-schema-startup-test', connectionTimeoutMillis: 5000,
    statement_timeout: 15000, query_timeout: 20000,
  };
}

const schemas = { records: RECORDS_SCHEMA, competition: COMPETITION_SCHEMA, ladder: LADDER_SCHEMA };
const lockStatement = 'PERFORM pg_advisory_xact_lock(1346458187,1);';
for (const [name, sql] of Object.entries(schemas)) {
  assert.equal(sql.split(lockStatement).length, 2, `${name} must acquire the shared transaction lock exactly once.`);
  assert(sql.indexOf(lockStatement) < sql.indexOf('CREATE TABLE'), `${name} must lock before inspecting or creating tables.`);
}
report.schemaSha256 = Object.fromEntries(Object.entries(schemas).map(([name, sql]) => [name, createHash('sha256').update(sql).digest('hex')]));
const unlockedRecords = RECORDS_SCHEMA.replace(lockStatement, '');
const expectedTables = [...new Set(Object.values(schemas).flatMap(sql => [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(match => match[1])))].sort();
const provisioning = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const firstCommit = provisioning.indexOf('COMMIT;');
assert(firstCommit > 0, 'The base provisioning transaction must have a closing COMMIT.');
const baseSchema = provisioning.slice(0, firstCommit + 'COMMIT;'.length);
assert(baseSchema.includes('CREATE TABLE IF NOT EXISTS "user"') && baseSchema.includes('CREATE TABLE IF NOT EXISTS rooms'), 'Base bootstrap must contain the real account and room tables.');
assert(!baseSchema.includes('records_profiles'), 'Concurrency fixtures must not pre-create the gamification schemas.');

let config;
let admin;
const databases = new Set();
const databasePrefix = `parkes_schema_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;

function errorInfo(error) {
  return { name: error?.name, code: error?.code ?? null, message: String(error?.message || error), constraint: error?.constraint ?? null };
}
function capture(promise) {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}
async function connect(database) {
  const client = new pg.Client({ ...config, ...(database ? { database } : {}) });
  await client.connect();
  return client;
}
async function check(name, work) {
  const at = performance.now();
  try {
    const details = await work();
    report.checks.push({ name, passed: true, durationMs: Math.round((performance.now() - at) * 100) / 100, ...details });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Math.round((performance.now() - at) * 100) / 100, error: errorInfo(error) });
    throw error;
  }
}
async function dropDatabase(name) {
  assert(databases.has(name) && name.startsWith(`${databasePrefix}_`) && /^[a-z0-9_]+$/.test(name), 'Refusing to drop a database not created by this test.');
  // FORCE affects only connections to this randomly named fixture database.
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  databases.delete(name);
  report.cleanup.push({ database: name, dropped: true });
}
async function fixture(label, work) {
  const name = `${databasePrefix}_${label}`;
  assert(/^[a-z0-9_]+$/.test(name) && name.length <= 63);
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  databases.add(name);
  report.temporaryDatabases.push(name);
  const clients = [];
  const open = async () => {
    const client = await connect(name);
    clients.push(client);
    return client;
  };
  try {
    const bootstrap = await open();
    await bootstrap.query(baseSchema);
    const absent = await bootstrap.query("SELECT count(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", [expectedTables]);
    assert.equal(absent.rows[0].count, 0, 'Every fixture starts without gamification tables.');
    return await work({ name, open, observer: bootstrap });
  } finally {
    // End waits for any accepted query, bounded by each client's statement timeout.
    await Promise.allSettled(clients.map(client => client.end()));
    await dropDatabase(name);
  }
}
async function blockedBy(observer, pids, ownerPid, advisory) {
  const until = performance.now() + 7000;
  let rows = [];
  do {
    rows = (await observer.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity WHERE pid=ANY($1::int[]) ORDER BY pid`, [pids])).rows;
    if (rows.length === pids.length && rows.every(row => row.blockers.includes(ownerPid) && (!advisory || row.wait_event === 'advisory'))) return rows;
    await delay(20);
  } while (performance.now() < until);
  assert.fail(`Expected ${pids.length} independent blocked backends; observed ${JSON.stringify(rows)}`);
}
async function noAdvisoryLocks(observer) {
  const result = await observer.query(`SELECT pid,mode,granted FROM pg_locks
    WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  assert.deepEqual(result.rows, [], 'Transaction advisory locks must not survive success, rollback, or a failed initializer.');
}
async function tableIdentity(observer) {
  const tables = (await observer.query(`SELECT relname,oid::text FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname=ANY($1::text[]) ORDER BY relname`, [expectedTables])).rows;
  assert.deepEqual(tables.map(table => table.relname), expectedTables);
  assert.equal((await observer.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname='ladder_players_active_match_fk'")).rows[0].count, 1);
  assert.equal((await observer.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='ladder_deleted_match_cleanup_trigger'")).rows[0].count, 1);
  assert.equal((await observer.query('SELECT count(*)::int AS count FROM ladder_queue_lock WHERE id=1')).rows[0].count, 1);
  return tables;
}
function adapter(client) {
  const calls = { records: 0, competition: 0, ladder: 0 };
  const db = {
    calls,
    async query(sql, values) {
      for (const [name, schema] of Object.entries(schemas)) if (sql === schema) calls[name]++;
      return client.query(sql, values);
    },
    async transaction(work) {
      await client.query('BEGIN');
      try {
        const result = await work(db);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
  return db;
}
function initializer(client, index) {
  const db = adapter(client);
  const records = new RecordsRepository(db);
  const competition = new CompetitionRepository(db);
  const tasks = [() => records.ensure(), () => competition.ensure(), () => ensureLadderSchema(db)];
  return {
    db, client,
    async run() {
      // Mixed entry paths emulate workers first reached through different APIs.
      for (let offset = 0; offset < tasks.length; offset++) await tasks[(index + offset) % tasks.length]();
    },
  };
}

try {
  config = serviceConfig();
  admin = await connect();
  report.serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
  report.service = { host: config.host, port: config.port, credentialsPublished: false };

  await check('original unguarded DDL reproduces the cross-connection race', () => fixture('unguarded', async ({ open, observer }) => {
    const first = await open();
    const second = await open();
    await first.query('BEGIN');
    try {
      await first.query(unlockedRecords);
      const attempt = capture(second.query(unlockedRecords));
      const waiting = await blockedBy(observer, [second.processID], first.processID, false);
      assert.notEqual(waiting[0].wait_event, 'advisory', 'The original query must be blocked by DDL, not the new advisory lock.');
      await first.query('COMMIT');
      const outcome = await attempt;
      assert.equal(outcome.ok, false, 'The deliberately overlapping original initializers must reproduce a real PostgreSQL error.');
      assert(['23505', '42P07'].includes(outcome.error.code), `Expected a duplicate object race, received ${outcome.error.code}.`);
      await second.query(unlockedRecords);
      await noAdvisoryLocks(observer);
      return { backendPids: [first.processID, second.processID], observedWait: waiting[0].wait_event, reproducedError: errorInfo(outcome.error), retrySucceeded: true };
    } finally { await first.query('ROLLBACK'); }
  }));

  await check('guarded DDL waits before catalog checks and succeeds after commit', () => fixture('guarded', async ({ open, observer }) => {
    const first = await open();
    const second = await open();
    await first.query('BEGIN');
    try {
      await first.query(RECORDS_SCHEMA);
      const attempt = capture(second.query(RECORDS_SCHEMA));
      const waiting = await blockedBy(observer, [second.processID], first.processID, true);
      const lock = await observer.query("SELECT granted,classid::bigint AS namespace,objid::bigint AS key,objsubid FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [second.processID]);
      assert.equal(lock.rows.length, 1);
      assert.equal(lock.rows[0].granted, false);
      assert.equal(Number(lock.rows[0].namespace), LOCK[0]);
      assert.equal(Number(lock.rows[0].key), LOCK[1]);
      assert.equal(lock.rows[0].objsubid, 2);
      await first.query('COMMIT');
      const outcome = await attempt;
      assert(outcome.ok, outcome.ok ? undefined : outcome.error.message);
      await second.query(RECORDS_SCHEMA);
      await noAdvisoryLocks(observer);
      return { backendPids: [first.processID, second.processID], observedWait: waiting[0].wait_event, sharedLock: LOCK, retrySucceeded: true, locksRemaining: 0 };
    } finally { await first.query('ROLLBACK'); }
  }));

  await check('guarded DDL also releases the lock and creates tables after rollback', () => fixture('rollback', async ({ open, observer }) => {
    const first = await open();
    const second = await open();
    await first.query('BEGIN');
    try {
      await first.query(RECORDS_SCHEMA);
      const attempt = capture(second.query(RECORDS_SCHEMA));
      await blockedBy(observer, [second.processID], first.processID, true);
      await first.query('ROLLBACK');
      const outcome = await attempt;
      assert(outcome.ok, outcome.ok ? undefined : outcome.error.message);
      assert.equal((await second.query("SELECT to_regclass('records_evidence') IS NOT NULL AS present")).rows[0].present, true);
      await noAdvisoryLocks(observer);
      return { rollbackReleasedLock: true, waitingWorkerCreatedSchema: true, locksRemaining: 0 };
    } finally { await first.query('ROLLBACK'); }
  }));

  await check('12 cold repository workers initialize all three releases and reinitialize safely', () => fixture('workers', async ({ open, observer }) => {
    const holder = await open();
    const workers = await Promise.all(Array.from({ length: WORKERS }, async (_, index) => initializer(await open(), index)));
    assert.equal(new Set(workers.map(worker => worker.client.processID)).size, WORKERS);
    await holder.query('BEGIN');
    let initial;
    try {
      await holder.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', LOCK);
      // No gamification DDL has run yet. All 12 real entry paths must queue here.
      initial = Promise.all(workers.map(worker => capture(worker.run())));
      await blockedBy(observer, workers.map(worker => worker.client.processID), holder.processID, true);
      await holder.query('COMMIT');
      const outcomes = await initial;
      assert.deepEqual(outcomes.filter(outcome => !outcome.ok).map(outcome => errorInfo(outcome.error)), []);
      assert(workers.every(worker => Object.values(worker.db.calls).every(count => count >= 1)), 'Every worker must invoke all three actual schema initializers.');
      const identity = await tableIdentity(observer);
      await noAdvisoryLocks(observer);
      const queriesBefore = workers.map(worker => ({ ...worker.db.calls }));
      await Promise.all(workers.map(worker => worker.run()));
      assert.deepEqual(workers.map(worker => worker.db.calls), queriesBefore, 'Successful same-worker readiness should remain cached.');

      // New connections and new repository/database objects model a later cold start.
      const restarted = await Promise.all(Array.from({ length: WORKERS }, async (_, index) => initializer(await open(), index + 1)));
      assert(restarted.every(worker => !workers.some(first => first.client.processID === worker.client.processID)));
      const repeated = await Promise.all(restarted.map(worker => capture(worker.run())));
      assert.deepEqual(repeated.filter(outcome => !outcome.ok).map(outcome => errorInfo(outcome.error)), []);
      assert(restarted.every(worker => Object.values(worker.db.calls).every(count => count >= 1)));
      assert.deepEqual(await tableIdentity(observer), identity, 'Cold reinitialization must preserve existing table identities.');
      await noAdvisoryLocks(observer);
      return {
        simultaneousWorkers: WORKERS, firstBackendPids: workers.map(worker => worker.client.processID),
        restartedBackendPids: restarted.map(worker => worker.client.processID),
        initialSchemaQueries: queriesBefore, restartedSchemaQueries: restarted.map(worker => worker.db.calls),
        tableCount: identity.length, tables: identity.map(table => table.relname),
        sameWorkerCacheVerified: true, existingTablesPreserved: true, locksRemaining: 0,
      };
    } finally {
      await holder.query('ROLLBACK');
      if (initial) await initial;
    }
  }));

  await check('each repository retries on the same instance after a real lock timeout', () => fixture('retries', async ({ open, observer }) => {
    const holder = await open();
    const retryResults = [];
    for (const kind of Object.keys(schemas)) {
      const client = await open();
      const db = adapter(client);
      const repository = kind === 'records' ? new RecordsRepository(db) : kind === 'competition' ? new CompetitionRepository(db) : null;
      const ensure = () => repository ? repository.ensure() : ensureLadderSchema(db);
      await holder.query('BEGIN');
      try {
        await holder.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', LOCK);
        await client.query("SET lock_timeout='150ms'");
        const failed = await capture(ensure());
        assert.equal(failed.ok, false, `${kind} must experience the actual blocked-query timeout.`);
        assert.equal(failed.error.code, '55P03');
        await holder.query('ROLLBACK');
        await client.query("SET lock_timeout='0'");
        await ensure();
        await ensure();
        await noAdvisoryLocks(observer);
        retryResults.push({ repository: kind, failedSqlstate: failed.error.code, sameInstanceRetrySucceeded: true, locksRemaining: 0 });
      } finally { await holder.query('ROLLBACK'); }
    }
    await tableIdentity(observer);
    return { repositories: retryResults };
  }));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = errorInfo(error);
  console.error(`FAIL ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (admin) {
    for (const name of [...databases]) {
      try { await dropDatabase(name); }
      catch (error) {
        report.cleanup.push({ database: name, dropped: false, error: errorInfo(error) });
        report.passed = false;
        process.exitCode = 1;
      }
    }
    await admin.end();
  }
  report.durationMs = Math.round((performance.now() - started) * 100) / 100;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed ? 'PASS' : 'FAIL'} schema startup acceptance: ${report.checks.filter(check => check.passed).length}/${report.checks.length} checks. Report: ${reportPath}`);
}
