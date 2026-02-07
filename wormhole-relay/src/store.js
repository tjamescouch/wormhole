/**
 * In-memory transfer store with TTL auto-cleanup.
 */
export class TransferStore {
    entries = new Map();
    cleanupTimer = null;
    maxSize;
    ttlMs;
    constructor(opts = {}) {
        this.maxSize = opts.maxSize ?? 1_048_576; // 1MB
        this.ttlMs = opts.ttlMs ?? 600_000; // 10 minutes
        const interval = opts.cleanupIntervalMs ?? 60_000;
        this.cleanupTimer = setInterval(() => this.cleanup(), interval);
        this.cleanupTimer.unref();
    }
    put(id, data, metadata) {
        if (data.length > this.maxSize) {
            return { ok: false, error: `Payload too large: ${data.length} bytes (max ${this.maxSize})` };
        }
        if (this.entries.has(id)) {
            return { ok: false, error: 'Transfer ID already exists' };
        }
        this.entries.set(id, { data, createdAt: Date.now(), metadata });
        return { ok: true };
    }
    get(id) {
        const entry = this.entries.get(id);
        if (!entry)
            return null;
        // One-time retrieval: delete after pickup
        this.entries.delete(id);
        return entry;
    }
    delete(id) {
        return this.entries.delete(id);
    }
    has(id) {
        return this.entries.has(id);
    }
    get count() {
        return this.entries.size;
    }
    cleanup() {
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
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.entries.clear();
    }
}
//# sourceMappingURL=store.js.map