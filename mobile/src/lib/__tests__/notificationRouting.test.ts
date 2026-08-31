import { getMontageIdFromNotificationData } from '../notificationRouting';

describe('getMontageIdFromNotificationData', () => {
  it('extracts the montage id from a well-formed "Your Day Is Ready" payload', () => {
    expect(getMontageIdFromNotificationData({ tag: 'dayline-day-ready', montageId: 'abc-123' })).toBe('abc-123');
  });

  it('returns null for a capture-reminder payload (no deep link target)', () => {
    expect(getMontageIdFromNotificationData({ tag: 'dayline-capture-reminder', captureSlotId: 'slot-1' })).toBeNull();
  });

  it('returns null when data is undefined', () => {
    expect(getMontageIdFromNotificationData(undefined)).toBeNull();
  });

  it('returns null when montageId is missing or not a string', () => {
    expect(getMontageIdFromNotificationData({ tag: 'dayline-day-ready' })).toBeNull();
    expect(getMontageIdFromNotificationData({ tag: 'dayline-day-ready', montageId: 42 })).toBeNull();
  });

  it('returns null for an empty montageId', () => {
    expect(getMontageIdFromNotificationData({ tag: 'dayline-day-ready', montageId: '' })).toBeNull();
  });
});
