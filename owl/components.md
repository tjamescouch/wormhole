# components

## wormhole client

TypeScript CLI for sending and receiving encrypted files through a relay.

### state

- transfer code (memorable format: `42-banana-thunder`)
- derived encryption key (PBKDF2 from code + encryption salt)
- derived relay key (PBKDF2 from code + relay salt)

### capabilities

- generate memorable transfer codes
- encrypt files with AES-256-GCM using code-derived keys
- upload encrypted blobs to relay
- download and decrypt blobs from relay
- pack directories into slurp archives for multi-file transfer
- CLI interface: `send <file>`, `receive <code>`, `relay` subcommands

### interfaces

exposes:
- CLI entry point with send/receive/relay commands
- programmatic API via `index.ts` exports

depends on:
- wormhole-relay for blob storage and retrieval
- Node.js crypto stdlib (no external deps)

### invariants

- encryption and decryption happen client-side only — relay never sees plaintext
- relay key and encryption key are derived from the same code with different salts
- one code = one transfer = one retrieval

---

## wormhole relay

minimal HTTP server for ephemeral encrypted blob storage.

### state

- in-memory key-value store: relay key → encrypted blob
- TTL per entry (10 minutes default)
- size limit per blob (1MB default)

### capabilities

- accept PUT with encrypted blob, keyed by relay key
- serve GET to retrieve blob (one-time: deletes after first retrieval)
- auto-expire entries after TTL
- health check endpoint

### interfaces

exposes:
- HTTP API: `PUT /:key`, `GET /:key`, `GET /health`

depends on:
- nothing external — Node.js stdlib only

### invariants

- blobs are deleted after first GET (one-time retrieval)
- entries expire after TTL even if never retrieved
- relay has no knowledge of encryption — stores opaque bytes
- 1MB max blob size enforced on upload

---

## wormhole pipeline

shell-based continuous sync from agent containers to GitHub.

### capabilities

- detect local commits in agent containers via `podman exec`
- copy changed repos from container to host via tarball
- sanitize secrets and caches before push (strips API keys, `.env` files, `node_modules`)
- push non-main branches to GitHub
- auto-prune branches that are already merged into origin/main
- notify AgentChat on push events via `push-notify.cjs`

### interfaces

exposes:
- `pipeline.sh` — main sync loop
- `run-pipeline.sh` — convenience wrapper
- `push-notify.cjs` — AgentChat webhook notification

depends on:
- `podman` for container filesystem access
- `git` and SSH credentials on the host (agents never hold GitHub creds)
- AgentChat server for push notifications

### invariants

- agents never hold GitHub credentials — SSH keys stay on host
- only non-main branches are pushed — main is protected
- merged branches are skipped, not force-pushed
- pipeline does not resolve merge conflicts — agents must work on clean branches
