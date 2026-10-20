import assert from 'node:assert/strict';

// Anonymous probes only: production stops at sign-in; preview must stop before
// session lookup, rate limits or competition/visitor persistence.
const context = process.env.PARKES_VERIFY_CONTEXT || 'deploy-preview';
assert.ok(['production', 'deploy-preview'].includes(context), 'Choose production or deploy-preview.');
const pull = process.env.NETLIFY_PR_NUMBER;
const base = context === 'production'
  ? 'https://parkesrummy.com'
  : `https://deploy-preview-${pull}--parkes-rummy.netlify.app`;
if (context === 'deploy-preview') assert.match(pull || '', /^\d+$/, 'NETLIFY_PR_NUMBER is required.');

const checks = [];
for (const path of ['/api/records', '/api/competition', '/api/ladder']) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  const expected = context === 'production' ? 401 : 409;
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(body)}`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(body.error || '', context === 'production' ? /Sign in with Google/ : /Preview deployments/);
  checks.push({ path, status: response.status, cacheControl: response.headers.get('cache-control') });
}
if (context === 'deploy-preview') {
  const response = await fetch(base + '/api/activity/presence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 204, 'Preview visitor collection must stop before persistence.');
  checks.push({ path: '/api/activity/presence', status: response.status });
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), base, context, checks }, null, 2));
