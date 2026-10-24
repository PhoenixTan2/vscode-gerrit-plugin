'use strict';
const {tr} = require('./i18n');
const https = require('node:https');
const http = require('node:http');
const { RESPONSE_LIMIT } = require('./limits');
function normalizeUrl(value) {
  const u = new URL(value.trim());
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(tr('请输入不包含账号、查询参数的 HTTP(S) 服务器地址'));
  // A dashboard is a browser route, never part of the REST API base path.
  // Preserve deployments mounted under a prefix, e.g. /gerrit/dashboard/self.
  u.pathname = u.pathname.replace(/\/dashboard(?:\/.*)?$/, '');
  return u.toString().replace(/\/+$/, '').replace(/\/a$/, '');
}
const enc = encodeURIComponent;
class GerritApi {
  constructor(url, username, password, { authMode = 'httpKey', timeout = 30000, pageSize = 50, log = () => {} } = {}) {
    if (!['httpKey', 'webPassword'].includes(authMode)) throw new Error(tr('不支持的认证方式'));
    this.url = normalizeUrl(url); this.auth = Buffer.from(`${username}:${password}`).toString('base64');
    this.authMode = authMode; this.cookies = new Map(); this.sessionReady = false;
    this.timeout = timeout; this.pageSize = pageSize; this.log = log;
  }
  async ensureSession() {
    if (this.sessionReady) return;
    if (this.sessionPromise) return this.sessionPromise;
    this.sessionPromise = (async () => {
      try {
        let url = new URL(`${this.url}/login/`);
        for (let redirects = 0; redirects <= 4; redirects++) {
          const response = await this.exchange(url, 'GET', undefined, true, true);
          if (response.status >= 300) {
            if (!response.location) throw new Error(tr('登录重定向缺少目标地址'));
            const next = new URL(response.location, url);
            if (next.origin !== new URL(this.url).origin || next.username || next.password) throw new Error(tr('登录跳转到其他站点，无法使用 HTTP 反向代理登录模式'));
            url = next; continue;
          }
          if (!this.cookies.has('GerritAccount')) throw new Error(tr('服务器未建立 Gerrit 登录会话，请确认服务器使用 HTTP 反向代理认证'));
          this.sessionReady = true; return;
        }
        throw new Error(tr('登录重定向次数过多'));
      } catch (error) { this.cookies.clear(); throw error; }
    })();
    try { await this.sessionPromise; } finally { this.sessionPromise = undefined; }
  }
  async request(path, method = 'GET', body, raw = false, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.authMode === 'webPassword') await this.ensureSession();
    const url = new URL(`${this.url}${this.authMode === 'httpKey' ? '/a' : ''}${path}`);
    signal?.throwIfAborted();
    return this.exchange(url, method, body, raw, false, { signal });
  }
  exchange(url, method, body, raw, login = false, { signal } = {}) {
    const started = Date.now();
    this.log('debug', `${method} ${url.origin}${url.pathname}`);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Authorization: `Basic ${this.auth}`, Accept: raw ? 'text/plain' : 'application/json', ...(data ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) } : {}) };
    if (this.authMode === 'webPassword') {
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (!['GET', 'HEAD'].includes(method)) {
        const token = this.cookies.get('XSRF_TOKEN');
        if (!token) return Promise.reject(new Error(tr('登录会话缺少 XSRF_TOKEN，无法安全发布评论或执行写操作，请重新连接')));
        try { headers['X-Gerrit-Auth'] = decodeURIComponent(token); } catch { return Promise.reject(new Error(tr('登录会话的 XSRF_TOKEN 无效，请重新连接'))); }
      }
    }
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method, headers, signal
      }, res => {
        if (this.authMode === 'webPassword') for (const cookie of res.headers['set-cookie'] || []) {
          const pair = cookie.split(';', 1)[0]; const separator = pair.indexOf('=');
          const name = pair.slice(0, separator); const value = pair.slice(separator + 1);
          if (['GerritAccount', 'XSRF_TOKEN'].includes(name)) {
            if (!value || /max-age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name); else this.cookies.set(name, value);
          }
        }
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > RESPONSE_LIMIT) { res.destroy(new Error(tr('响应超过 32MB 限制'))); return; } chunks.push(chunk); });
        res.on('error', reject);
        if (Number(res.headers['content-length']) > RESPONSE_LIMIT) { res.destroy(new Error(tr('响应超过 32MB 限制'))); return; }
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          this.log(res.statusCode >= 400 ? 'error' : 'info', `${method} ${url.pathname} → HTTP ${res.statusCode} (${Date.now() - started} ms)`);
          if (login && res.statusCode >= 200 && res.statusCode < 400) return resolve({ status: res.statusCode, location: res.headers.location });
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const authHint = this.authMode === 'webPassword' ? tr('网页登录认证失败或会话已过期，请检查网页登录密码并重新连接。') : tr('HTTP Key 认证失败。请检查 Key；如果使用网页登录密码，请在连接设置中选择“网页登录密码（HTTP 反向代理）”。');
            const hint = { 401: tr`HTTP 401：${authHint}请求地址：${url.origin}${url.pathname}`, 403: tr('没有执行此操作的权限，或登录会话已失效，请检查权限并重新连接'), 409: tr('变更状态冲突，请刷新后重试') }[res.statusCode];
            const error = new Error(hint || `Gerrit HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
            error.logMessage = `${method} ${url.pathname} → HTTP ${res.statusCode}`;
            error.statusCode = res.statusCode;
            if (res.statusCode === 409) error.message += '\n' + text.slice(0, 1200);
            return reject(error);
          }
          if (raw) return resolve(text);
          try { resolve(text ? JSON.parse(text.replace(/^\)\]\}'\r?\n/, '')) : undefined); } catch { reject(new Error(tr('服务器未返回有效 JSON，请检查服务器地址和认证配置'))); }
        });
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(tr`连接超时（${this.timeout / 1000} 秒）`)));
      req.on('error', error => { this.log('error', `${method} ${url.pathname} → ${error.code || tr('请求失败')} (${Date.now() - started} ms)`); reject(error); }); if (data) req.write(data); req.end();
    });
  }
  suggestReviewers(id, query, {signal} = {}) { return this.request(`/changes/${enc(id)}/suggest_reviewers?q=${enc(query)}&n=20`, 'GET', undefined, false, {signal}); }
  reviewers(id) { return this.request(`/changes/${enc(id)}/reviewers/`); }
  addReviewer(id, reviewer, confirmed = false) { return this.request(`/changes/${enc(id)}/reviewers`, 'POST', {reviewer, state: 'REVIEWER', ...(confirmed ? {confirmed: true} : {})}); }
  removeReviewer(id, account) { return this.request(`/changes/${enc(id)}/reviewers/${enc(account)}`, 'DELETE'); }
  edit(id, {signal} = {}) { return this.request(`/changes/${enc(id)}/edit?list`, 'GET', undefined, false, {signal}); }
  async editBytes(id, path) { return this.decodeBytes(await this.request(`/changes/${enc(id)}/edit/${enc(path)}`, 'GET', undefined, true)); }
  putEditFile(id, path, bytes) { return this.request(`/changes/${enc(id)}/edit/${enc(path)}`, 'PUT', {binary_content: `data:application/octet-stream;base64,${bytes.toString('base64')}`}); }
  discardEdit(id) { return this.request(`/changes/${enc(id)}/edit`, 'DELETE'); }
  publishEdit(id) { return this.request(`/changes/${enc(id)}/edit:publish`, 'POST', {}); }
  rebaseEdit(id) { return this.request(`/changes/${enc(id)}/edit:rebase`, 'POST', {}); }
  mergeable(id, rev, {signal} = {}) { return this.request(this.revision(id, rev, '/mergeable'), 'GET', undefined, false, {signal}); }
  async conflicts(number, {signal} = {}) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(tr('无效的 Gerrit 号'));
    const result = [];
    for (let start = 0; ; start += 100) {
      const rows = await this.request(`/changes/?q=${enc(`is:open conflicts:${number}`)}&n=100&S=${start}&o=CURRENT_REVISION`, 'GET', undefined, false, {signal});
      result.push(...rows);
      if (!rows.length || !rows.at(-1)._more_changes) return result;
    }
  }
  changeHeads(numbers, {signal} = {}) {
    if (!numbers.length || numbers.some(n => !Number.isSafeInteger(n) || n <= 0) || numbers.length > 20) throw new Error(tr('无效的 Gerrit 号'));
    return this.request(`/changes/?q=${enc(numbers.map(n => `change:${n}`).join(' OR '))}&n=100&o=CURRENT_REVISION`, 'GET', undefined, false, {signal});
  }
  self() { return this.request('/accounts/self'); }
  list(query, start = 0, { search = false, signal } = {}) { return this.request(`/changes/?q=${enc(query)}&n=${this.pageSize}&S=${start}&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS&o=REVIEWED&o=SUBMITTABLE${search ? '&o=ALL_REVISIONS&o=ALL_COMMITS&o=MESSAGES' : ''}`, 'GET', undefined, false, { signal }); }
  detail(id) { return this.request(`/changes/${enc(id)}/detail?o=ALL_REVISIONS&o=ALL_COMMITS&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS&o=MESSAGES&o=CURRENT_ACTIONS&o=REVIEWED&o=SUBMITTABLE&o=ALL_FILES`); }
  revision(id, rev, path = '') { return `/changes/${enc(id)}/revisions/${enc(rev)}${path}`; }
  files(id, rev, base, { signal } = {}) { return this.request(this.revision(id, rev, `/files/?${base ? `base=${enc(base)}` : 'parent=1'}`), 'GET', undefined, false, { signal }); }
  related(id, rev, { signal } = {}) { return this.request(this.revision(id, rev, '/related'), 'GET', undefined, false, { signal }); }
  allComments(id, { signal } = {}) { return this.request(`/changes/${enc(id)}/comments`, 'GET', undefined, false, { signal }); }
  async treeFiles(id, rev, query) {
    if (query) return this.request(this.revision(id, rev, `/files/?q=${enc(query)}`));
    const files = await this.files(id, rev);
    return Object.entries(files).filter(([, file]) => file.status !== 'D').map(([path]) => path);
  }
  comments(id, rev) { return this.request(this.revision(id, rev, '/comments')); }
  review(id, rev, input) { return this.request(this.revision(id, rev, '/review'), 'POST', { drafts: 'KEEP', ...input }); }
  async bytes(id, rev, path, base = false) {
    const raw = await this.request(this.revision(id, rev, `/files/${enc(path)}/content${base ? '?parent=1' : ''}`), 'GET', undefined, true);
    return this.decodeBytes(raw);
  }
  decodeBytes(raw) {
    const encoded = raw.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) throw new Error(tr('服务器未返回有效的 Base64 文件内容'));
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error(tr('服务器返回的文件内容编码无效'));
    return bytes;
  }
  async content(id, rev, path, base = false) {
    const result = require('./files').textContent(await this.bytes(id, rev, path, base));
    if (!result) throw new Error(tr('此文件需要原文件预览'));
    return result.text;
  }
  action(id, action, input = {}) {
    if (!['ready', 'abandon', 'submit', 'rebase'].includes(action)) throw new Error(tr('未知变更操作'));
    return this.request(`/changes/${enc(id)}/${action}`, 'POST', input);
  }
}
module.exports = { GerritApi, normalizeUrl };
