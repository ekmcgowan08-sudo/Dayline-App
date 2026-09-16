import { createServer, type Server } from 'node:net';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTimeoutFetch } from '../timeoutFetch.js';

// Proves docs/IMPLEMENTATION_STATUS.md Phase 54: a real TCP server that
// accepts the connection but never writes a response — a genuine hang,
// not a mock of one — simulates a stalled network call to Supabase.
// Node's own fetch has no default timeout, so without createTimeoutFetch
// this would block forever.

let server: Server;
let port: number;

before(async () => {
  server = createServer((socket) => {
    // Accept the connection and read the request, but never respond —
    // the client is left waiting on the response indefinitely.
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('createTimeoutFetch rejects (instead of hanging forever) against a server that never responds', async () => {
  const timeoutFetch = createTimeoutFetch(300);
  const startedAt = Date.now();

  await assert.rejects(() => timeoutFetch(`http://127.0.0.1:${port}/`), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'TimeoutError');
    return true;
  });

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 5000, `expected the timeout to fire quickly, took ${elapsedMs}ms`);
});
