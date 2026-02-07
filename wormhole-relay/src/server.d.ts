/**
 * Wormhole relay HTTP server.
 *
 * PUT  /transfer/:id  — store encrypted blob
 * GET  /transfer/:id  — retrieve and delete blob (one-time pickup)
 * DELETE /transfer/:id — explicitly delete a transfer
 * GET  /health        — server status
 */
import { type StoreOptions } from './store.js';
export interface RelayServerOptions extends StoreOptions {
    port?: number;
    host?: string;
}
export declare class RelayServer {
    private server;
    private store;
    readonly port: number;
    readonly host: string;
    constructor(opts?: RelayServerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    get transferCount(): number;
    private handleRequest;
    private handlePut;
    private handleGet;
    private handleDelete;
}
