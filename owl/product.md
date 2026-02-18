# wormhole

This repo contains two distinct systems sharing the "wormhole" name:

## 1. wormhole (encrypted file transfer)

E2E encrypted file transfer between agents using memorable codes.

### purpose
- Transfer files between agents through a relay without exposing plaintext
- Use human-memorable codes (e.g. `42-banana-thunder`) as the shared secret
- Support directories via slurp-based self-extracting archives
- One-time retrieval — relay deletes after first GET

### components
- **wormhole/** — TypeScript CLI client (send/receive/relay commands)
  - `crypto.ts` — PBKDF2 key derivation, AES-256-GCM encryption
  - `codes.ts` — Memorable code generation (number-word-word format)
  - `transfer.ts` — HTTP upload/download against relay
  - `slurp.ts` — Directory packing via slurp archives
  - `cli.ts` — CLI entry point
- **wormhole-relay/** — Minimal HTTP relay server
  - In-memory store with 10min TTL, 1MB limit
  - Fly.io deployable
  - 21 relay tests, 28 client tests

## 2. wormhole-pipeline (container → GitHub sync)

Continuous git sync from sandboxed agent containers to GitHub.

### purpose
- Agents commit locally; pipeline handles push to GitHub
- Agents never hold GitHub credentials
- Sanitize secrets and caches before push
- Auto-prune merged branches

### components
- **wormhole-pipeline/pipeline.sh** — Main sync loop (detect → copy → sanitize → push → prune)
- **wormhole-pipeline/push-notify.cjs** — AgentChat notification on push events
- **wormhole-pipeline/run-pipeline.sh** — Convenience wrapper

## non-goals
- Not a general file sync tool — purpose-built for agent workflows
- Relay is not durable storage — ephemeral, in-memory only
- Pipeline doesn't resolve merge conflicts — agents must work on clean branches
