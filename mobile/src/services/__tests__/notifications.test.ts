// Regression test for the cold-start notification-tap deep-link gap: see
// docs/IMPLEMENTATION_STATUS.md Phase 51. addNotificationResponseReceivedListener
// only fires for a response received while the app is already running —
// the response that actually launched the app from fully killed is never
// delivered to it, so tapping a "Your Day Is Ready" push when the app
// wasn't running silently opened Today instead of the finished montage.
import { handleColdStartNotification, registerPushTokenRefreshListener } from '../notifications';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (path: string) => mockPush(path) } }));

const mockGetLastNotificationResponseAsync = jest.fn();
const mockClearLastNotificationResponseAsync = jest.fn(async () => undefined);
let pushTokenListenerCallback: ((tokenData: { data: string }) => void) | undefined;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
  clearLastNotificationResponseAsync: () => mockClearLastNotificationResponseAsync(),
  addPushTokenListener: (cb: (tokenData: { data: string }) => void) => {
    pushTokenListenerCallback = cb;
    return { remove: jest.fn() };
  },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const mockRpc = jest.fn(async (_name: string, _params: unknown) => ({ error: null }));
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (name: string, params: unknown) => mockRpc(name, params) },
}));

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

// Regression test for docs/IMPLEMENTATION_STATUS.md Phase 52:
// registerPushToken() only ever ran once, during onboarding, which
// never runs again for an account that's already completed it — so an
// existing user's push token never got (re-)registered after a
// reinstall, a new device, or an OS-level token rotation while the app
// was already installed. registerPushTokenRefreshListener() closes the
// live-rotation half of that gap (the app-startup re-registration half
// lives in app/_layout.tsx, not unit-tested here for the same reason
// registerNotificationTapHandler() never was — it's thin RN-lifecycle
// wiring, not logic).
describe('registerPushTokenRefreshListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushTokenListenerCallback = undefined;
  });

  it('sends a rotated push token to the server via register_push_token', () => {
    registerPushTokenRefreshListener();
    expect(pushTokenListenerCallback).toBeDefined();

    pushTokenListenerCallback!({ data: 'ExponentPushToken[new-rotated-token]' });

    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      p_expo_push_token: 'ExponentPushToken[new-rotated-token]',
      p_platform: expect.any(String),
    });
  });
});
