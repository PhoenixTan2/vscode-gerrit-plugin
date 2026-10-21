'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
// Fixed-upstream loopback gateway; secrets stay in the extension process.
class BrowserGateway {
  constructor(api) { this.api = api; this.nonce = crypto.randomBytes(32).toString('hex'); this.cookieName = `GerritWorkbench_${this.nonce.slice(0, 12)}`; this.pending = new Set(); this.tickets = new Map(); }
  async start() {
    if (this.server) return;
    await this.api.ensureSession();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
  }
  entry(path) {
    const target = new URL(path, this.api.url + '/');
    if (target.origin !== new URL(this.api.url).origin) throw new Error('浏览器只允许打开当前 Gerrit 站点');
    const ticket = crypto.randomBytes(32).toString('hex');
    if (this.tickets.size >= 32) this.tickets.delete(this.tickets.keys().next().value);
    this.tickets.set(ticket, target.pathname + target.search + target.hash);
    return `${this.origin}/_gerrit_login/${ticket}`;
  }
  handle(req, res) {
    const deny = (status, text) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); };
    if (req.headers.host !== new URL(this.origin).host) return deny(403, 'Invalid gateway host');
    const local = new URL(req.url, this.origin);
    const ticket = local.pathname.startsWith('/_gerrit_login/') ? local.pathname.slice('/_gerrit_login/'.length) : '';
    if (this.tickets.has(ticket) && req.method === 'GET') {
      const path = this.tickets.get(ticket); this.tickets.delete(ticket);
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path)) return deny(400, 'Invalid target');
      const cookies = [`${this.cookieName}=${this.nonce}; HttpOnly; SameSite=Strict; Path=/`];
      const csrf = this.api.cookies.get('XSRF_TOKEN'); if (csrf) cookies.push(`XSRF_TOKEN=${csrf}; SameSite=Strict; Path=/`);
      res.writeHead(302, { Location: path, 'Set-Cookie': cookies, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return;
    }
    if (!String(req.headers.cookie || '').split(';').map(s => s.trim()).includes(`${this.cookieName}=${this.nonce}`)) return deny(403, '请从 Gerrit 插件重新打开内置浏览器');
    if (req.headers.origin && req.headers.origin !== this.origin) return deny(403, 'Cross-origin request blocked');
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny(403, 'Cross-site request blocked');
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) || req.headers.upgrade) return deny(405, 'Unsupported method');
    const remote = new URL(req.url, this.api.url);
    if (remote.origin !== new URL(this.api.url).origin || remote.username || remote.password) return deny(403, 'Invalid upstream');
    const headers = { ...req.headers, host: remote.host, authorization: `Basic ${this.api.auth}`, 'accept-encoding': 'identity' };
    for (const name of ['cookie', 'connection', 'proxy-authorization', 'proxy-connection', 'forwarded', 'x-forwarded-for', 'x-forwarded-host']) delete headers[name];
    headers.cookie = [...this.api.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (headers.origin) headers.origin = remote.origin;
    if (headers.referer) headers.referer = headers.referer.replace(this.origin, remote.origin);
    if (!['GET', 'HEAD'].includes(req.method)) {
      const csrf = this.api.cookies.get('XSRF_TOKEN'); if (!csrf) return deny(403, '登录会话缺少 XSRF 令牌，请重新连接');
      try { headers['x-gerrit-auth'] = decodeURIComponent(csrf); } catch { return deny(403, 'Invalid XSRF token'); }
    }
    const started = Date.now();
    const upstream = (remote.protocol === 'https:' ? https : http).request(remote, { method: req.method, headers }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 32 * 1024 * 1024) response.destroy(new Error('Gateway response too large')); else chunks.push(chunk); });
      response.on('error', () => { if (!res.headersSent) deny(502, 'Gerrit 响应读取失败'); else res.destroy(); });
      response.on('end', () => {
        if (res.destroyed) return;
        try {
          let body = Buffer.concat(chunks); const out = { ...response.headers };
          for (const name of ['set-cookie', 'connection', 'transfer-encoding', 'content-length', 'access-control-allow-origin', 'access-control-allow-credentials', 'www-authenticate']) delete out[name];
          const browserCookies = [];
          for (const cookie of response.headers['set-cookie'] || []) {
            const pair = cookie.split(';', 1)[0]; const i = pair.indexOf('='); const name = pair.slice(0, i); const value = pair.slice(i + 1);
            if (['GerritAccount', 'XSRF_TOKEN'].includes(name)) {
              if (value) this.api.cookies.set(name, value); else this.api.cookies.delete(name);
              if (name === 'XSRF_TOKEN') browserCookies.push(`${pair}; SameSite=Strict; Path=/`);
            }
          }
          if (browserCookies.length) out['set-cookie'] = browserCookies;
          if (out.location) { const next = new URL(out.location, remote); if (next.origin === remote.origin) out.location = this.origin + next.pathname + next.search + next.hash; }
          if (/(?:text\/|javascript|json)/i.test(out['content-type'] || '')) {
            if (out['content-encoding'] === 'gzip') body = zlib.gunzipSync(body, { maxOutputLength: 32 * 1024 * 1024 });
            else if (out['content-encoding'] === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: 32 * 1024 * 1024 });
            else if (out['content-encoding'] === 'deflate') body = zlib.inflateSync(body, { maxOutputLength: 32 * 1024 * 1024 });
            delete out['content-encoding']; let text = body.toString('utf8');
            if (!/json/i.test(out['content-type'] || '')) text = text.split(remote.origin).join(this.origin);
            else if (remote.pathname.endsWith('/config/server/info')) text = text.replace(/("canonical_web_url"\s*:\s*")([^"]+)(")/, (_, a, url, b) => a + url.replace(remote.origin, this.origin) + b);
            body = Buffer.from(text); delete out.etag; delete out['content-md5'];
          }
          if (out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].split(remote.origin).join(this.origin);
          out['content-length'] = body.length; out['cache-control'] = 'no-store'; out['referrer-policy'] = 'no-referrer';
          this.api.log('info', `Browser ${req.method} ${remote.pathname} → HTTP ${response.statusCode} (${Date.now() - started} ms)`);
          res.writeHead(response.statusCode, out); res.end(body);
        } catch { if (!res.headersSent) deny(502, 'Gerrit 页面转换失败'); }
      });
    });
    this.pending.add(upstream); upstream.on('close', () => this.pending.delete(upstream));
    upstream.setTimeout(this.api.timeout || 30000, () => upstream.destroy(new Error('Gateway timeout')));
    upstream.on('error', () => { if (!res.headersSent) deny(502, 'Gerrit 浏览器连接失败，请重新连接'); else res.destroy(); });
    let requestBytes = 0; req.on('data', chunk => { requestBytes += chunk.length; if (requestBytes > 32 * 1024 * 1024) { upstream.destroy(); if (!res.headersSent) deny(413, 'Request too large'); } });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  }
  dispose() { for (const req of this.pending) req.destroy(); this.pending.clear(); this.tickets.clear(); this.server?.closeAllConnections(); this.server?.close(); this.server = undefined; this.nonce = ''; }
}
module.exports = { BrowserGateway };
