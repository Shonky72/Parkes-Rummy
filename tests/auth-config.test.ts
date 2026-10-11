import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthConfig } from '../lib/auth-config';
import { createRoomHandlers } from '../lib/room-server';

// Deliberately nonfunctional fixtures; no production credentials are generated.
const complete = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://fixture.invalid/fixture',
  BETTER_AUTH_URL: 'https://parkesrummy.com', GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'not-a-real-client-secret', BETTER_AUTH_SECRET: 'nonfunctional-test-only-value-1234567890',
};
test('Google stays disabled until every required setting exists', () => {
  assert.equal(readAuthConfig({}), null);
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET']) {
    assert.equal(readAuthConfig({ ...complete, [key]: '' }), null, key);
  }
  assert.equal(readAuthConfig(complete)?.origin, 'https://parkesrummy.com');
});
test('unsafe origins and placeholder client IDs never enable Google', () => {
  for (const origin of ['http://parkesrummy.com', 'https://user:pass@parkesrummy.com', 'https://parkesrummy.com/path', 'https://parkesrummy.com?x=1', 'javascript:alert(1)']) {
    assert.equal(readAuthConfig({ ...complete, BETTER_AUTH_URL: origin }), null);
  }
  assert.equal(readAuthConfig({ ...complete, GOOGLE_CLIENT_ID: 'replace-me' }), null);
  assert.equal(readAuthConfig({ ...complete, BETTER_AUTH_SECRET: 'short' }), null);
  assert.equal(readAuthConfig({ ...complete, NODE_ENV: 'development', BETTER_AUTH_URL: 'http://localhost:3000' })?.origin, 'http://localhost:3000');
});
test('the unconfigured session/config endpoints remain usable without database access', async () => {
  const api = createRoomHandlers({ configured: () => false, resolveSession: async () => null });
  const response = await api.accountSessionRequest(new Request('https://parkesrummy.com/api/account/session'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: false, user: null });
  assert.deepEqual(await api.accountConfigRequest().json(), { enabled: false });
});
