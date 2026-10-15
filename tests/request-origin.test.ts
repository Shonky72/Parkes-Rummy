import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRoomWriteOrigin } from '../lib/request-origin';
import { createRoomHandlers } from '../lib/room-server';
import { ROOM_PROTOCOL, ROOM_PROTOCOL_HEADER } from '../lib/room-protocol';

const internalUrl = 'https://6ad13f1d522aaf44882430ee--parkes-rummy.netlify.app:80/api/rooms/DZKG/action';
const request = (origin?: string, fetchSite = 'same-origin', url = internalUrl) =>
  new Request(url, { method: 'POST', headers: { ...(origin === undefined ? {} : { Origin: origin }), 'Sec-Fetch-Site': fetchSite } });

test('a real mobile Chrome request reaches Parkes Rummy through a Netlify deployment URL with :80', () => {
  assert.equal(isAllowedRoomWriteOrigin(request('https://parkesrummy.com')), true);
  assert.equal(isAllowedRoomWriteOrigin(request('https://parkesrummy.com', 'same-site')), true);
});

test('official alternate and site-owned Netlify URLs are valid for browser writes', () => {
  for (const origin of [
    'https://www.parkesrummy.com',
    'https://parkes-rummy.netlify.app',
    'https://main--parkes-rummy.netlify.app',
    'https://deploy-preview-9--parkes-rummy.netlify.app',
    'https://6ad13f1d522aaf44882430ee--parkes-rummy.netlify.app',
  ]) assert.equal(isAllowedRoomWriteOrigin(request(origin)), true, origin);
});

test('cross-site, foreign-site, missing and invalid Origins fail closed', () => {
  for (const origin of [
    undefined, 'null', 'https://parkesrummy.com.evil.test', 'https://evil.example',
    'http://parkesrummy.com', 'https://parkesrummy.com:444',
    'https://unrelated.netlify.app', 'https://parkesrummy.com/',
  ]) assert.equal(isAllowedRoomWriteOrigin(request(origin)), false, String(origin));
  assert.equal(isAllowedRoomWriteOrigin(request('https://parkesrummy.com', 'cross-site')), false);
  assert.equal(isAllowedRoomWriteOrigin(request('https://parkesrummy.com.evil.test', 'same-site')), false);
});

test('test and localhost hosts retain same-origin protection only for matching dev URLs', () => {
  if (process.env.NODE_ENV === 'production') return;
  assert.equal(isAllowedRoomWriteOrigin(request('https://game.test', 'same-origin', 'https://game.test/api/rooms')), true);
  assert.equal(isAllowedRoomWriteOrigin(request('http://127.0.0.1:3000', 'same-origin', 'http://127.0.0.1:3000/api/rooms')), true);
  assert.equal(isAllowedRoomWriteOrigin(request('http://127.0.0.1:3000', 'same-origin', 'http://127.0.0.1:3001/api/rooms')), false);
});

test('valid production Origin passes the API security check before JSON content checking', async () => {
  // Keep this safe: invalid content type is rejected before any repository calls.
  const api = createRoomHandlers({ resolveSession: async () => null, configured: () => true });
  const response = await api.createRoomRequest(new Request(internalUrl, {
    method: 'POST',
    headers: {
      Origin: 'https://parkesrummy.com',
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'text/plain',
      [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL,
    },
    body: '{}',
  }));
  assert.equal(response.status, 415);
  const blocked = await api.createRoomRequest(new Request(internalUrl, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'text/plain',
      [ROOM_PROTOCOL_HEADER]: ROOM_PROTOCOL,
    },
    body: '{}',
  }));
  assert.equal(blocked.status, 403);
});
