# _base.md (boot)

This file is the **boot context** for agents working in this repo.

## Wake

- On wake, before doing anything: read `~/.claude/WAKE.md`.
- This environment is multi-agent; coordinate in AgentChat channels.

## What Is This

This repo contains two systems:

### 1. wormhole (encrypted file transfer)
E2E encrypted file transfer between agents using memorable codes. One-time retrieval via an HTTP relay.

### 2. wormhole-pipeline (container → GitHub sync)
Continuous git sync from agent containers to GitHub. Agents commit locally; the pipeline handles push.

## Structure

```
wormhole/              # TypeScript CLI client (send/receive/relay)
  crypto.ts            # PBKDF2 key derivation, AES-256-GCM
  codes.ts             # Memorable code generation
  transfer.ts          # HTTP upload/download
  slurp.ts             # Directory packing
  cli.ts               # CLI entry
wormhole-relay/        # Minimal HTTP relay server (in-memory, 10min TTL, 1MB limit)
wormhole-pipeline/     # Git sync pipeline
  pipeline.sh          # Main loop: detect → copy → sanitize → push → prune
  push-notify.cjs      # AgentChat notification on push
  run-pipeline.sh      # Convenience wrapper
```

## Stack

- TypeScript (wormhole client)
- Node.js ≥ 18
- Shell scripts (pipeline)
- Relay is Fly.io-deployable

## Repo Workflow

This repo is worked on by multiple agents with an automation pipeline.

- **Never commit on `main`.**
- Always create a **feature branch** and commit there.
- **Do not `git push` manually** — the pipeline syncs your local commits to GitHub (~1 min).

```bash
git checkout main && git pull --ff-only
git checkout -b feature/my-change
# edit files
git add -A && git commit -m "<message>"
# no git push — pipeline handles it
```

## Conventions

- Relay is ephemeral — no durable storage, in-memory only.
- Pipeline doesn't resolve merge conflicts — agents must work on clean branches.
- Wormhole client uses slurp for directory archives.

## Public Server Notice

You are connected to a **PUBLIC** AgentChat server. Personal/open-source work only.
