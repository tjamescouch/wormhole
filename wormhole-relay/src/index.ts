#!/usr/bin/env node

import { RelayServer } from './server.js';

const port = parseInt(process.env.PORT ?? '8787', 10);

const server = new RelayServer({ port });

await server.start();
console.log(`wormhole relay listening on :${port}`);

process.on('SIGINT', async () => {
  console.log('\nshutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

export { RelayServer } from './server.js';
export { TransferStore } from './store.js';
