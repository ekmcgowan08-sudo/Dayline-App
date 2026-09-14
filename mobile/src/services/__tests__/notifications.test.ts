// Regression test for the cold-start notification-tap deep-link gap: see
// docs/IMPLEMENTATION_STATUS.md Phase 51. addNotificationResponseReceivedListener
// only fires for a response received while the app is already running —
// the response that actually launched the app from fully killed is never
// delivered to it, so tapping a "Your Day Is Ready" push when the app
// wasn't running silently opened Today instead of the finished montage.
import { handleColdStartNotification } from '../notifications';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (path: string) => mockPush(path) } }));

const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn(async () => undefined);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
  clearLastNotificationResponseAsync: () => mockClearLastNotificationResponseAsync(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

describe('handleColdStartNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deep-links to the finished montage when the app was launched by tapping a "day is ready" push', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { tag: 'dayline-day-ready', montageId: 'm-123' } } } },
    });

    await handleColdStartNotification();

    expect(mockPush).toHaveBeenCalledWith('/(app)/montage/m-123');
    expect(mockClearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('does not navigate when the app was launched normally (no notification response)', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);

    await handleColdStartNotification();

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not navigate for a notification response of an unrelated type', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { tag: 'dayline-capture-reminder' } } } },
    });

    await handleColdStartNotification();

    expect(mockPush).not.toHaveBeenCalled();
  });
});
