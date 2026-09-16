import { createServer, type Server } from 'node:net';
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';

/**
 * Proves docs/IMPLEMENTATION_STATUS.md Phase 55: pushNotifications.ts used
 * to call the raw global `fetch` directly against Expo's push API,
 * bypassing supabaseAdmin (and Phase 54's fix) entirely. A real TCP server
 * that accepts the connection but never responds — a genuine hang, not a
 * mock of one — simulates a stalled Expo push API call. This tests the
 * *wiring*: that the exported, publicly-called sendMontageReadyPush/
 * sendGroupMontageReadyPush functions resolve instead of hanging, not just
 * that createTimeoutFetch itself works in isolation (already proven by
 * timeoutFetch.test.ts).
 */

let server: Server;
let port: number;

function makeSupabaseAdminMock() {
  return {
    from: (table: string) => ({
      select: (_cols: string) => ({
        in: async (_col: string, ids: string[]) => {
          if (table === 'device_push_tokens') {
            return { data: ids.map((id) => ({ expo_push_token: `token-${id}` })) };
          }
          return { data: [] }; // notification_preferences: nobody opted out
        },
        eq: (_col: string, _val: string) => {
          if (table === 'group_members') {
            return Promise.resolve({ data: [{ user_id: 'member-1' }, { user_id: 'member-2' }] });
          }
          return { maybeSingle: async () => ({ data: { name: 'Test Group' } }) };
        },
      }),
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  };
}

before(async () => {
  server = createServer((socket) => {
    // Accept the connection and read the request, but never respond.
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;

  mock.module('../config.js', {
    namedExports: {
      config: {
        expoPushUrl: `http://127.0.0.1:${port}/`,
        expoPushTimeoutMs: 300,
        expoAccessToken: '',
      },
    },
  });

  mock.module('../supabaseAdmin.js', {
    namedExports: { supabaseAdmin: makeSupabaseAdminMock() },
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('sendMontageReadyPush resolves (does not hang) when Expo push API hangs', async () => {
  const { sendMontageReadyPush } = await import('../pushNotifications.js');
  const startedAt = Date.now();
  await sendMontageReadyPush('user-1', 'montage-1');
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 5000, `expected sendMontageReadyPush to return quickly, took ${elapsedMs}ms`);
});

test('sendGroupMontageReadyPush resolves (does not hang) when Expo push API hangs', async () => {
  const { sendGroupMontageReadyPush } = await import('../pushNotifications.js');
  const startedAt = Date.now();
  await sendGroupMontageReadyPush('group-1', 'montage-1', 'member-1');
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 5000, `expected sendGroupMontageReadyPush to return quickly, took ${elapsedMs}ms`);
});
