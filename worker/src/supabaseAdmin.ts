import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { createTimeoutFetch } from './timeoutFetch.js';

/** The worker's only credential is the Supabase service role key, read
 * from its own environment (never the mobile client's bundle) — this is
 * what "secure job authentication" means for a poll-based worker: it
 * authenticates to Postgres/Storage with a privileged key that a client
 * can never obtain, rather than accepting inbound job-push requests that
 * would need their own auth scheme.
 *
 * The custom `fetch` is not optional decoration — see timeoutFetch.ts
 * and docs/IMPLEMENTATION_STATUS.md Phase 54: without it, every
 * PostgREST/Storage call this client makes has no timeout at all, and a
 * hung one would block this worker's single-job poll loop forever. */
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: createTimeoutFetch(config.supabaseRequestTimeoutMs) },
});
