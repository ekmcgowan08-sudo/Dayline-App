import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import MontageReveal from '../[id]';

const mockGetMontage = jest.fn();
const mockGetMontagePlaybackUrl = jest.fn();
const mockRequestMontage = jest.fn();
const mockSubscribeToMontage = jest.fn();

jest.mock('../../../../services/montages', () => ({
  getMontage: (...args: unknown[]) => mockGetMontage(...args),
  getMontagePlaybackUrl: (...args: unknown[]) => mockGetMontagePlaybackUrl(...args),
  requestMontage: (...args: unknown[]) => mockRequestMontage(...args),
  subscribeToMontage: (...args: unknown[]) => mockSubscribeToMontage(...args),
}));

jest.mock('../../../../services/reactionsComments', () => ({
  listComments: jest.fn().mockResolvedValue([]),
  listReactions: jest.fn().mockResolvedValue([]),
  postComment: jest.fn().mockResolvedValue({ error: null }),
  toggleReaction: jest.fn().mockResolvedValue(undefined),
  REACTION_EMOJIS: ['❤️', '😂', '😮', '🥹', '🙌', '🔥'],
}));

jest.mock('../../../../services/moderation', () => ({
  blockUser: jest.fn(),
  reportContent: jest.fn(),
}));

jest.mock('../../../../state/auth-store', () => ({
  useAuthStore: (selector: (s: { session: { user: { id: string } } }) => unknown) =>
    selector({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'montage-1' }),
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), loop: false }),
  VideoView: () => null,
}));

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: '/tmp/', downloadAsync: jest.fn() }));

describe('MontageReveal polling fallback', () => {
  beforeEach(() => {
    // @testing-library/react-native's `waitFor` is fake-timer-aware and
    // auto-advances pending fake timers (including our manual
    // advanceTimersByTime calls below) while it polls for an assertion to
    // pass, which is what lets promise microtask chains and the interval
    // tick interleave correctly in this test.
    jest.useFakeTimers();
    mockGetMontage.mockReset();
    mockGetMontagePlaybackUrl.mockReset();
    mockRequestMontage.mockReset();
    mockSubscribeToMontage.mockReset();
    // Realtime never delivers an update in this test — proving the poll is
    // the only thing that can ever move this screen past "processing".
    mockSubscribeToMontage.mockReturnValue(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('keeps polling getMontage every 4s while status is processing, even though the subscribe effect only ever runs once for this id', async () => {
    mockGetMontage.mockResolvedValue({
      id: 'montage-1',
      status: 'processing',
      error_code: null,
      group_id: null,
      session_date: '2026-09-04',
      user_id: 'user-1',
    });

    render(<MontageReveal />);
    await waitFor(() => expect(mockGetMontage).toHaveBeenCalledTimes(1));

    // Before the fix, the poll's setInterval callback closed over `montage`
    // from the initial render (still null at that point), so this
    // condition was permanently false and getMontage was never called
    // again no matter how much time passed.
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(mockGetMontage).toHaveBeenCalledTimes(2));

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(mockGetMontage).toHaveBeenCalledTimes(3));
  });
});
