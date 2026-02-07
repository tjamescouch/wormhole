/**
 * E2E encryption for wormhole transfers.
 *
 * Key derivation: PBKDF2 from the memorable code.
 * Encryption: AES-256-GCM with random IV.
 *
 * Two keys are derived from the same code using different salts:
 * - encryption key: used to encrypt/decrypt the payload
 * - relay key: used as the storage ID on the relay server
 *
 * The relay never sees the encryption key.
 */

import crypto from 'node:crypto';

const ENCRYPTION_SALT = 'wormhole-encryption-v1';
const RELAY_SALT = 'wormhole-relay-key-v1';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

export function deriveEncryptionKey(code: string): Buffer {
  return crypto.pbkdf2Sync(code, ENCRYPTION_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function deriveRelayKey(code: string): string {
  const key = crypto.pbkdf2Sync(code, RELAY_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  return key.toString('hex');
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv (12) || ciphertext || authTag (16)
  return Buffer.concat([iv, encrypted, authTag]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted blob: too short');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
