'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { BrowserGateway } = require('../src/browser');
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function setup(t) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', b => { body += b; });
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body });
      if (req.headers.authorization !== 'Basic test-auth' || !req.headers.cookie?.includes('GerritAccount=session-secret')) { res.writeHead(401); res.end('Unauthorized'); return; }
      if (req.url === '/gerrit/redirect') { res.writeHead(302, { Location: `${origin}/gerrit/c/42` }); res.end(); return; }
      if (req.url === '/gerrit/write') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ csrf: req.headers['x-gerrit-auth'], origin: req.headers.origin })); return; }
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Set-Cookie', 'GerritAccount=session-secret; HttpOnly; Path=/');
      res.setHeader('Content-Encoding', 'gzip');
      res.end(zlib.gzipSync(`<html><a href="${origin}/gerrit/c/42">Gerrit</a></html>`));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = { url: origin + '/gerrit', auth: 'test-auth', cookies: new Map([['GerritAccount', 'session-secret'], ['XSRF_TOKEN', 'csrf%2Bvalue']]), ensureSession: async () => {}, log() {} };
  const gateway = new BrowserGateway(api); await gateway.start();
  t.after(async () => { gateway.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const entry = gateway.entry('/gerrit/c/42'); const bootstrap = await request(entry);
  const cookie = bootstrap.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  return { gateway, api, origin, received, entry, bootstrap, cookie };
}
test('authenticated browser gateway serves HTML/assets without exposing upstream credentials', async t => {
  const { gateway, cookie, bootstrap, received, entry, origin } = await setup(t);
  assert.equal(bootstrap.status, 302); assert.equal(bootstrap.headers.location, '/gerrit/c/42');
  assert.ok(!entry.includes('test-auth')); assert.ok(!entry.includes('session-secret'));
  const page = await request(gateway.origin + bootstrap.headers.location, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200); assert.ok(page.text.includes(gateway.origin + '/gerrit/c/42'));
  assert.ok(!page.text.includes(origin)); assert.ok(!page.text.includes('session-secret'));
  assert.equal(page.headers['set-cookie'], undefined);
  assert.ok(received[0].headers.cookie.includes('GerritAccount=session-secret'));
  assert.ok(!received[0].headers.cookie.includes(gateway.cookieName));
});
test('gateway rejects unauthenticated, cross-origin, host-forged and replayed bootstrap requests', async t => {
  const { gateway, cookie, entry, received } = await setup(t);
  assert.equal((await request(gateway.origin + '/gerrit/c/42')).status, 403);
  assert.equal((await request(entry)).status, 403);
  assert.equal((await request(gateway.origin + '/gerrit/c/42', { headers: { Cookie: cookie, Origin: 'http://malicious.invalid' } })).status, 403);
  assert.equal((await request(gateway.origin + '/gerrit/c/42', { headers: { Cookie: cookie, Host: 'malicious.invalid' } })).status, 403);
  assert.equal(received.length, 0);
  assert.throws(() => gateway.entry('http://malicious.invalid'), /站点/);
});
test('same-origin browser writes include upstream session and CSRF, and redirects stay on gateway', async t => {
  const { gateway, cookie, origin } = await setup(t);
  const response = await request(gateway.origin + '/gerrit/write', { method: 'POST', headers: { Cookie: cookie, Origin: gateway.origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.text), { csrf: 'csrf+value', origin });
  const redirect = await request(gateway.origin + '/gerrit/redirect', { headers: { Cookie: cookie } });
  assert.equal(redirect.headers.location, gateway.origin + '/gerrit/c/42');
});
test('gateway refuses writes without XSRF instead of bypassing Gerrit protection', async t => {
  const { gateway, cookie, api, received } = await setup(t); api.cookies.delete('XSRF_TOKEN');
  const response = await request(gateway.origin + '/gerrit/write', { method: 'POST', headers: { Cookie: cookie, Origin: gateway.origin }, body: '{}' });
  assert.equal(response.status, 403); assert.equal(received.length, 0);
});
