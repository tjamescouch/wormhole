/**
 * Slurp integration for directory transfers.
 *
 * Uses slurp's pack/compress for sending directories,
 * and parseArchive-equivalent logic for receiving.
 */

import fs from 'node:fs';
import path from 'node:path';

// Import slurp from sibling directory
// @ts-ignore - ESM cross-package import
import { collectFiles, pack, compress, decompress, isCompressed } from '../../slurp/slurp.js';

export async function packDirectory(dirPath: string): Promise<Buffer> {
  const files = await collectFiles(dirPath);
  const name = path.basename(dirPath);
  const v1 = pack(files, { name });
  const v2 = compress(v1, { name });
  return Buffer.from(v2, 'utf-8');
}

export function isSlurpArchive(data: Buffer): boolean {
  const header = data.subarray(0, 200).toString('utf-8');
  return header.includes('#!/bin/sh') && header.includes('SLURP');
}

/**
 * Parse and extract a slurp archive from a buffer to a target directory.
 */
export async function extractArchive(data: Buffer, targetDir: string): Promise<string[]> {
  let content = data.toString('utf-8');

  // Decompress if v2
  if (isCompressed(content)) {
    content = decompress(content);
  }

  // Parse the v1 archive
  const files = parseV1Content(content);
  const written: string[] = [];

  for (const file of files) {
    const fullPath = path.join(targetDir, file.path);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    if (file.binary) {
      fs.writeFileSync(fullPath, Buffer.from(file.content, 'base64'));
    } else {
      fs.writeFileSync(fullPath, file.content);
    }
    written.push(file.path);
  }

  return written;
}

interface ParsedFile {
  path: string;
  content: string;
  binary: boolean;
}

/**
 * Minimal v1 archive parser (in-memory, no temp files).
 */
function parseV1Content(archive: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = archive.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Match: cat > 'path' << 'MARKER'
    const catMatch = line.match(/^cat\s+>\s+'([^']+)'\s+<<\s+'([^']+)'$/);
    if (catMatch) {
      const [, filePath, marker] = catMatch;
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && lines[i] !== marker) {
        contentLines.push(lines[i]);
        i++;
      }
      files.push({ path: filePath, content: contentLines.join('\n'), binary: false });
      i++; // skip marker
      continue;
    }

    // Match: base64 -d > 'path' << 'MARKER'
    const b64Match = line.match(/^base64\s+-d\s+>\s+'([^']+)'\s+<<\s+'([^']+)'$/);
    if (b64Match) {
      const [, filePath, marker] = b64Match;
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && lines[i] !== marker) {
        contentLines.push(lines[i]);
        i++;
      }
      files.push({ path: filePath, content: contentLines.join('\n'), binary: true });
      i++; // skip marker
      continue;
    }

    i++;
  }

  return files;
}
