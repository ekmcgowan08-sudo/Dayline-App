import { render, screen, waitFor } from '@testing-library/react-native';
import ResetPassword from '../reset-password';

const mockGetInitialURL = jest.fn();
const mockAddEventListener = jest.fn();
const mockSetSession = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('expo-linking', () => ({
  getInitialURL: (...args: unknown[]) => mockGetInitialURL(...args),
  addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
}));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
  },
}));

describe('ResetPassword', () => {
  beforeEach(() => {
    mockGetInitialURL.mockReset();
    mockAddEventListener.mockReset();
    mockSetSession.mockReset();
    mockUpdateUser.mockReset();
    mockAddEventListener.mockReturnValue({ remove: jest.fn() });
    mockSetSession.mockResolvedValue({ error: null });
  });

  it('establishes a recovery session from the deep link\'s fragment tokens and renders the reset form', async () => {
    // Before this screen existed, this deep link had nowhere to go at all —
    // this proves both that the fragment-token parsing wires up correctly
    // end to end (not just the pure-function unit tests in
    // passwordResetLink.test.ts) and that the screen doesn't get bounced
    // away by (auth)/_layout.tsx's "already signed in? redirect to /" check
    // the instant the recovery session makes `session` non-null — it's a
    // top-level route specifically to avoid that collision.
    mockGetInitialURL.mockResolvedValue(
      'dayline://reset-password#access_token=tok-a&refresh_token=tok-b&type=recovery'
    );

    render(<ResetPassword />);

    await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'tok-a', refresh_token: 'tok-b' }));
    await waitFor(() => expect(screen.getByText('Set a new password')).toBeTruthy());
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
  });

  it('shows an invalid-link message when the deep link carries no recovery tokens, instead of a permanent spinner', async () => {
    mockGetInitialURL.mockResolvedValue('dayline://reset-password');

    render(<ResetPassword />);

    await waitFor(() => expect(screen.getByText("This link isn't valid")).toBeTruthy(), { timeout: 6000 });
    expect(mockSetSession).not.toHaveBeenCalled();
  }, 10000);
});
