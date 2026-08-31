import { config } from './config.js';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabaseAdmin.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type ExpoPushTicket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };
export type ExpoPushMessage = { to: string; title: string; body: string; data: Record<string, unknown> };

/** Pure and separately testable — the actual token lookup/HTTP call in
 * sendMontageReadyPush() below needs a live Supabase project to exercise
 * for real, but the message shape itself doesn't. */
export function buildMontageReadyMessages(expoPushTokens: string[], montageId: string): ExpoPushMessage[] {
  return expoPushTokens.map((to) => ({
    to,
    title: 'Your Day Is Ready 🎬',
    body: "Today's five seconds, all in one place.",
    data: { tag: 'dayline-day-ready', montageId },
  }));
}

/**
 * "Your Day Is Ready" push, sent the moment a personal montage finishes
 * rendering — the render worker is the only thing that knows this exact
 * moment, so it sends the push directly rather than a separate polling
 * function noticing the status change later (which would add latency for
 * no benefit, unlike send-capture-reminders' backup-delivery role, where
 * the primary path is a local notification scheduled well in advance).
 *
 * Group montages deliberately do NOT get this push: the requester is
 * already watching it render (they just tapped "Create Our Day"), and
 * deciding who among the group should be notified — everyone? only
 * non-contributors? — is a real product question worth its own pass, not
 * something to default silently here.
 *
 * Non-fatal by design, same as runJob.ts's "mark clips used" step: a
 * failure here must never affect the montage the user already sees as
 * ready.
 */
export async function sendMontageReadyPush(userId: string, montageId: string): Promise<void> {
  try {
    const { data: prefs } = await supabaseAdmin
      .from('notification_preferences')
      .select('montage_ready_notifications')
      .eq('user_id', userId)
      .maybeSingle();
    if (prefs?.montage_ready_notifications === false) return;

    const { data: tokens } = await supabaseAdmin
      .from('device_push_tokens')
      .select('expo_push_token')
      .eq('user_id', userId);
    if (!tokens || tokens.length === 0) return;

    const messages = buildMontageReadyMessages(
      tokens.map((t) => t.expo_push_token as string),
      montageId
    );

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
  } catch (e) {
    logger.warn('failed to send montage-ready push (non-fatal)', { userId, montageId, error: (e as Error).message });
  }
}
