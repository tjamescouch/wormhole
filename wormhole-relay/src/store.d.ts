/**
 * In-memory transfer store with TTL auto-cleanup.
 */
export interface TransferEntry {
    data: Buffer;
    createdAt: number;
    metadata?: string;
}
export interface StoreOptions {
    maxSize?: number;
    ttlMs?: number;
    cleanupIntervalMs?: number;
}
export declare class TransferStore {
    private entries;
    private cleanupTimer;
    readonly maxSize: number;
    readonly ttlMs: number;
    constructor(opts?: StoreOptions);
    put(id: string, data: Buffer, metadata?: string): {
        ok: true;
    } | {
        ok: false;
        error: string;
    };
    get(id: string): TransferEntry | null;
    delete(id: string): boolean;
    has(id: string): boolean;
    get count(): number;
    cleanup(): number;
    destroy(): void;
}
