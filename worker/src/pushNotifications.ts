import { config } from './config.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabaseAdmin.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type ExpoPushTicket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };
export type ExpoPushMessage = { to: string; title: string; body: string; data: Record<string, unknown> };

/** Both montage-ready push variants deep-link to the same place, so they
 * share one tag/data shape — mobile/src/lib/notificationRouting.ts
 * doesn't need to know personal and group pushes are sent differently. */
const MONTAGE_READY_TAG = 'dayline-day-ready';

/** Pure and separately testable — the actual token lookup/HTTP call
 * below needs a live Supabase project to exercise for real, but the
 * message shape itself doesn't. */
export function buildMontageReadyMessages(expoPushTokens: string[], montageId: string): ExpoPushMessage[] {
  return expoPushTokens.map((to) => ({
    to,
    title: 'Your Day Is Ready 🎬',
    body: "Today's five seconds, all in one place.",
    data: { tag: MONTAGE_READY_TAG, montageId },
  }));
}

export function buildGroupMontageReadyMessages(expoPushTokens: string[], montageId: string, groupName: string): ExpoPushMessage[] {
  return expoPushTokens.map((to) => ({
    to,
    title: 'Our Day Is Ready 🎬',
    body: `${groupName}'s clips from today, all in one place.`,
    data: { tag: MONTAGE_READY_TAG, montageId },
  }));
}

/** Sends a batch and prunes any token Expo reports as no-longer-registered.
 * Shared by both push variants below — same delivery/cleanup mechanics,
 * only the message content and the recipient-selection logic differ. */
async function deliverExpoMessages(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  const result = (await response.json()) as { data?: ExpoPushTicket[] };

  const invalidTokens: string[] = [];
  (result.data ?? []).forEach((ticket, idx) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      invalidTokens.push(messages[idx].to);
    }
  });
  if (invalidTokens.length > 0) {
    await supabaseAdmin.from('device_push_tokens').delete().in('expo_push_token', invalidTokens);
  }
}

/** Filters a list of user ids down to those who haven't opted out of
 * montage-ready pushes (missing preference row = opted in, same default
 * as the column itself). One notification type, one preference — a group
 * push uses the same opt-out as a personal one rather than inventing a
 * second toggle for what is, from the recipient's point of view, the
 * same kind of notification. */
async function filterOptedIn(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data: prefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, montage_ready_notifications')
    .in('user_id', userIds);
  const optedOut = new Set((prefs ?? []).filter((p) => p.montage_ready_notifications === false).map((p) => p.user_id as string));
  return userIds.filter((id) => !optedOut.has(id));
}

async function getExpoPushTokens(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data: tokens } = await supabaseAdmin.from('device_push_tokens').select('expo_push_token').in('user_id', userIds);
  return (tokens ?? []).map((t) => t.expo_push_token as string);
}

/**
 * "Your Day Is Ready" push, sent the moment a personal montage finishes
 * rendering — the render worker is the only thing that knows this exact
 * moment, so it sends the push directly rather than a separate polling
 * function noticing the status change later (which would add latency for
 * no benefit, unlike send-capture-reminders' backup-delivery role, where
 * the primary path is a local notification scheduled well in advance).
 *
 * Non-fatal by design, same as runJob.ts's "mark clips used" step: a
 * failure here must never affect the montage the user already sees as
 * ready.
 */
export async function sendMontageReadyPush(userId: string, montageId: string): Promise<void> {
  try {
    const [optedIn] = await filterOptedIn([userId]);
    if (!optedIn) return;
    const tokens = await getExpoPushTokens([userId]);
    if (tokens.length === 0) return;
    await deliverExpoMessages(buildMontageReadyMessages(tokens, montageId));
  } catch (e) {
    logger.warn('failed to send montage-ready push (non-fatal)', { userId, montageId, error: (e as Error).message });
  }
}

/**
 * "Our Day Is Ready" push for a group montage — every member EXCEPT the
 * one who requested it (they already watched it render, having just
 * tapped "Create Our Day"). This was originally deferred pending a
 * product decision on who should be notified; decided here rather than
 * left open, since "everyone but the requester" is the option that
 * matches what a group montage actually is — a shared thing everyone
 * else finds out about, not something they triggered themselves. Same
 * non-fatal treatment and opt-out preference as the personal variant.
 */
export async function sendGroupMontageReadyPush(groupId: string, montageId: string, excludeUserId: string): Promise<void> {
  try {
    const { data: members } = await supabaseAdmin.from('group_members').select('user_id').eq('group_id', groupId);
    const recipientIds = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== excludeUserId);
    if (recipientIds.length === 0) return;

    const optedInIds = await filterOptedIn(recipientIds);
    if (optedInIds.length === 0) return;

    const tokens = await getExpoPushTokens(optedInIds);
    if (tokens.length === 0) return;

    const { data: group } = await supabaseAdmin.from('groups').select('name').eq('id', groupId).maybeSingle();
    await deliverExpoMessages(buildGroupMontageReadyMessages(tokens, montageId, group?.name ?? 'Your group'));
  } catch (e) {
    logger.warn('failed to send group montage-ready push (non-fatal)', { groupId, montageId, error: (e as Error).message });
  }
}
