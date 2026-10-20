import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

// Read the real HTTP response without running JavaScript or contacting any API.
// An optional public base URL runs the same checks against a deployed release.
const externalBase = process.env.PARKES_PUBLIC_BASE_URL;
const port = externalBase ? null : await new Promise((resolve, reject) => {
  const listener = createServer();
  listener.on('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const allocated = listener.address().port;
    listener.close(error => error ? reject(error) : resolve(allocated));
  });
});
const base = new URL(externalBase || `http://127.0.0.1:${port}`);
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.equal(base.username + base.password, '', 'Public checks never use credentials');

// Local checks need no production account, database, payment or advertising keys.
const env = { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']) {
  if (process.env[key]) env[key] = process.env[key];
}
const server = externalBase ? null : spawn(process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)],
  { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
let serverError;
server?.on('error', error => { serverError = error; });
for (const stream of [server?.stdout, server?.stderr]) {
  stream?.on('data', data => { serverLog = (serverLog + data).slice(-12000); });
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'user-agent': 'ParkesRummyPublicContentCheck/1.0' },
  });
  assert.equal(response.status, 200, `${path}: direct public response`);
  return { response, text: await response.text() };
}
function renderedHtml(html) {
  // Text embedded in React's hydration payload does not count as visible HTML.
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
function textContent(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
async function page(path) {
  const result = await request(path);
  assert.match(result.response.headers.get('content-type') || '', /text\/html/);
  assert.doesNotMatch(result.text, /<script\b[^>]*\bsrc=["'][^"']*\/pagead\/js\/adsbygoogle\.js/i,
    `${path}: no advertising loader before consent`);
  assert.doesNotMatch(result.text, /<ins\b[^>]*\bclass=["'][^"']*adsbygoogle/i,
    `${path}: no advertising unit before consent`);
  return renderedHtml(result.text);
}

try {
  if (server) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(`Public-content server exited ${server.exitCode}`);
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (ready) break;
      await pause(200);
    }
    assert.ok(ready, 'Production server starts');
  }

  const home = await page('/');
  const publicSection = home.match(/<section\b[^>]*class="public-home-content"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(publicSection, 'Homepage contains public information before account bootstrap');
  const homeText = textContent(publicSection);
  for (const topic of [/online multiplayer card game/, /two to eight players/, /Twos are wild/, /lowest total penalty score/]) {
    assert.match(homeText, topic, 'Homepage explains the playable game without JavaScript');
  }
  const guides = [
    { path: '/how-to-play', title: 'How to play Parkes Rummy', topic: /A worked opening/ },
    { path: '/rules', title: 'The Parkes Rummy rules', topic: /Twos, printed suits and natural cards/ },
    { path: '/scoring', title: 'Scoring: keep your total low', topic: /A leftover-hand example/ },
    { path: '/help', title: 'Help for your next hand', topic: /Accounts, saved tables and reconnecting/ },
    { path: '/about-help', title: 'About Parkes Rummy', topic: /Developed by IBD Collective/ },
  ];
  for (const guide of guides) {
    assert.ok(home.includes(`href="${guide.path}"`), `${guide.path}: reachable through an ordinary homepage link`);
    const html = await page(guide.path);
    assert.ok(html.includes(`<h1>${guide.title}</h1>`), `${guide.path}: visible main heading`);
    assert.ok(html.includes(`rel="canonical" href="https://parkesrummy.com${guide.path}"`), `${guide.path}: canonical URL`);
    const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
    assert.ok(article, `${guide.path}: guide is rendered as an article`);
    assert.match(textContent(article), guide.topic, `${guide.path}: substantive explanation is in the HTTP response`);
    assert.ok(html.includes('href="/"'), `${guide.path}: ordinary link returns to the game`);
    for (const policy of ['/privacy', '/cookies']) {
      assert.ok(html.includes(`href="${policy}"`), `${guide.path}: privacy information and advertising choices stay reachable`);
    }
    if (guide.path === '/rules') {
      const openingTables = [...article.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
      assert.equal(openingTables.length, 3, 'Only the three free rule collections are published');
      for (const [index, table] of openingTables.entries()) {
        assert.equal([...table[1].matchAll(/<tr>/g)].length, 10, `Game ${index + 1}: all ten openings are readable`);
      }
    }
  }

  const otherPublicPages = ['/tutorial', '/progress-help', '/install', '/privacy', '/terms', '/cookies', '/data-account'];
  for (const path of otherPublicPages) await page(path);
  const sitemap = (await request('/sitemap.xml')).text;
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]));
  const paths = urls.map(url => url.pathname);
  for (const path of ['/', ...guides.map(guide => guide.path), ...otherPublicPages]) {
    assert.ok(paths.includes(path), `${path}: public page is discoverable in the sitemap`);
  }
  for (const url of urls) {
    assert.equal(url.origin, 'https://parkesrummy.com');
    assert.equal(url.search + url.hash, '');
    assert.ok(!/^\/(api|join|profile|competition|ladder|store)(\/|$)/.test(url.pathname), 'Sitemap excludes private screens and store redirect');
  }
  const robots = (await request('/robots.txt')).text;
  assert.match(robots, /User-Agent: \*/i);
  assert.match(robots, /Allow: \/(?:\r?\n|$)/i);
  assert.match(robots, /Sitemap: https:\/\/parkesrummy\.com\/sitemap\.xml/i);

  const publisher = home.match(/name="google-adsense-account" content="ca-(pub-\d+)"/)?.[1];
  assert.ok(publisher, 'AdSense ownership metadata remains present');
  const ads = (await request('/ads.txt')).text;
  assert.ok(ads.split(/\r?\n/).some(line => line.trim() === `google.com, ${publisher}, DIRECT, f08c47fec0942fa0`),
    'ads.txt matches the public AdSense ownership metadata');
  console.log(`PASS: public homepage, ${guides.length} complete guides, ${otherPublicPages.length} supporting pages, sitemap, robots and AdSense ownership at ${base.origin}`);
} catch (error) {
  if (serverLog) console.error(serverLog);
  throw error;
} finally {
  if (server && server.exitCode === null && !serverError) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), pause(3000)]);
  }
}
