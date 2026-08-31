import { AppState } from 'react-native';
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

// Per Supabase's Expo/React Native guidance: auto-refresh should only run
// while the app is foregrounded, otherwise background timers can pile up
// token refreshes that fail once the app resumes.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  /** True until the very first getSession() resolves. Drives the app's initial splash/redirect. */
  initializing: boolean;
  /** True once the profile fetch for the current session has completed (success or not-found). */
  profileLoaded: boolean;
  initialize: () => void;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
};

let initialized = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initializing: true,
  profileLoaded: false,

  initialize: () => {
    if (initialized) return;
    initialized = true;

    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, initializing: false });
      if (data.session) get().refreshProfile();
      else set({ profileLoaded: true });
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, initializing: false });
      if (session) {
        get().refreshProfile();
      } else {
        set({ profile: null, profileLoaded: true });
      }
    });
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'dayline://reset-password',
    });
    return { error: error?.message ?? null };
  },

  refreshProfile: async () => {
    const userId = get().session?.user.id;
    if (!userId) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    set({ profile: (data as Profile) ?? null, profileLoaded: true });
  },
}));
