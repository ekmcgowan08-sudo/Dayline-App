/**
 * Wraps the global `fetch` with a hard timeout. Neither Node's own
 * `fetch` nor `@supabase/supabase-js`'s client sets one by default, so a
 * hung network call (a stalled connection, a wedged proxy, a Supabase
 * outage that accepts the TCP connection but never responds) would block
 * this worker's single-job-at-a-time poll loop forever — the exact same
 * failure shape as the hung-ffmpeg-process bug fixed in
 * docs/IMPLEMENTATION_STATUS.md Phase 53, just for every PostgREST/
 * Storage call instead of every ffmpeg invocation. Wired in by
 * supabaseAdmin.ts (every PostgREST/Storage call, Phase 54) and
 * pushNotifications.ts (the direct call to Expo's push API, Phase 55).
 */
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}
