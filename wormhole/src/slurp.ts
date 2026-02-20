/**
 * Slurp integration for directory transfers.
 *
 * Uses slurp's pack/compress for sending directories,
 * and slurp's parseContent for receiving (supports v1 and v4 formats).
 */

import fs from 'node:fs';
import path from 'node:path';

// @ts-ignore - vendored slurp (pure JS, no external deps)
import { collectFiles, pack, compress, decompress, isCompressed, parseContent } from './slurp-vendor.js';

export async function packDirectory(dirPath: string): Promise<Buffer> {
  const absDir = path.resolve(dirPath);
  const files = collectFiles(absDir, absDir);
  const name = path.basename(absDir);
  const v1 = pack(files, { name });
  const v2 = compress(v1, { name });
  return Buffer.from(v2, 'utf-8');
}

/**
 * Pack multiple directories into a single archive.
 * Each directory's files are prefixed with the directory's basename
 * to avoid path collisions across sources.
 */
export async function packDirectories(dirPaths: string[]): Promise<Buffer> {
  const allFiles: Array<{ fullPath: string; relPath: string }> = [];

  for (const dirPath of dirPaths) {
    const absDir = path.resolve(dirPath);
    const baseDir = path.dirname(absDir);
    const files = collectFiles(absDir, baseDir);
    allFiles.push(...files);
  }

  const name = dirPaths.map(d => path.basename(path.resolve(d))).join('+');
  const v1 = pack(allFiles, { name });
  const v2 = compress(v1, { name });
  return Buffer.from(v2, 'utf-8');
}

export function isSlurpArchive(data: Buffer): boolean {
  const header = data.subarray(0, 200).toString('utf-8');
  // Detect v1 (#!/bin/sh + SLURP), v2 (compressed), or v4 (# --- SLURP v4 ---)
  return (header.includes('#!/bin/sh') && header.includes('SLURP'))
      || header.includes('# --- SLURP v')
      || header.includes('SLURP v2 (compressed)');
}

/**
 * Parse and extract a slurp archive from a buffer to a target directory.
 * Supports v1, v2 (compressed), and v4 archive formats.
 */
export async function extractArchive(data: Buffer, targetDir: string): Promise<string[]> {
  let content = data.toString('utf-8');

  // Decompress if v2
  if (isCompressed(content)) {
    content = decompress(content);
  }

  // Use slurp's parseContent which handles both v1 and v4 formats
  const { files } = parseContent(content);
  const written: string[] = [];

  for (const file of files) {
    const fullPath = path.join(targetDir, file.path);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    if (file.binary) {
      // v4 parseContent returns Buffer for binary, v1 returns Buffer too
      fs.writeFileSync(fullPath, file.content);
    } else {
      const text = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');
      fs.writeFileSync(fullPath, text);
    }
    written.push(file.path);
  }

  return written;
}
