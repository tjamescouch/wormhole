/**
 * Wormhole Relay Tests
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TransferStore } from './dist/store.js';
import { RelayServer } from './dist/server.js';

describe('TransferStore', () => {
  it('put and get a transfer', () => {
    const store = new TransferStore();
    const data = Buffer.from('hello world');
    const result = store.put('abc123', data);
    assert.deepStrictEqual(result, { ok: true });

    const entry = store.get('abc123');
    assert.ok(entry);
    assert.deepStrictEqual(entry.data, data);
    store.destroy();
  });

  it('get deletes the entry (one-time retrieval)', () => {
    const store = new TransferStore();
    store.put('abc123', Buffer.from('data'));

    const first = store.get('abc123');
    assert.ok(first);

    const second = store.get('abc123');
    assert.strictEqual(second, null);
    store.destroy();
  });

  it('rejects duplicate transfer IDs', () => {
    const store = new TransferStore();
    store.put('abc123', Buffer.from('first'));
    const result = store.put('abc123', Buffer.from('second'));
    assert.strictEqual(result.ok, false);
    store.destroy();
  });

  it('rejects oversized transfers', () => {
    const store = new TransferStore({ maxSize: 100 });
    const data = Buffer.alloc(200);
    const result = store.put('big', data);
    assert.strictEqual(result.ok, false);
    store.destroy();
  });

  it('accepts transfer at exactly max size', () => {
    const store = new TransferStore({ maxSize: 100 });
    const data = Buffer.alloc(100);
    const result = store.put('exact', data);
    assert.deepStrictEqual(result, { ok: true });
    store.destroy();
  });

  it('delete removes a transfer', () => {
    const store = new TransferStore();
    store.put('abc123', Buffer.from('data'));
    assert.strictEqual(store.delete('abc123'), true);
    assert.strictEqual(store.get('abc123'), null);
    store.destroy();
  });

  it('delete returns false for non-existent transfer', () => {
    const store = new TransferStore();
    assert.strictEqual(store.delete('nonexistent'), false);
    store.destroy();
  });

  it('cleanup removes expired entries', () => {
    const store = new TransferStore({ ttlMs: 1, cleanupIntervalMs: 999999 });
    store.put('old', Buffer.from('expired'));

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 10) {} // spin

    const removed = store.cleanup();
    assert.strictEqual(removed, 1);
    assert.strictEqual(store.count, 0);
    store.destroy();
  });

  it('count tracks entries', () => {
    const store = new TransferStore();
    assert.strictEqual(store.count, 0);
    store.put('a', Buffer.from('1'));
    store.put('b', Buffer.from('2'));
    assert.strictEqual(store.count, 2);
    store.get('a');
    assert.strictEqual(store.count, 1);
    store.destroy();
  });

  it('has checks existence', () => {
    const store = new TransferStore();
    store.put('abc', Buffer.from('data'));
    assert.strictEqual(store.has('abc'), true);
    assert.strictEqual(store.has('xyz'), false);
    store.destroy();
  });
});

describe('RelayServer HTTP', () => {
  let server: RelayServer;
  let baseUrl: string;
  const testPort = 18700 + Math.floor(Math.random() * 100);

  before(async () => {
    server = new RelayServer({ port: testPort, maxSize: 1024 });
    await server.start();
    baseUrl = `http://localhost:${testPort}`;
  });

  after(async () => {
    await server.stop();
  });

  it('health endpoint returns status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { status: string; transfers: number };
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(typeof body.transfers, 'number');
  });

  it('PUT stores and GET retrieves a transfer', async () => {
    const id = 'deadbeef01';
    const data = Buffer.from('hello relay');

    const putRes = await fetch(`${baseUrl}/transfer/${id}`, {
      method: 'PUT',
      body: data,
    });
    assert.strictEqual(putRes.status, 201);

    const getRes = await fetch(`${baseUrl}/transfer/${id}`);
    assert.strictEqual(getRes.status, 200);
    const body = Buffer.from(await getRes.arrayBuffer());
    assert.deepStrictEqual(body, data);
  });

  it('GET returns 404 after retrieval (one-time)', async () => {
    const id = 'deadbeef02';
    await fetch(`${baseUrl}/transfer/${id}`, { method: 'PUT', body: Buffer.from('once') });

    await fetch(`${baseUrl}/transfer/${id}`); // first get
    const res = await fetch(`${baseUrl}/transfer/${id}`); // second get
    assert.strictEqual(res.status, 404);
  });

  it('PUT rejects duplicate IDs', async () => {
    const id = 'deadbeef03';
    await fetch(`${baseUrl}/transfer/${id}`, { method: 'PUT', body: Buffer.from('first') });
    const res = await fetch(`${baseUrl}/transfer/${id}`, { method: 'PUT', body: Buffer.from('second') });
    assert.strictEqual(res.status, 409);
  });

  it('PUT rejects oversized payloads', async () => {
    const id = 'deadbeef04';
    const big = Buffer.alloc(2048); // server maxSize is 1024
    const res = await fetch(`${baseUrl}/transfer/${id}`, { method: 'PUT', body: big });
    assert.ok(res.status === 413 || res.status === 409);
  });

  it('DELETE removes a transfer', async () => {
    const id = 'deadbeef05';
    await fetch(`${baseUrl}/transfer/${id}`, { method: 'PUT', body: Buffer.from('delete me') });

    const delRes = await fetch(`${baseUrl}/transfer/${id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    const getRes = await fetch(`${baseUrl}/transfer/${id}`);
    assert.strictEqual(getRes.status, 404);
  });

  it('DELETE returns 404 for non-existent transfer', async () => {
    const res = await fetch(`${baseUrl}/transfer/nonexistent123456`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
  });

  it('GET returns 404 for non-existent transfer', async () => {
    const res = await fetch(`${baseUrl}/transfer/nonexistent789abc`);
    assert.strictEqual(res.status, 404);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.strictEqual(res.status, 404);
  });

  it('CORS headers are present', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });

  it('OPTIONS returns 204', async () => {
    const res = await fetch(`${baseUrl}/transfer/test`, { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
  });
});
