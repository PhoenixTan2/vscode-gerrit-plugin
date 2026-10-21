'use strict';
class Logger {
  constructor(output, level = 'info') { this.output = output; this.level = level; this.secrets = new Set(); }
  protect(value) { if (value) this.secrets.add(String(value)); }
  redact(value) {
    let text = String(value);
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
      .replace(/(Authorization\s*[:=]\s*)(?:Basic|Bearer)\s+[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/((?:Cookie|Set-Cookie|X-Gerrit-Auth)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
      .replace(/([?&](?:access_token|token|password|key)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  write(level, message) {
    const levels = { off: -1, error: 0, info: 1, debug: 2 };
    if ((levels[level] ?? 1) <= (levels[this.level] ?? 1)) this.output.appendLine(`${new Date().toISOString()} [${level.toUpperCase()}] ${this.redact(message)}`);
  }
}
module.exports = { Logger };
