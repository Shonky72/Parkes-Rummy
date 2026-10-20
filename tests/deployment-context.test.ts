import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlDatabase } from '../db';
import { ACTIVITY_SCHEMA, ActivityRepository } from '../db/activity';
import type { CompetitionRepository } from '../db/competition';
import type { LadderRepository } from '../db/ladder';
import type { RecordsRepository } from '../db/records';
import type { RequestSecurity } from '../db/security';
import { createCompetitionHandlers } from '../lib/competition-server';
import { deploymentContext, isProductionDeployment } from '../lib/deployment-context';
import { createLadderHandlers } from '../lib/ladder-server';
import { createRecordsHandlers } from '../lib/records-server';
import { recordsCollectionAllowed } from '../lib/room-server';
import { applyAction, createPlayer, createRoom } from '../lib/rummy';

// These tests are deliberately serial: only these two nonsecret deployment
// variables change, and their exact original presence/value is always restored.
async function withContext<T>(build: string | undefined, runtime: string | undefined, work: () => T | Promise<T>): Promise<T> {
  const previousBuild = process.env.PARKES_DEPLOY_CONTEXT;
  const previousRuntime = process.env.CONTEXT;
  const assign = (key: 'PARKES_DEPLOY_CONTEXT' | 'CONTEXT', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  assign('PARKES_DEPLOY_CONTEXT', build);
  assign('CONTEXT', runtime);
  try { return await work(); }
  finally {
    assign('PARKES_DEPLOY_CONTEXT', previousBuild);
    assign('CONTEXT', previousRuntime);
  }
}

function forbiddenDependency<T extends object>(name: string, calls: string[]): T {
  return new Proxy({} as T, {
    get(_target, property) {
      calls.push(`${name}.${String(property)}`);
      throw new Error(`Deployment gate unexpectedly accessed ${name}.${String(property)}`);
    },
  });
}

function anonymousHandlers(enabled?: boolean) {
  const calls: string[] = [];
  const security = forbiddenDependency<RequestSecurity>('security', calls);
  const resolveSession = async () => { calls.push('session'); return null; };
  const override = enabled === undefined ? {} : { enabled };
  return {
    calls,
    records: createRecordsHandlers({
      records: forbiddenDependency<RecordsRepository>('records', calls), security, resolveSession, ...override,
    }),
    competition: createCompetitionHandlers({
      competition: forbiddenDependency<CompetitionRepository>('competition', calls), security, resolveSession, ...override,
    }),
    ladder: createLadderHandlers({
      ladder: forbiddenDependency<LadderRepository>('ladder', calls), security, resolveSession, ...override,
    }),
  };
}

function request(path: string, write = false, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://parkesrummy.com/api/${path}`, {
    method: write ? 'POST' : 'GET',
    headers: { Origin: 'https://parkesrummy.com', 'Content-Type': 'application/json', ...extraHeaders },
    ...(write ? { body: JSON.stringify({ action: 'joinQueue' }) } : {}),
  });
}

async function assertPrivateGate(
  handlers: ReturnType<typeof anonymousHandlers>, expectedStatus: 401 | 409, headers: Record<string, string> = {},
) {
  for (const service of ['records', 'competition', 'ladder'] as const) {
    for (const write of [false, true]) {
      handlers.calls.length = 0;
      const response = await handlers[service][write ? 'mutate' : 'snapshot'](request(service, write, headers));
      assert.equal(response.status, expectedStatus, `${service} ${write ? 'POST' : 'GET'}`);
      const body = await response.json();
      assert.match(body.error, expectedStatus === 401 ? /Sign in with Google/ : /Preview deployments/);
      assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
      assert.equal(response.headers.get('Netlify-CDN-Cache-Control'), 'no-store');
      assert.deepEqual(handlers.calls, expectedStatus === 401 ? ['session'] : [], 'The deployment gate must precede all persistent dependencies.');
    }
  }
}

test('context resolution uses the trusted build stamp, then the unbundled runtime fallback', { concurrency: false }, async () => {
  await withContext(undefined, undefined, () => {
    assert.equal(deploymentContext(), '');
    assert.equal(deploymentContext('production', 'deploy-preview'), 'production');
    assert.equal(deploymentContext('deploy-preview', 'production'), 'deploy-preview');
    assert.equal(deploymentContext('branch-deploy', 'production'), 'branch-deploy');
    assert.equal(deploymentContext('', 'production'), 'production');
    assert.equal(deploymentContext(undefined, 'dev'), 'dev');
    assert.equal(deploymentContext('', ''), '');
    assert.equal(deploymentContext('unrecognized-context', 'production'), 'unrecognized-context');
  });
});

test('only exact production context enables records and competitive defaults', { concurrency: false }, async () => {
  for (const context of ['production', 'deploy-preview', 'branch-deploy', 'dev', 'preview', '', 'Production', 'production ', 'unknown']) {
    for (const source of ['build', 'runtime'] as const) {
      await withContext(source === 'build' ? context : undefined, source === 'runtime' ? context : undefined, () => {
        assert.equal(deploymentContext(), context);
        assert.equal(isProductionDeployment(), context === 'production', `${source}: ${JSON.stringify(context)}`);
        assert.equal(recordsCollectionAllowed(), context === 'production', `${source}: records ${JSON.stringify(context)}`);
      });
    }
  }
  await withContext(undefined, undefined, () => {
    assert.equal(isProductionDeployment(), false);
    assert.equal(recordsCollectionAllowed(), false);
  });
});

test('a captured build context dominates conflicting Functions runtime metadata', { concurrency: false }, async () => {
  for (const [build, runtime, production] of [
    ['production', 'deploy-preview', true], ['production', 'branch-deploy', true],
    ['deploy-preview', 'production', false], ['branch-deploy', 'production', false], ['unknown', 'production', false],
  ] as const) {
    await withContext(build, runtime, () => {
      assert.equal(deploymentContext(), build);
      assert.equal(isProductionDeployment(), production);
      assert.equal(recordsCollectionAllowed(), production);
    });
  }
});

test('production handlers reach ordinary sign-in when Functions lacks CONTEXT', { concurrency: false }, async () => {
  for (const runtime of [undefined, 'deploy-preview', 'branch-deploy']) {
    await withContext('production', runtime, () => assertPrivateGate(anonymousHandlers(), 401));
  }
  await withContext(undefined, 'production', () => assertPrivateGate(anonymousHandlers(), 401));
});

test('missing, preview and branch contexts stop private handlers before session, security or repository access', { concurrency: false }, async () => {
  for (const [build, runtime] of [
    [undefined, undefined], ['', ''], ['deploy-preview', undefined], ['branch-deploy', undefined],
    ['deploy-preview', 'production'], ['branch-deploy', 'production'], ['unknown', 'production'],
    [undefined, 'deploy-preview'], [undefined, 'branch-deploy'], ['Production', undefined],
  ]) {
    await withContext(build, runtime, () => assertPrivateGate(anonymousHandlers(), 409));
  }
});

test('public challenge and record shares stop before rate limiting, session resolution and database access in previews', { concurrency: false }, async () => {
  for (const build of [undefined, 'deploy-preview', 'branch-deploy']) {
    await withContext(build, undefined, async () => {
      const handlers = anonymousHandlers();
      const response = await handlers.competition.challenge(request('competition/challenge/test-token'), 'test-token');
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Preview deployments/);
      assert.equal(response.headers.get('Netlify-CDN-Cache-Control'), 'no-store');
      assert.deepEqual(handlers.calls, []);
      const shared = await handlers.records.shared(request('records/share/test-token'), 'test-token');
      assert.ok(shared instanceof Response);
      assert.equal(shared.status, 409);
      assert.match((await shared.json()).error, /Preview deployments/);
      assert.equal(shared.headers.get('Netlify-CDN-Cache-Control'), 'no-store');
      assert.deepEqual(handlers.calls, []);
    });
  }
});

test('request headers cannot promote a preview or disable a production build', { concurrency: false }, async () => {
  const claims = (context: string) => ({
    CONTEXT: context, PARKES_DEPLOY_CONTEXT: context, 'X-Netlify-Context': context,
    'X-Parkes-Deploy-Context': context, 'X-Nf-Context': context,
  });
  await withContext('deploy-preview', 'production', () => assertPrivateGate(anonymousHandlers(), 409, claims('production')));
  await withContext(undefined, undefined, () => assertPrivateGate(anonymousHandlers(), 409, claims('production')));
  await withContext('production', 'deploy-preview', () => assertPrivateGate(anonymousHandlers(), 401, claims('deploy-preview')));
});

test('explicit injected enablement and records context overrides remain available for isolated fixtures', { concurrency: false }, async () => {
  await withContext('deploy-preview', undefined, async () => {
    assert.equal(recordsCollectionAllowed('production'), true);
    await assertPrivateGate(anonymousHandlers(true), 401);
  });
  await withContext('production', undefined, async () => {
    assert.equal(recordsCollectionAllowed('deploy-preview'), false);
    assert.equal(recordsCollectionAllowed(''), false);
    await assertPrivateGate(anonymousHandlers(false), 409);
  });
});

test('preview game starts issue no activity SQL while a production build with no runtime context records the start', { concurrency: false }, async () => {
  let room = createRoom('DCTX', createPlayer({ id: 'deployment-activity-human', name: 'Synthetic guest', color: 0, tokenHash: 'synthetic-activity-session-hash' }));
  room = applyAction(room, room.hostId, { type: 'addBot', difficulty: 'easy' });
  room = applyAction(room, room.hostId, { type: 'start' });
  const started = room.events.findLast(event => event.type === 'start');
  assert.ok(started, 'The fixture must contain a real engine start event.');
  assert.equal(room.round, 1);
  assert.equal(room.status, 'playing');

  const queries: { sql: string; values?: unknown[] }[] = [];
  let allowSql = false;
  const db: SqlDatabase = {
    async query(sql, values) {
      queries.push({ sql, values });
      assert.ok(allowSql, 'Preview activity must stop before schema initialization or persistence.');
      return { rows: [], rowCount: 0 };
    },
    async transaction() { assert.fail('Recording one activity start does not require a transaction.'); },
  };
  const activity = new ActivityRepository(db);
  for (const build of ['deploy-preview', 'branch-deploy']) {
    await withContext(build, 'production', () => activity.gameStarted(room));
    assert.equal(queries.length, 0, `${build} must override conflicting runtime production metadata.`);
  }
  allowSql = true;
  await withContext('production', undefined, () => activity.gameStarted(room));
  assert.equal(queries.length, 3);
  assert.equal(queries[0].sql, ACTIVITY_SCHEMA);
  assert.match(queries[1].sql, /INSERT INTO activity_meta/);
  assert.match(queries[2].sql, /INSERT INTO activity_game_starts/);
  assert.equal(queries[2].values?.[0], started.at);
});
