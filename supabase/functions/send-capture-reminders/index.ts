// Server-side backup delivery for capture reminders. The primary delivery
// path is the local notification the mobile app schedules itself (see
// mobile/src/services/notifications.ts); that path is silent and free but
// doesn't fire if the app was killed/reinstalled since the schedule was
// last computed. This function closes that gap by reading the SAME
// capture_slots rows the client already wrote (see
// syncTodaysCaptureSlots) — it never recomputes the schedule itself, so
// there's no risk of drifting from the timezone/DST-aware logic in
// mobile/src/services/schedule.ts.
//
// Intended to run on a schedule (every few minutes) via pg_cron + pg_net
// — see the setup instructions in supabase/migrations/
// 20260831160000_server_push_delivery.sql and docs/DEPLOYMENT.md. Not a
// user-facing function: it's invoked with a shared secret, not a user JWT.
//
// Deploy: supabase functions deploy send-capture-reminders --no-verify-jwt
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
// Env optional: EXPO_ACCESS_TOKEN (Expo's optional enhanced push security token)
import { adminClient, json, CORS_HEADERS } from '../_shared/client.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Slots older than this are treated as missed rather than notified late —
// if the cron job was down for hours, we don't want a backlog of stale
// "capture this moment" pushes arriving all at once.
const STALE_WINDOW_MINUTES = 15;
// Grace period before the server push fires, giving the client's own
// local notification (scheduled for the exact same moment) a head start.
// This can't guarantee zero duplicates — neither iOS nor Android hands
// back a delivery receipt for a local notification, so there's no way to
// know for certain it fired — but it meaningfully reduces near-
// simultaneous double-fires, and the mobile client additionally
// suppresses a duplicate *display* for a slot it already locally notified
// for (see the notification handler in mobile/src/services/notifications.ts,
// backed by mobile/src/lib/notificationDedup.ts).
const GRACE_PERIOD_MINUTES = 3;
const BATCH_SIZE = 100; // Expo's push API accepts up to 100 messages per request

type ExpoPushTicket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedAuth = req.headers.get('Authorization');
  if (!cronSecret || providedAuth !== `Bearer ${cronSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = adminClient();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_WINDOW_MINUTES * 60 * 1000);
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_MINUTES * 60 * 1000);

  const { data: dueSlots, error: slotsError } = await admin
    .from('capture_slots')
    .select('id, user_id, scheduled_at')
    .eq('status', 'pending')
    .is('notified_at', null)
    .lte('scheduled_at', graceCutoff.toISOString())
    .gte('scheduled_at', staleCutoff.toISOString());

  if (slotsError) return json({ error: slotsError.message }, 500);
  if (!dueSlots || dueSlots.length === 0) return json({ ok: true, notified: 0 });

  // Skip users who paused capture after their slot rows were already
  // created — a rare but real edge case.
  const userIds = [...new Set(dueSlots.map((s) => s.user_id))];
  const { data: prefs } = await admin
    .from('notification_preferences')
    .select('user_id, paused_until')
    .in('user_id', userIds);
  const pausedUserIds = new Set(
    (prefs ?? [])
      .filter((p) => p.paused_until && p.paused_until >= now.toISOString().slice(0, 10))
      .map((p) => p.user_id)
  );

  const activeSlots = dueSlots.filter((s) => !pausedUserIds.has(s.user_id));
  const activeUserIds = [...new Set(activeSlots.map((s) => s.user_id))];

  const { data: tokens } = await admin
    .from('device_push_tokens')
    .select('id, user_id, expo_push_token')
    .in('user_id', activeUserIds.length > 0 ? activeUserIds : ['00000000-0000-0000-0000-000000000000']);

  const tokensByUser = new Map<string, { id: string; expo_push_token: string }[]>();
  for (const t of tokens ?? []) {
    const list = tokensByUser.get(t.user_id) ?? [];
    list.push({ id: t.id, expo_push_token: t.expo_push_token });
    tokensByUser.set(t.user_id, list);
  }

  const messages: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
  for (const slot of activeSlots) {
    for (const t of tokensByUser.get(slot.user_id) ?? []) {
      messages.push({
        to: t.expo_push_token,
        title: 'Capture this moment',
        body: 'Five seconds of right now — whatever it is.',
        data: { tag: 'dayline-capture-reminder', captureSlotId: slot.id },
      });
    }
  }

  let sent = 0;
  const invalidTokens: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(Deno.env.get('EXPO_ACCESS_TOKEN')
            ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
            : {}),
        },
        body: JSON.stringify(batch),
      });
      const result = (await response.json()) as { data?: ExpoPushTicket[] };
      (result.data ?? []).forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          sent++;
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(batch[idx].to);
        }
      });
    } catch {
      // A transient failure here just means this batch's slots won't be
      // marked notified and will be retried on the next cron tick (still
      // within the stale window) — no special handling needed.
    }
  }

  if (invalidTokens.length > 0) {
    await admin.from('device_push_tokens').delete().in('expo_push_token', invalidTokens);
  }

  await admin
    .from('capture_slots')
    .update({ notified_at: now.toISOString() })
    .in('id', activeSlots.map((s) => s.id));

  return json({ ok: true, slotsProcessed: activeSlots.length, pushesSent: sent, invalidTokensRemoved: invalidTokens.length });
});
