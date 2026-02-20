#!/usr/bin/env node

/**
 * Wormhole CLI — easy encrypted file transfer + git branch cleanup.
 *
 * Usage:
 *   wormhole send <file-or-dir>    Send a file or directory
 *   wormhole receive <code>        Receive a transfer
 *   wormhole relay                 Start the relay server
 *   wormhole prune                 Delete merged feature branches from remote
 */

import { send, receive } from './index.js';
import { pruneRemoteBranches } from './prune.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--relay' || args[i] === '-r') {
      flags.relay = args[++i] ?? '';
    } else if (args[i] === '--output' || args[i] === '-o') {
      flags.output = args[++i] ?? '';
    } else if (args[i] === '--code' || args[i] === '-c') {
      flags.code = args[++i] ?? '';
    } else if (args[i] === '--dry-run' || args[i] === '-n') {
      flags.dryRun = true;
    } else if (args[i] === '--base' || args[i] === '-b') {
      flags.base = args[++i] ?? 'main';
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
    i++;
  }
  return { positional, flags };
}

function usage(): void {
  console.log(`wormhole — easy encrypted file transfer + git branch cleanup

Commands:
  wormhole send <path> [path2 ...]   Pack, encrypt, and upload (one or more files/dirs)
  wormhole receive <code>            Download, decrypt, and extract
  wormhole relay                     Start the relay server
  wormhole prune                     Delete merged feature branches from remote

Options:
  --relay, -r <url>      Relay URL (default: localhost:8787, or WORMHOLE_RELAY env)
  --output, -o <path>    Output directory for receive (default: .)
  --code, -c <code>      Custom transfer code for send
  --dry-run, -n          (prune only) Show what would be deleted without deleting
  --base, -b <branch>    (prune only) Base branch to check merges against (default: main)
`);
}

async function main(): Promise<void> {
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  const { positional, flags } = parseFlags(args.slice(1));

  if (command === 'send') {
    if (positional.length === 0) {
      console.error('Error: no file or directory specified');
      process.exit(1);
    }

    const inputPath = positional.length === 1 ? positional[0] : positional;

    const result = await send(inputPath, {
      relay: flags.relay as string | undefined,
      code: flags.code as string | undefined,
    });

    const sources = Array.isArray(inputPath) ? inputPath.join(', ') : inputPath;
    console.log(`Sent ${result.type} [${sources}]: ${result.size} bytes`);
    console.log(`\nTo receive, run:\n  wormhole receive ${result.code}${flags.relay ? ` --relay ${flags.relay}` : ''}`);

  } else if (command === 'receive') {
    const code = positional[0];
    if (!code) {
      console.error('Error: no transfer code specified');
      process.exit(1);
    }

    const outputDir = (flags.output as string) || '.';
    const result = await receive(code, outputDir, { relay: flags.relay as string | undefined });

    console.log(`Received ${result.type}: ${result.files.length} file(s)`);
    for (const f of result.files) {
      console.log(`  ${f}`);
    }

  } else if (command === 'relay') {
    // Dynamic import to avoid bundling relay server with client
    // @ts-ignore - cross-package import resolved at runtime
    const mod = await import('../../wormhole-relay/dist/server.js');
    const port = parseInt((flags.relay as string) ?? process.env.PORT ?? '8787', 10);
    const relayServer = new mod.RelayServer({ port });
    await relayServer.start();
    console.log(`wormhole relay listening on :${port}`);

  } else if (command === 'prune') {
    const result = await pruneRemoteBranches({
      dryRun: flags.dryRun as boolean | undefined,
      baseBranch: (flags.base as string) || 'main',
    });

    console.log(`\nDeleted: ${result.deleted.length} branches`);
    for (const branch of result.deleted) {
      console.log(`  ✓ ${branch}`);
    }

    if (result.skipped.length > 0) {
      console.log(`\nSkipped (not merged): ${result.skipped.length} branches`);
    }

    if (result.errors.length > 0) {
      console.error(`\nErrors: ${result.errors.length}`);
      for (const err of result.errors) {
        console.error(`  ✗ ${err.branch}: ${err.error}`);
      }
      process.exit(1);
    }

  } else {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
