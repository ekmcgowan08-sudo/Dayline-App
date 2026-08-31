import { initCrashReporting, reportError, setCrashReportingUser } from '../crashReporting';

// No EXPO_PUBLIC_SENTRY_DSN is set in the test environment, so
// FEATURE_FLAGS.crashReporting is false — every export here must be a
// real, safe no-op in that state (see the file's own comment on why: an
// unconfigured build must never pretend to report crashes, and must never
// crash over the absence of crash reporting either).
describe('crash reporting (unconfigured / no DSN)', () => {
  it('initCrashReporting does not throw and does not initialize the Sentry SDK', () => {
    expect(() => initCrashReporting()).not.toThrow();
  });

  it('reportError does not throw for a real Error', () => {
    expect(() => reportError(new Error('test error'))).not.toThrow();
  });

  it('reportError does not throw for a non-Error thrown value', () => {
    expect(() => reportError('a string was thrown')).not.toThrow();
  });

  it('reportError does not throw when extra context is provided', () => {
    expect(() => reportError(new Error('with context'), { screen: 'capture' })).not.toThrow();
  });

  it('setCrashReportingUser does not throw for a real id or null', () => {
    expect(() => setCrashReportingUser('user-123')).not.toThrow();
    expect(() => setCrashReportingUser(null)).not.toThrow();
  });
});
