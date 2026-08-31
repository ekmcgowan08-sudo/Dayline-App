import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGroupMontageReadyMessages, buildMontageReadyMessages } from '../pushNotifications.js';

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

test('buildGroupMontageReadyMessages uses the group-specific title/body and includes the group name', () => {
  const messages = buildGroupMontageReadyMessages(['ExponentPushToken[ccc]'], 'montage-456', 'The Crew');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, 'Our Day Is Ready 🎬');
  assert.match(messages[0].body, /The Crew/);
  assert.equal(messages[0].data.tag, 'dayline-day-ready');
  assert.equal(messages[0].data.montageId, 'montage-456');
});

test('buildGroupMontageReadyMessages shares the same notification tag as the personal variant (one deep-link handler covers both)', () => {
  const personal = buildMontageReadyMessages(['t'], 'm1');
  const group = buildGroupMontageReadyMessages(['t'], 'm1', 'Group');
  assert.equal(personal[0].data.tag, group[0].data.tag);
});
