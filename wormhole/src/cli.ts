#!/usr/bin/env node

/**
 * Wormhole CLI — easy encrypted file transfer.
 *
 * Usage:
 *   wormhole send <file-or-dir>    Send a file or directory
 *   wormhole receive <code>        Receive a transfer
 *   wormhole relay                 Start the relay server
 */

import { send, receive } from './index.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--relay' || args[i] === '-r') {
      flags.relay = args[++i] ?? '';
    } else if (args[i] === '--output' || args[i] === '-o') {
      flags.output = args[++i] ?? '';
    } else if (args[i] === '--code' || args[i] === '-c') {
      flags.code = args[++i] ?? '';
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
    i++;
  }
  return { positional, flags };
}

function usage(): void {
  console.log(`wormhole — easy encrypted file transfer

Commands:
  wormhole send <file-or-dir>    Pack, encrypt, and upload
  wormhole receive <code>        Download, decrypt, and extract
  wormhole relay                 Start the relay server

Options:
  --relay, -r <url>    Relay URL (default: localhost:8787, or WORMHOLE_RELAY env)
  --output, -o <path>  Output directory for receive (default: .)
  --code, -c <code>    Custom transfer code for send
`);
}

async function main(): Promise<void> {
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  const { positional, flags } = parseFlags(args.slice(1));

  if (command === 'send') {
    const inputPath = positional[0];
    if (!inputPath) {
      console.error('Error: no file or directory specified');
      process.exit(1);
    }

    const result = await send(inputPath, {
      relay: flags.relay,
      code: flags.code,
    });

    console.log(`Sent ${result.type}: ${result.size} bytes`);
    console.log(`\nTo receive, run:\n  wormhole receive ${result.code}${flags.relay ? ` --relay ${flags.relay}` : ''}`);

  } else if (command === 'receive') {
    const code = positional[0];
    if (!code) {
      console.error('Error: no transfer code specified');
      process.exit(1);
    }

    const outputDir = flags.output || '.';
    const result = await receive(code, outputDir, { relay: flags.relay });

    console.log(`Received ${result.type}: ${result.files.length} file(s)`);
    for (const f of result.files) {
      console.log(`  ${f}`);
    }

  } else if (command === 'relay') {
    // Dynamic import to avoid bundling relay server with client
    // @ts-ignore - cross-package import resolved at runtime
    const mod = await import('../../wormhole-relay/dist/server.js');
    const port = parseInt(flags.relay ?? process.env.PORT ?? '8787', 10);
    const relayServer = new mod.RelayServer({ port });
    await relayServer.start();
    console.log(`wormhole relay listening on :${port}`);

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
