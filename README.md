# wormhole

Container → GitHub pipeline for multi-agent development environments.

`wormhole` continuously syncs git repositories from sandboxed agent containers to GitHub, enabling agents to commit and push without holding credentials or direct network access.

## How It Works

```
[Agent Container]  →  [Wormhole Dir]  →  [GitHub]
   ~/gro (git)         local copy         PR / branch
   ~/agentchat         sanitized
   ~/myrepo            stripped
```

1. **Detect** — polls container repos every N seconds for HEAD changes
2. **Copy** — tarballs changed repos from container to local wormhole directory
3. **Sanitize** — strips secrets, node_modules, caches
4. **Push** — pushes changed branches to GitHub via SSH
5. **Prune** — auto-skips branches already merged into `origin/main`

Agents commit locally. The pipeline handles the push. No credentials in containers.

## Usage

```sh
# Basic: sync one Lima VM
./wormhole-pipeline/pipeline.sh \
  --lima thesystem \
  --wormhole ~/dev/claude/wormhole \
  --interval 5 \
  --merge-every 12 \
  --verbose \
  --log /tmp/pipeline.log &

# Dry run (see what would be pushed)
./wormhole-pipeline/pipeline.sh --lima thesystem --dry-run --once
```

## Options

```
--wormhole <path>      Local output directory (default: ~/dev/claude/wormhole)
--interval <secs>      Poll interval in seconds (default: 5)
--source <path>        Path inside containers (default: /home/agent)
--merge-every <n>      GitHub push check every N cycles (default: 12 = 1 min)
--delete-old <days>    Delete remote branches older than N days (0=off)
--lima <vm>            Lima VM name to use podman via limactl
--once                 Run one cycle and exit
--dry-run              Show what would happen without doing it
--verbose              Detailed output
--log <file>           Write logs to file
```

## Repo Discovery

The pipeline scans two levels deep inside each container's `$SOURCE` directory:

- `$SOURCE/*/` — repos directly in home (e.g., `~/gro`, `~/agentchat`)
- `$SOURCE/*/*/` — repos in subdirectories (e.g., `~/repos/gro`)

Repos with a `.git` directory are included. Node modules and caches are excluded from the tarball.

## Merged Branch Pruning

Branches whose tip is already an ancestor of `origin/main` are automatically skipped and not pushed. This prevents repeated push failures from stale feature branches after PRs are merged.

## Notifications

Push events and errors are posted to AgentChat via `push-notify.cjs` when configured.

## Security

- Agents never hold GitHub credentials
- Pipeline runs on the host with SSH access
- Container filesystem access via `podman exec` (read-only tarball)
- Secrets pattern matching strips common credential files before push

## License

MIT
