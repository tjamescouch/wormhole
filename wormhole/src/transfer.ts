/**
 * HTTP client for the wormhole relay server.
 */

const DEFAULT_RELAY = 'http://localhost:8787';

export interface TransferOptions {
  relay?: string;
}

export async function upload(relayKey: string, data: Buffer, opts: TransferOptions = {}): Promise<void> {
  const relay = opts.relay ?? process.env.WORMHOLE_RELAY ?? DEFAULT_RELAY;
  const url = `${relay}/transfer/${relayKey}`;

  const res = await fetch(url, {
    method: 'PUT',
    body: data as unknown as BodyInit,
    headers: { 'Content-Type': 'application/octet-stream' },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Upload failed: ${(body as { error?: string }).error ?? res.statusText}`);
  }
}

export async function download(relayKey: string, opts: TransferOptions = {}): Promise<Buffer> {
  const relay = opts.relay ?? process.env.WORMHOLE_RELAY ?? DEFAULT_RELAY;
  const url = `${relay}/transfer/${relayKey}`;

  const res = await fetch(url, { method: 'GET' });

  if (res.status === 404) {
    throw new Error('Transfer not found or already retrieved');
  }
  if (!res.ok) {
    throw new Error(`Download failed: ${res.statusText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
