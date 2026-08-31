import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMontageReadyMessages } from '../pushNotifications.js';

test('buildMontageReadyMessages produces one correctly-shaped Expo message per token', () => {
  const messages = buildMontageReadyMessages(['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]'], 'montage-123');
  assert.equal(messages.length, 2);
  for (const m of messages) {
    assert.equal(m.title, 'Your Day Is Ready 🎬');
    assert.equal(m.data.tag, 'dayline-day-ready');
    assert.equal(m.data.montageId, 'montage-123');
  }
  assert.equal(messages[0].to, 'ExponentPushToken[aaa]');
  assert.equal(messages[1].to, 'ExponentPushToken[bbb]');
});

test('buildMontageReadyMessages returns an empty array for no tokens', () => {
  assert.deepEqual(buildMontageReadyMessages([], 'montage-123'), []);
});
