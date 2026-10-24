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
      if (req.url.includes('/changes/edit-test/edit/')) {
        if (req.method === 'GET') res.end(Buffer.from('editable\n').toString('base64'));
        else {res.writeHead(204);res.end();} return;
      }
      if (req.url.includes('/rebase-conflict')) {res.writeHead(409);res.end('merge conflict(s): src/conflict.c');return;}
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

test('original byte reads preserve binary data and reject malformed content instead of caching garbage', async () => {
  const api=new GerritApi(url,'u','p'); const bytes=Buffer.from([0,255,80,75,3,4,128]);
  api.request=async()=>bytes.toString('base64')+'\n';
  assert.deepEqual(await api.bytes('id','rev','file.xlsx'),bytes);
  await assert.rejects(api.content('id','rev','file.xlsx'),/原文件预览/);
  for(const invalid of ['<html>Login</html>','abc!!','a']) { api.request=async()=>invalid;await assert.rejects(api.bytes('id','rev','file.bin'),/编码|Base64/); }
});

test('aborting a search destroys its in-flight HTTP request without waiting for timeout', async () => {
  let receivedRequest, closedRequest;
  const received = new Promise(resolve => { receivedRequest = resolve; });
  const closed = new Promise(resolve => { closedRequest = resolve; });
  const slow = http.createServer((req, res) => { receivedRequest(); res.on('close', closedRequest); });
  await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
  try {
    const api = new GerritApi('http://127.0.0.1:' + slow.address().port, 'user', 'test-key');
    const controller = new AbortController();
    const pending = api.list('is:open', 0, { signal: controller.signal });
    await received; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await closed;
    await assert.rejects(api.allComments('id', { signal: controller.signal }), { name: 'AbortError' });
  } finally { slow.closeAllConnections(); await new Promise(resolve => slow.close(resolve)); }
});


test('oversized advertised responses fail before downloading their bodies', async () => {
  const server = http.createServer((req,res) => { res.writeHead(200, {'Content-Length':33 * 1024 * 1024}); res.flushHeaders(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const api = new GerritApi('http://127.0.0.1:'+server.address().port,'user','test-only');
    await assert.rejects(api.bytes('id','rev','huge.bin'),/32MB/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test('reviewer APIs encode identifiers, suggest accounts and groups, and handle confirmed group additions', async () => {
  const api = new GerritApi(url, 'user', 'http-key');
  await api.suggestReviewers('p/main~I1', 'dev & team');
  assert.equal(received.at(-1).url, '/gerrit/a/changes/p%2Fmain~I1/suggest_reviewers?q=dev%20%26%20team&n=20');
  await api.reviewers('p/main~I1'); assert.equal(received.at(-1).method, 'GET');
  await api.addReviewer('p/main~I1', 'group-uuid', true);
  assert.deepEqual(received.at(-1).body, {reviewer: 'group-uuid', state: 'REVIEWER', confirmed: true});
  await api.removeReviewer('p/main~I1', 42);
  assert.equal(received.at(-1).method, 'DELETE');
  assert.ok(received.at(-1).url.endsWith('/reviewers/42'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.suggestReviewers('change', 'name', {signal:controller.signal}), {name:'AbortError'});
});


test('edit content uses the Gerrit data-URL body and publish/rebase endpoints preserve identifiers',async()=>{
  const api=new GerritApi(url,'user','http-key');
  await api.edit('p/main~I1');assert.ok(received.at(-1).url.endsWith('/p%2Fmain~I1/edit?list'));
  assert.equal((await api.editBytes('edit-test','src/a c.c')).toString(),'editable\n');
  await api.putEditFile('edit-test','src/a c.c',Buffer.from('中文\n'));
  assert.equal(received.at(-1).method,'PUT');
  assert.ok(received.at(-1).url.endsWith('/edit/src%2Fa%20c.c'));
  assert.deepEqual(received.at(-1).body,{binary_content:'data:application/octet-stream;base64,'+Buffer.from('中文\n').toString('base64')});
  await api.publishEdit('p/main~I1');assert.ok(received.at(-1).url.endsWith('/p%2Fmain~I1/edit:publish'));
  await api.rebaseEdit('p/main~I1');assert.ok(received.at(-1).url.endsWith('/p%2Fmain~I1/edit:rebase'));
  await api.action('p/main~I1','rebase',{base:''});assert.deepEqual(received.at(-1).body,{base:''});
  await assert.rejects(api.action('rebase-conflict','rebase'),error=>error.statusCode===409&&error.message.includes('src/conflict.c'));
});
test('conflict lookup pages all results and mergeability is pinned to a revision',async()=>{
  const api=new GerritApi(url,'user','http-key');
  await api.mergeable('p/main~I1','sha');assert.ok(received.at(-1).url.endsWith('/p%2Fmain~I1/revisions/sha/mergeable'));
  const calls=[];api.request=async path=>{calls.push(path);return calls.length===1?[{id:'a',_more_changes:true}]:[{id:'b'}];};
  const rows=await api.conflicts(42);assert.deepEqual(rows.map(row=>row.id),['a','b']);
  assert.ok(calls[0].includes('q=is%3Aopen%20conflicts%3A42'));assert.ok(calls[1].includes('S=100'));
  await assert.rejects(api.conflicts('42 OR status:merged'),/无效/);
});


test('saved edit revisions use normal files/content APIs and discard deletes the complete draft',async()=>{
 const api=new GerritApi(url,'user','http-key');await api.files('c','edit','old-sha');assert.ok(received.at(-1).url.includes('/revisions/edit/files/?base=old-sha'));
 await api.bytes('c','edit','x.c');assert.ok(received.at(-1).url.endsWith('/revisions/edit/files/x.c/content'));
 await api.discardEdit('c');assert.equal(received.at(-1).method,'DELETE');assert.ok(received.at(-1).url.endsWith('/changes/c/edit'));
});
