/**
 * Structured (one-JSON-object-per-line) logging. No external dependency —
 * this is deliberately minimal so the worker's dependency surface stays
 * small. Never log signed URLs, storage paths, or raw tokens (see
 * docs/SECURITY.md's log-redaction requirement) — pass a `redact` list of
 * field names to strip from `fields` before it's serialized.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = new Set(['signedUrl', 'url', 'token', 'serviceRoleKey', 'storagePath']);

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}

function log(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...sanitize(fields),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log('error', message, fields),
};
