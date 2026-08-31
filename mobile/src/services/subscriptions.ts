import { Platform } from 'react-native';
import Purchases, { type PurchasesOffering } from 'react-native-purchases';
import { ENV, FEATURE_FLAGS } from '../constants/config';
import { supabase } from '../lib/supabase';
import type { Entitlement } from '../types/database';

let configured = false;

/** Real RevenueCat init — only runs when a platform API key is present.
 * See docs/DECISIONS.md: without one, the app runs entirely on the mock
 * adapter (state/subscription-store.ts) and never touches this module's
 * network calls. */
export function configureRevenueCatIfLive(userId: string) {
  if (!FEATURE_FLAGS.liveSubscriptions || configured) return;
  const apiKey = Platform.OS === 'ios' ? ENV.revenueCatIosKey : ENV.revenueCatAndroidKey;
  if (!apiKey) return;
  Purchases.configure({ apiKey, appUserID: userId });
  configured = true;
}

export async function fetchOfferings(): Promise<PurchasesOffering | null> {
  if (!FEATURE_FLAGS.liveSubscriptions) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchaseCurrentOffering(): Promise<{ ok: boolean; error?: string }> {
  const offering = await fetchOfferings();
  const pkg = offering?.availablePackages[0];
  if (!pkg) return { ok: false, error: 'no_offering_available' };
  try {
    await Purchases.purchasePackage(pkg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'purchase_failed' };
  }
}

export async function restorePurchases(): Promise<{ ok: boolean; error?: string }> {
  if (!FEATURE_FLAGS.liveSubscriptions) return { ok: true };
  try {
    await Purchases.restorePurchases();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'restore_failed' };
  }
}

/** Server-side entitlement truth — the ONLY source that actually gates
 * paid features, live or mock. Fails safe: any error returns 'free'. */
export async function fetchServerEntitlement(): Promise<Entitlement> {
  const { data, error } = await supabase.rpc('current_entitlement');
  if (error || !data) return 'free';
  return data as Entitlement;
}
