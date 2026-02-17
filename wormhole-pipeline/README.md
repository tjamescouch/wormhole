# wormhole-pipeline

Continuous sync daemon: copies repos from running agent containers to the Mac filesystem, then pushes to GitHub. An extension of [wormhole](../wormhole/) for container-based workflows.

## How it works

```
container (ephemeral /home/agent/repo)
    │  podman exec tar pipe
    ▼
~/dev/claude/wormhole/<agent>/<repo>/    (Mac filesystem, persisted)
    │  git push (SSH)
    ▼
GitHub (feature branches → PRs)
```

The pipeline detects git HEAD changes inside containers every 5 seconds (one `podman exec` per container), copies only changed repos, sanitizes (strips hooks/symlinks), and pushes to GitHub.

## Quick Start

```bash
# Start the pipeline daemon
./run-pipeline.sh

# Dry run to see what would happen
./run-pipeline.sh --dry-run --verbose

# One-shot cycle and exit
./run-pipeline.sh --once
```

## Requirements

- Lima VM named `thesystem` with Podman containers running
- Homebrew bash 5 (`/opt/homebrew/bin/bash`)
- `limactl`, `gh`, `git` in PATH
- SSH key at `~/.lima/_config/user` (Lima default)
- GitHub SSH access configured on the Mac

## Configuration

| Script | Flag | Default | Description |
|--------|------|---------|-------------|
| pipeline.sh | `--wormhole` | `~/dev/claude/wormhole` | Output directory |
| pipeline.sh | `--interval` | `5` | Poll interval (seconds) |
| pipeline.sh | `--source` | `/home/agent` | Path inside containers |
| pipeline.sh | `--merge-every` | `120` | Auto-merge PRs every N cycles |
| pipeline.sh | `--dry-run` | — | Show what would happen |
| pipeline.sh | `--once` | — | Single cycle and exit |
| run-pipeline.sh | `LIMA_VM` | `thesystem` | Lima VM name |
| run-pipeline.sh | `LOCAL_PODMAN_SOCK` | `/tmp/lima-podman.sock` | Forwarded socket path |

## Security

- Sanitization strips git hooks, symlinks, and executable bits from copied repos
- Auth circuit breaker: 3 consecutive auth failures → 30min backoff
- Containers never get direct GitHub access — push happens from the Mac
