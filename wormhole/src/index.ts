/**
 * Wormhole — easy encrypted file transfer.
 *
 * Public API for programmatic use.
 */

import fs from 'node:fs';
import path from 'node:path';
import { deriveEncryptionKey, deriveRelayKey, encrypt, decrypt } from './crypto.js';
import { generateCode, parseCode, isValidCode } from './codes.js';
import { upload, download, type TransferOptions } from './transfer.js';
import { packDirectory, isSlurpArchive, extractArchive } from './slurp.js';

export interface SendOptions extends TransferOptions {
  code?: string; // user-provided code (otherwise auto-generated)
}

export interface SendResult {
  code: string;
  relayKey: string;
  size: number;
  type: 'file' | 'directory';
}

export interface ReceiveResult {
  files: string[];
  type: 'file' | 'directory';
  totalSize: number;
}

/**
 * Send a file or directory through the wormhole.
 */
export async function send(inputPath: string, opts: SendOptions = {}): Promise<SendResult> {
  const stat = fs.statSync(inputPath);
  const code = opts.code ?? generateCode();
  const encKey = deriveEncryptionKey(code);
  const relayKey = deriveRelayKey(code);

  let payload: Buffer;
  let type: 'file' | 'directory';

  if (stat.isDirectory()) {
    payload = await packDirectory(inputPath);
    type = 'directory';
  } else {
    // Single file: metadata header + content
    const content = fs.readFileSync(inputPath);
    const name = path.basename(inputPath);
    const header = JSON.stringify({ type: 'file', name, size: content.length }) + '\n';
    payload = Buffer.concat([Buffer.from(header, 'utf-8'), content]);
    type = 'file';
  }

  const encrypted = encrypt(payload, encKey);
  await upload(relayKey, encrypted, opts);

  return { code, relayKey, size: payload.length, type };
}

/**
 * Receive a file or directory from the wormhole.
 */
export async function receive(code: string, outputDir: string = '.', opts: TransferOptions = {}): Promise<ReceiveResult> {
  if (!isValidCode(code)) {
    throw new Error(`Invalid wormhole code: ${code}`);
  }

  const encKey = deriveEncryptionKey(code);
  const relayKey = deriveRelayKey(code);

  const encrypted = await download(relayKey, opts);
  const payload = decrypt(encrypted, encKey);

  // Detect type
  if (isSlurpArchive(payload)) {
    const files = await extractArchive(payload, outputDir);
    return { files, type: 'directory', totalSize: payload.length };
  }

  // Single file: parse metadata header
  const newlineIdx = payload.indexOf(0x0a); // \n
  if (newlineIdx === -1) {
    throw new Error('Invalid payload: no metadata header');
  }

  const headerStr = payload.subarray(0, newlineIdx).toString('utf-8');
  const header = JSON.parse(headerStr) as { type: string; name: string; size: number };
  const content = payload.subarray(newlineIdx + 1);

  const outputPath = path.join(outputDir, header.name);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);

  return { files: [header.name], type: 'file', totalSize: content.length };
}

export { generateCode, parseCode, isValidCode } from './codes.js';
export { deriveEncryptionKey, deriveRelayKey, encrypt, decrypt } from './crypto.js';
export { upload, download } from './transfer.js';
export { packDirectory, isSlurpArchive, extractArchive } from './slurp.js';
