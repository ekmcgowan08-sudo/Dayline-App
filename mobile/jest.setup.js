jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest')
);

// The real @sentry/react-native SDK sets up native-module bridging and
// internal timers on import that never tear down cleanly in Jest's
// environment (a documented issue for the RN SDK generally, not specific
// to this app) — mocked here the same way AsyncStorage is mocked above,
// with just enough surface for src/lib/crashReporting.ts's own no-op-path
// tests to exercise real call sites against.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  setUser: jest.fn(),
  ErrorBoundary: ({ children }) => children,
}));
