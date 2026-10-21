'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { GerritApi, normalizeUrl } = require('../src/api');
let server; let url; const received = [];
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', b => { body += b; });
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, auth: req.headers.authorization, cookie: req.headers.cookie, csrf: req.headers['x-gerrit-auth'], body: body ? JSON.parse(body) : undefined });
      if (req.url === '/cross-origin/login/') { res.writeHead(302, { Location: 'http://example.invalid/' }); res.end(); return; }
      if (req.url === '/bad-login/login/') { res.writeHead(401); res.end('Unauthorized'); return; }
      if (req.url.startsWith('/session/') || req.url.startsWith('/no-csrf/')) {
        const prefix = req.url.startsWith('/session/') ? '/session' : '/no-csrf';
        if (req.url === `${prefix}/login/`) { res.writeHead(302, { Location: `${prefix}/`, 'Set-Cookie': 'GerritAccount=test-session; HttpOnly; Path=/' }); res.end(); return; }
        if (req.url === `${prefix}/`) {
          if (prefix === '/session') res.setHeader('Set-Cookie', 'XSRF_TOKEN=test%2Bcsrf; Path=/');
          res.end('<html>Gerrit</html>'); return;
        }
        if (!req.headers.cookie?.includes('GerritAccount=test-session')) { res.writeHead(403); res.end('requires login'); return; }
        if (req.method === 'POST' && req.headers['x-gerrit-auth'] !== 'test+csrf') { res.writeHead(403); res.end('XSRF validation failed'); return; }
        res.end(")]}'\n" + JSON.stringify({ _account_id: 1, username: 'user' })); return;
      }
      if (req.url.includes('/denied')) { res.writeHead(403); res.end('secret internal details'); return; }
      if (req.url.includes('/redirect')) { res.writeHead(302, { Location: 'http://example.invalid' }); res.end(); return; }
      if (req.url.includes('/invalid')) { res.end('<html>Login</html>'); return; }
      if (req.url.includes('/empty')) { res.writeHead(204); res.end(); return; }
      if (req.url.includes('/content')) { res.end(Buffer.from('中文代码\nhello').toString('base64')); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(")]}'\n" + JSON.stringify({ ok: true }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/gerrit`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
test('HTTP proxy login follows same-origin redirects, retains session and sends CSRF on review', async () => {
  const base = url.replace('/gerrit', '/session');
  const api = new GerritApi(base, 'user', 'web-password', { authMode: 'webPassword' });
  assert.equal((await api.self()).username, 'user');
  assert.equal(received.at(-1).url, '/session/accounts/self');
  assert.ok(received.at(-1).cookie.includes('GerritAccount=test-session'));
  assert.equal(received.at(-1).auth, 'Basic ' + Buffer.from('user:web-password').toString('base64'));
  const before = received.filter(r => r.url === '/session/login/').length;
  await api.review('p~main~I1', 'revision', { message: 'session review' });
  assert.equal(received.at(-1).url, '/session/changes/p~main~I1/revisions/revision/review');
  assert.equal(received.at(-1).csrf, 'test+csrf');
  assert.equal(received.filter(r => r.url === '/session/login/').length, before);
});
test('session login does not forward credentials to cross-origin redirects', async () => {
  const api = new GerritApi(url.replace('/gerrit', '/cross-origin'), 'user', 'p', { authMode: 'webPassword' });
  await assert.rejects(api.self(), /其他站点/);
  assert.equal(api.sessionReady, false);
  assert.equal(api.cookies.size, 0);
});
test('session login reports wrong web password and prevents writes without CSRF', async () => {
  const bad = new GerritApi(url.replace('/gerrit', '/bad-login'), 'user', 'wrong', { authMode: 'webPassword' });
  await assert.rejects(bad.self(), /网页登录认证失败/);
  const api = new GerritApi(url.replace('/gerrit', '/no-csrf'), 'user', 'p', { authMode: 'webPassword' });
  await api.self(); const size = received.length;
  await assert.rejects(api.review('id', 'rev', { message: 'unsafe' }), /XSRF_TOKEN/);
  assert.equal(received.length, size);
});
test('concurrent session requests share one login exchange', async () => {
  const api = new GerritApi(url.replace('/gerrit', '/session'), 'user', 'p', { authMode: 'webPassword' });
  const before = received.filter(r => r.url === '/session/login/').length;
  await Promise.all([api.self(), api.self()]);
  assert.equal(received.filter(r => r.url === '/session/login/').length, before + 1);
});
test('normalizes base paths and rejects URL credentials or non-HTTP protocols', () => {
  assert.equal(normalizeUrl('https://review.example/gerrit/a/'), 'https://review.example/gerrit');
  for (const s of ['file:///tmp/test', 'https://user:pass@example.com', 'https://example.com/?token=x']) assert.throws(() => normalizeUrl(s));
});
test('dashboard links normalize to REST base while preserving deployment prefix', () => {
  assert.equal(normalizeUrl('http://review.example/dashboard/self'), 'http://review.example');
  assert.equal(normalizeUrl('https://review.example/gerrit/dashboard/self/'), 'https://review.example/gerrit');
  assert.equal(normalizeUrl('https://review.example/gerrit/dashboard/100'), 'https://review.example/gerrit');
  assert.equal(normalizeUrl('https://review.example/gerrit'), 'https://review.example/gerrit');
  assert.equal(normalizeUrl('https://review.example/my-dashboard'), 'https://review.example/my-dashboard');
});
test('pasted dashboard link authenticates against canonical /a/accounts/self', async () => {
  const api = new GerritApi(url + '/dashboard/self', 'u', 'p');
  await api.self();

  assert.equal(received.at(-1).url, '/gerrit/a/accounts/self');
});
test('authenticated requests preserve Gerrit prefix and strip XSSI', async () => {
  const api = new GerritApi(url, 'user', 'token');
  assert.deepEqual(await api.self(), { ok: true });
  assert.equal(received.at(-1).url, '/gerrit/a/accounts/self');
  assert.equal(received.at(-1).auth, 'Basic ' + Buffer.from('user:token').toString('base64'));
});
test('queries, file names and change IDs are encoded without URL injection', async () => {
  const api = new GerritApi(url, 'u', 'p');
  await api.list('is:open owner:self & project:中文', 50);
  const query = new URL(received.at(-1).url, url);
  assert.equal(query.searchParams.get('q'), 'is:open owner:self & project:中文');
  assert.equal(query.searchParams.get('S'), '50');
  const content = await api.content('project~main~I123', 'abc', 'src/中文 #?.js', true);
  assert.equal(content, '中文代码\nhello');
  assert.ok(received.at(-1).url.includes('src%2F%E4%B8%AD%E6%96%87%20%23%3F.js/content?parent=1'));
});
test('patch comparison and paging settings produce the expected REST queries', async () => {
  const api = new GerritApi(url, 'u', 'p', { pageSize: 25 });
  await api.list('is:merged', 25);
  let parsed = new URL(received.at(-1).url, url);
  assert.ok(parsed.searchParams.getAll('o').includes('REVIEWED'));
  assert.equal(parsed.searchParams.get('n'), '25'); assert.equal(parsed.searchParams.get('S'), '25');
  await api.detail('change');
  parsed = new URL(received.at(-1).url, url);
  assert.ok(parsed.searchParams.getAll('o').includes('ALL_REVISIONS'));
  assert.ok(parsed.searchParams.getAll('o').includes('ALL_COMMITS'));
  assert.ok(parsed.searchParams.getAll('o').includes('REVIEWED'));
  await api.related('team/project~main~Id', 'old/revision');
  assert.equal(received.at(-1).url, '/gerrit/a/changes/team%2Fproject~main~Id/revisions/old%2Frevision/related');
  await api.files('change', 'right-revision', 'left-revision');
  assert.equal(received.at(-1).url, '/gerrit/a/changes/change/revisions/right-revision/files/?base=left-revision');
  await api.files('change', 'right-revision');
  assert.ok(received.at(-1).url.endsWith('?parent=1'));
  await api.allComments('change'); assert.equal(received.at(-1).url, '/gerrit/a/changes/change/comments');
});
test('single Patch browsing starts with changed existing files and searches the server for other paths', async () => {
  const api = new GerritApi(url, 'u', 'p');
  api.files = async () => ({ 'a.js': {}, 'new.js': { status: 'A' }, 'removed.js': { status: 'D' } });
  assert.deepEqual(await api.treeFiles('change', 'revision'), ['a.js', 'new.js']);
  let requested; api.request = async path => { requested = path; return ['src/deep/a.js']; };
  assert.deepEqual(await api.treeFiles('change', 'revision', 'deep/a'), ['src/deep/a.js']);
  assert.ok(requested.endsWith('/files/?q=deep%2Fa'));
});
test('HTTP debug trace omits credentials, queries, review text and response bodies', async () => {
  const lines = []; const api = new GerritApi(url, 'u', 'test-password', { log: (level, message) => lines.push(`${level}: ${message}`) });
  await api.review('change', 'revision', { message: 'private review text' });
  await api.list('private search text');
  await assert.rejects(api.request('/invalid'), /JSON/);
  const text = lines.join('\n');
  for (const privateText of ['test-password', 'private review text', 'private search text', '<html>', 'Authorization', 'Cookie']) assert.ok(!text.includes(privateText));
  assert.ok(text.includes('HTTP 200')); assert.ok(text.includes(' ms)'));
});
test('line ranges, parent-side replies and labels are posted to pinned patch set', async () => {
  const api = new GerritApi(url, 'u', 'p');
  const comments = { 'a.js': [{ line: 9, side: 'PARENT', message: 'reply', in_reply_to: 'comment-1', range: { start_line: 8, start_character: 0, end_line: 9, end_character: 3 } }] };
  await api.review('p~main~I123', 'deadbeef', { labels: { 'Code-Review': 2 }, comments });
  const r = received.at(-1);
  assert.equal(r.method, 'POST'); assert.ok(r.url.endsWith('/revisions/deadbeef/review'));
  assert.deepEqual(r.body, { drafts: 'KEEP', labels: { 'Code-Review': 2 }, comments });
});
test('returns helpful errors, handles empty responses, refuses redirects', async () => {
  const api = new GerritApi(url, 'u', 'p');
  await assert.rejects(api.request('/denied'), /权限/);
  await assert.rejects(api.request('/redirect'), /HTTP 302/);
  await assert.rejects(api.request('/invalid'), /JSON/);
  assert.equal(await api.request('/empty'), undefined);
  assert.throws(() => api.action('id', 'delete'), /未知/);
});
