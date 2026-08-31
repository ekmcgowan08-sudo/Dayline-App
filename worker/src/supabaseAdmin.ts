import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

/** The worker's only credential is the Supabase service role key, read
 * from its own environment (never the mobile client's bundle) — this is
 * what "secure job authentication" means for a poll-based worker: it
 * authenticates to Postgres/Storage with a privileged key that a client
 * can never obtain, rather than accepting inbound job-push requests that
 * would need their own auth scheme. */
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
