/**
 * Wormhole Client Tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deriveEncryptionKey, deriveRelayKey, encrypt, decrypt } from './dist/crypto.js';
import { generateCode, parseCode, isValidCode, WORDS } from './dist/codes.js';
import { upload, download } from './dist/transfer.js';
import { isSlurpArchive } from './dist/slurp.js';
import { send, receive } from './dist/index.js';

// Import relay server for E2E tests
import { RelayServer } from '../wormhole-relay/dist/server.js';

describe('Crypto', () => {
  it('deriveEncryptionKey returns 32-byte buffer', () => {
    const key = deriveEncryptionKey('test-code');
    assert.strictEqual(key.length, 32);
    assert.ok(Buffer.isBuffer(key));
  });

  it('deriveRelayKey returns hex string', () => {
    const key = deriveRelayKey('test-code');
    assert.strictEqual(key.length, 64); // 32 bytes = 64 hex chars
    assert.ok(/^[a-f0-9]+$/.test(key));
  });

  it('same code produces same keys', () => {
    const k1 = deriveEncryptionKey('42-banana-thunder');
    const k2 = deriveEncryptionKey('42-banana-thunder');
    assert.deepStrictEqual(k1, k2);
  });

  it('different codes produce different encryption keys', () => {
    const k1 = deriveEncryptionKey('1-apple-orange');
    const k2 = deriveEncryptionKey('2-apple-orange');
    assert.notDeepStrictEqual(k1, k2);
  });

  it('encryption key and relay key are different for same code', () => {
    const encKey = deriveEncryptionKey('42-banana-thunder');
    const relayKey = deriveRelayKey('42-banana-thunder');
    assert.notStrictEqual(encKey.toString('hex'), relayKey);
  });

  it('encrypt/decrypt round-trip', () => {
    const key = deriveEncryptionKey('test-code');
    const plaintext = Buffer.from('hello wormhole!');
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    assert.deepStrictEqual(decrypted, plaintext);
  });

  it('encrypt/decrypt with large payload', () => {
    const key = deriveEncryptionKey('large-test');
    const plaintext = Buffer.alloc(100_000, 0x42);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    assert.deepStrictEqual(decrypted, plaintext);
  });

  it('encrypt/decrypt with binary data', () => {
    const key = deriveEncryptionKey('binary-test');
    const plaintext = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    assert.deepStrictEqual(decrypted, plaintext);
  });

  it('encrypted output is larger than input (IV + auth tag)', () => {
    const key = deriveEncryptionKey('size-test');
    const plaintext = Buffer.from('data');
    const encrypted = encrypt(plaintext, key);
    // 12 (IV) + 4 (data) + 16 (auth tag) = 32
    assert.strictEqual(encrypted.length, 32);
  });

  it('decrypt with wrong key throws', () => {
    const key1 = deriveEncryptionKey('code-1');
    const key2 = deriveEncryptionKey('code-2');
    const encrypted = encrypt(Buffer.from('secret'), key1);
    assert.throws(() => decrypt(encrypted, key2));
  });

  it('decrypt with tampered data throws', () => {
    const key = deriveEncryptionKey('tamper-test');
    const encrypted = encrypt(Buffer.from('secret'), key);
    encrypted[20] ^= 0xff; // flip a byte
    assert.throws(() => decrypt(encrypted, key));
  });

  it('decrypt with too-short blob throws', () => {
    const key = deriveEncryptionKey('short-test');
    assert.throws(() => decrypt(Buffer.from('short'), key), /too short/);
  });
});

describe('Codes', () => {
  it('generateCode returns valid format', () => {
    const code = generateCode();
    assert.ok(/^\d+-[a-z]+-[a-z]+$/.test(code), `Bad format: ${code}`);
  });

  it('generateCode produces different codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    assert.ok(codes.size > 10, 'Should generate mostly unique codes');
  });

  it('parseCode parses valid code', () => {
    const parsed = parseCode('42-banana-thunder');
    assert.ok(parsed);
    assert.strictEqual(parsed.number, 42);
    assert.strictEqual(parsed.word1, 'banana');
    assert.strictEqual(parsed.word2, 'thunder');
  });

  it('parseCode rejects invalid formats', () => {
    assert.strictEqual(parseCode('no-number'), null);
    assert.strictEqual(parseCode('0-too-low'), null);
    assert.strictEqual(parseCode('1000-too-high'), null);
    assert.strictEqual(parseCode('42-onlyone'), null); // only two parts
    assert.strictEqual(parseCode('not-a-code'), null);
    assert.strictEqual(parseCode(''), null);
  });

  it('isValidCode validates correctly', () => {
    assert.strictEqual(isValidCode('1-alpha-beta'), true);
    assert.strictEqual(isValidCode('999-zoo-ark'), true);
    assert.strictEqual(isValidCode('bad'), false);
  });

  it('word list has enough words', () => {
    assert.ok(WORDS.length >= 400, `Only ${WORDS.length} words`);
  });

  it('word list has no duplicates', () => {
    const unique = new Set(WORDS);
    assert.strictEqual(unique.size, WORDS.length, 'Word list has duplicates');
  });

  it('generated codes have two different words', () => {
    for (let i = 0; i < 50; i++) {
      const parsed = parseCode(generateCode());
      assert.ok(parsed);
      assert.notStrictEqual(parsed.word1, parsed.word2, 'Words should differ');
    }
  });
});

describe('Slurp detection', () => {
  it('detects slurp archive', () => {
    const archive = Buffer.from('#!/bin/sh\n# --- SLURP v1 ---\nset -e\n');
    assert.strictEqual(isSlurpArchive(archive), true);
  });

  it('rejects non-slurp data', () => {
    const data = Buffer.from('{"type":"file","name":"test.txt"}\nhello');
    assert.strictEqual(isSlurpArchive(data), false);
  });
});

describe('E2E: send and receive', () => {
  let server: RelayServer;
  let tempDir: string;
  let relay: string;
  const testPort = 18800 + Math.floor(Math.random() * 100);

  before(async () => {
    server = new RelayServer({ port: testPort });
    await server.start();
    relay = `http://localhost:${testPort}`;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-test-'));
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('send and receive a single file', async () => {
    // Create test file
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const testFile = path.join(srcDir, 'hello.txt');
    fs.writeFileSync(testFile, 'hello wormhole!');

    // Send
    const result = await send(testFile, { relay });
    assert.strictEqual(result.type, 'file');
    assert.ok(result.code);
    assert.ok(result.size > 0);

    // Receive
    const destDir = path.join(tempDir, 'dest1');
    fs.mkdirSync(destDir, { recursive: true });
    const received = await receive(result.code, destDir, { relay });
    assert.strictEqual(received.type, 'file');
    assert.deepStrictEqual(received.files, ['hello.txt']);

    // Verify content
    const content = fs.readFileSync(path.join(destDir, 'hello.txt'), 'utf-8');
    assert.strictEqual(content, 'hello wormhole!');
  });

  it('send and receive binary file', async () => {
    const srcDir = path.join(tempDir, 'src-bin');
    fs.mkdirSync(srcDir, { recursive: true });
    const testFile = path.join(srcDir, 'data.bin');
    const binData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    fs.writeFileSync(testFile, binData);

    const result = await send(testFile, { relay });
    const destDir = path.join(tempDir, 'dest-bin');
    fs.mkdirSync(destDir, { recursive: true });
    const received = await receive(result.code, destDir, { relay });

    assert.strictEqual(received.type, 'file');
    const content = fs.readFileSync(path.join(destDir, 'data.bin'));
    assert.deepStrictEqual(content, binData);
  });

  it('receive with wrong code fails', async () => {
    await assert.rejects(
      () => receive('1-wrong-code', tempDir, { relay }),
      /not found|already retrieved/
    );
  });

  it('transfer is one-time (second receive fails)', async () => {
    const testFile = path.join(tempDir, 'onetime.txt');
    fs.writeFileSync(testFile, 'once');

    const result = await send(testFile, { relay });

    const dest1 = path.join(tempDir, 'once1');
    fs.mkdirSync(dest1, { recursive: true });
    await receive(result.code, dest1, { relay });

    const dest2 = path.join(tempDir, 'once2');
    fs.mkdirSync(dest2, { recursive: true });
    await assert.rejects(
      () => receive(result.code, dest2, { relay }),
      /not found|already retrieved/
    );
  });

  it('receive with invalid code format throws', async () => {
    await assert.rejects(
      () => receive('invalid', tempDir, { relay }),
      /Invalid wormhole code/
    );
  });

  it('send with custom code', async () => {
    const testFile = path.join(tempDir, 'custom.txt');
    fs.writeFileSync(testFile, 'custom code test');

    const result = await send(testFile, { relay, code: '42-alpha-bravo' });
    assert.strictEqual(result.code, '42-alpha-bravo');

    const dest = path.join(tempDir, 'dest-custom');
    fs.mkdirSync(dest, { recursive: true });
    const received = await receive('42-alpha-bravo', dest, { relay });
    assert.strictEqual(received.type, 'file');
  });
});
