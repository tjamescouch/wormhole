/**
 * Wormhole relay HTTP server.
 *
 * PUT  /transfer/:id  — store encrypted blob
 * GET  /transfer/:id  — retrieve and delete blob (one-time pickup)
 * DELETE /transfer/:id — explicitly delete a transfer
 * GET  /health        — server status
 */
import http from 'node:http';
import { TransferStore } from './store.js';
export class RelayServer {
    server;
    store;
    port;
    host;
    constructor(opts = {}) {
        this.port = opts.port ?? 8787;
        this.host = opts.host ?? '0.0.0.0';
        this.store = new TransferStore(opts);
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
    }
    start() {
        return new Promise((resolve) => {
            this.server.listen(this.port, this.host, () => resolve());
        });
    }
    stop() {
        this.store.destroy();
        return new Promise((resolve, reject) => {
            this.server.close((err) => err ? reject(err) : resolve());
        });
    }
    get transferCount() {
        return this.store.count;
    }
    handleRequest(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const path = url.pathname;
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // Health endpoint
        if (path === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                transfers: this.store.count,
                uptime: process.uptime(),
            }));
            return;
        }
        // Transfer endpoints
        const match = path.match(/^\/transfer\/([a-f0-9]+)$/);
        if (!match) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }
        const id = match[1];
        if (req.method === 'PUT') {
            this.handlePut(req, res, id);
        }
        else if (req.method === 'GET') {
            this.handleGet(res, id);
        }
        else if (req.method === 'DELETE') {
            this.handleDelete(res, id);
        }
        else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
    }
    handlePut(req, res, id) {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > this.store.maxSize) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Payload too large (max ${this.store.maxSize} bytes)` }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (res.writableEnded)
                return;
            const data = Buffer.concat(chunks);
            const result = this.store.put(id, data);
            if (result.ok) {
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, size: data.length }));
            }
            else {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: result.error }));
            }
        });
        req.on('error', () => {
            if (!res.writableEnded) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Upload failed' }));
            }
        });
    }
    handleGet(res, id) {
        const entry = this.store.get(id);
        if (!entry) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Transfer not found or already retrieved' }));
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': entry.data.length.toString(),
        });
        res.end(entry.data);
    }
    handleDelete(res, id) {
        const deleted = this.store.delete(id);
        if (deleted) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Transfer not found' }));
        }
    }
}
//# sourceMappingURL=server.js.map