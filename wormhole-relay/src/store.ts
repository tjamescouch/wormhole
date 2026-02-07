/**
 * In-memory transfer store with TTL auto-cleanup.
 */

export interface TransferEntry {
  data: Buffer;
  createdAt: number;
  metadata?: string; // optional sender-provided metadata
}

export interface StoreOptions {
  maxSize?: number;    // max bytes per transfer (default 1MB)
  ttlMs?: number;      // time-to-live in ms (default 10 min)
  cleanupIntervalMs?: number; // cleanup check interval (default 60s)
}

export class TransferStore {
  private entries = new Map<string, TransferEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  readonly maxSize: number;
  readonly ttlMs: number;

  constructor(opts: StoreOptions = {}) {
    this.maxSize = opts.maxSize ?? 1_048_576; // 1MB
    this.ttlMs = opts.ttlMs ?? 600_000;       // 10 minutes
    const interval = opts.cleanupIntervalMs ?? 60_000;
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    this.cleanupTimer.unref();
  }

  put(id: string, data: Buffer, metadata?: string): { ok: true } | { ok: false; error: string } {
    if (data.length > this.maxSize) {
      return { ok: false, error: `Payload too large: ${data.length} bytes (max ${this.maxSize})` };
    }
    if (this.entries.has(id)) {
      return { ok: false, error: 'Transfer ID already exists' };
    }
    this.entries.set(id, { data, createdAt: Date.now(), metadata });
    return { ok: true };
  }

  get(id: string): TransferEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    // One-time retrieval: delete after pickup
    this.entries.delete(id);
    return entry;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get count(): number {
    return this.entries.size;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}
