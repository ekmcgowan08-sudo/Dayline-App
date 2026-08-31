import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FEATURE_FLAGS } from '../constants/config';
import { ENTITLEMENT_LIMITS, type EntitlementTier } from '../constants/entitlements';
import { fetchServerEntitlement } from '../services/subscriptions';
import type { Entitlement } from '../types/database';

type SubscriptionState = {
  serverEntitlement: Entitlement;
  /** Dev-only, local-only, never written to the server. Lets the mock
   * adapter preview gated UI without ever pretending a real purchase
   * happened — see docs/DECISIONS.md. Ignored entirely when
   * FEATURE_FLAGS.liveSubscriptions is true. */
  mockOverride: Entitlement | null;
  refresh: () => Promise<void>;
  setMockOverride: (value: Entitlement | null) => void;
  effectiveTier: () => EntitlementTier;
  limits: () => (typeof ENTITLEMENT_LIMITS)[EntitlementTier];
};

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      serverEntitlement: 'free',
      mockOverride: null,

      refresh: async () => {
        const entitlement = await fetchServerEntitlement();
        set({ serverEntitlement: entitlement });
      },

      setMockOverride: (value) => set({ mockOverride: value }),

      effectiveTier: () => {
        const { serverEntitlement, mockOverride } = get();
        if (!FEATURE_FLAGS.liveSubscriptions && mockOverride) return mockOverride;
        return serverEntitlement;
      },

      limits: () => ENTITLEMENT_LIMITS[get().effectiveTier()],
    }),
    {
      name: 'dayline-subscription-mock',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the dev-only mock override is worth persisting locally; the
      // real entitlement is always re-fetched from the server.
      partialize: (state) => ({ mockOverride: state.mockOverride }),
    }
  )
);
