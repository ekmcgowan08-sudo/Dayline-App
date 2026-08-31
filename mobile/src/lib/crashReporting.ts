import * as Sentry from '@sentry/react-native';
import { ENV, FEATURE_FLAGS } from '../constants/config';

/**
 * Same treatment as the RevenueCat mock adapter (see
 * src/state/subscription-store.ts and docs/DECISIONS.md): no DSN means
 * this is a real, honest no-op, never a pretend-it-worked stub. `init()`
 * only calls Sentry.init when a DSN is actually configured, and every
 * other export below checks the same flag before touching the SDK — so an
 * unconfigured app never silently queues events nobody will read, and
 * never crashes over the *absence* of crash reporting either.
 */
export function initCrashReporting(): void {
  if (!FEATURE_FLAGS.crashReporting) {
    console.log('[crashReporting] No EXPO_PUBLIC_SENTRY_DSN configured — crash reporting is a no-op in this build.');
    return;
  }
  Sentry.init({
    dsn: ENV.sentryDsn,
    // Errors happen off-device from real people's private clips; keep the
    // default breadcrumb/session behavior but never attach screenshots or
    // view hierarchies, which could capture on-screen private media.
    attachScreenshot: false,
    tracesSampleRate: 0.2,
  });
}

/** Never throws — a crash-reporting call must never itself become the crash. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!FEATURE_FLAGS.crashReporting) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // deliberately swallowed — see the function comment
  }
}

/** Associates future events with a user without ever sending anything
 * beyond an opaque id — no email, no display name, no clip content. */
export function setCrashReportingUser(userId: string | null): void {
  if (!FEATURE_FLAGS.crashReporting) return;
  try {
    Sentry.setUser(userId ? { id: userId } : null);
  } catch {
    // deliberately swallowed
  }
}

export const CrashReportingErrorBoundary = Sentry.ErrorBoundary;
