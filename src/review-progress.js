'use strict';
const crypto = require('node:crypto');
class ReviewProgress {
  constructor(storage) {
    this.storage = storage; this.data = storage?.get?.('fileReviewProgress.v1', {}) || {}; this.saving = Promise.resolve();
  }
  key(server, account, change) { return crypto.createHash('sha256').update(JSON.stringify([server, account, change])).digest('hex'); }
  entry(key) {
    if (!this.data[key]) this.data[key] = { touched: 0, versions: {} };
    this.data[key].touched = Date.now(); return this.data[key];
  }
  ensure(key, rev) {
    const entry = this.entry(key);
    if (!entry.versions[rev]) entry.versions[rev] = { read: [], explicit: [], ready: false };
    return entry.versions[rev];
  }
  baseline(key, revisions, rev) {
    const versions = this.entry(key).versions, number = revisions[rev]?._number;
    return Object.keys(versions).filter(sha => revisions[sha]?._number < number).sort((a,b) => revisions[b]._number - revisions[a]._number)[0];
  }
  prepare(key, rev, baseline, changes = {}) {
    const record = this.ensure(key, rev);
    if (!record.ready) {
      const changed = new Set(Object.entries(changes).filter(([p]) => !p.startsWith('/')).flatMap(([p,file]) => [p, ...(file.old_path ? [file.old_path] : [])]));
      const read = new Set(record.read), explicit = new Set(record.explicit);
      for (const p of this.entry(key).versions[baseline]?.read || []) if (!changed.has(p) && !explicit.has(p)) read.add(p);
      Object.assign(record, { read: [...read], changed: [...changed], baseline, ready: true });
      this.persist().catch(() => {});
    }
    return record;
  }
  mark(key, rev, file, read) {
    const record = this.ensure(key, rev), files = new Set(record.read);
    if (read) files.add(file); else files.delete(file);
    record.read = [...files]; record.explicit = [...new Set([...record.explicit, file])]; return this.persist();
  }
  persist() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.saving = this.saving.catch(() => {}).then(() => this.storage?.update?.('fileReviewProgress.v1', snapshot));
    return this.saving;
  }
}
module.exports = { ReviewProgress };
