#!/usr/bin/env bash
# pipeline — container → wormhole → GitHub in one loop
#
# Every 5s: check container HEADs, copy changed repos, sanitize, push.
# Every 10min: auto-merge clean feature/* PRs, delete stale branches.
#
# Usage: ./pipeline.sh [options]
#   --wormhole <path>      Output directory (default: ~/dev/claude/wormhole)
#   --interval <secs>      Poll interval in seconds (default: 5)
#   --source <path>        Path inside containers (default: /home/agent)
#   --merge-every <n>      Merge check every N cycles (default: 120)
#   --delete-old <days>    Delete remote branches older than N days (0=off)
#   --once                 Run one cycle and exit
#   --dry-run              Show what would happen
#   --verbose              Detailed output
#   --log <path>           Log file (daemon mode writes here)

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────

WORMHOLE="${HOME}/dev/claude/wormhole"
INTERVAL=5
SOURCE="/home/agent"
MERGE_EVERY=120
DELETE_OLD_DAYS=0
RUN_ONCE=false
DRY_RUN=false
VERBOSE=false
LOG_FILE=""
LIMA_INSTANCE=""  # When set, prefix podman calls with: limactl shell <instance> --

PROTECTED="main master"
MERGE_REPOS=(agentchat agentstream personas visage3d agenthnsw agentcoldstorage gro agentpatch agentdrive)
MAX_API_CALLS=30
FAIL_DIR="/tmp/pipeline-failed"
AUTH_FAIL_FILE="/tmp/pipeline-auth-fails"
MAX_AUTH_FAILS=3
AUTH_BACKOFF=1800
NOTIFY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/push-notify.cjs"

TAR_EXCLUDE=(--exclude=node_modules --exclude=.cache --exclude=.npm --exclude=.local --exclude=__pycache__)

# ── Args ─────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wormhole)     WORMHOLE="$2"; shift 2 ;;
        --interval)     INTERVAL="$2"; shift 2 ;;
        --source)       SOURCE="$2"; shift 2 ;;
        --merge-every)  MERGE_EVERY="$2"; shift 2 ;;
        --delete-old)   DELETE_OLD_DAYS="$2"; shift 2 ;;
        --once)         RUN_ONCE=true; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        --verbose)      VERBOSE=true; shift ;;
        --log)          LOG_FILE="$2"; shift 2 ;;
        --lima)         LIMA_INSTANCE="$2"; shift 2 ;;
        -h|--help)      sed -n '2,/^$/s/^# //p' "$0"; exit 0 ;;
        *)              echo "Unknown: $1" >&2; exit 1 ;;
    esac
done

# ── Logging ──────────────────────────────────────────────────────────────

_emit() { echo "[$(date -Iseconds)] [pipeline] $*"; }
log()  { _emit "$@" >&2; }
vlog() { [[ "$VERBOSE" == "true" ]] && log "$@" || true; }

# ── Podman wrapper (supports --lima for Lima VM containers) ──────────────

if [[ -n "$LIMA_INSTANCE" ]]; then
    PODMAN=(limactl shell "$LIMA_INSTANCE" -- podman)
    log "Using Lima instance: $LIMA_INSTANCE (podman via limactl)"
else
    PODMAN=(podman)
fi

# ── State ────────────────────────────────────────────────────────────────

declare -A HEADS
CYCLE=0
RUNNING=true
STATS_SYNCED=0
STATS_PUSHED=0
STATS_ERRORS=0

trap 'log "Shutting down"; RUNNING=false' SIGINT SIGTERM

# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════

is_protected() {
    for p in $PROTECTED; do [[ "$1" == "$p" ]] && return 0; done
    return 1
}

notify() {
    if [[ -f "$NOTIFY_SCRIPT" ]] && command -v node &>/dev/null; then
        node "$NOTIFY_SCRIPT" "$*" &>/dev/null &
    fi
}

notify_error() {
    local repo="$1" branch="$2" output="$3" head_hash="${4:-}" exit_code="${5:-}"
    local detail=""
    detail+="❌ PUSH FAILED ${repo}/${branch}"
    [[ -n "$head_hash" ]] && detail+=" @ ${head_hash:0:7}"
    [[ -n "$exit_code" ]] && detail+=" (exit ${exit_code})"
    detail+=$'\n'"--- git output ---"$'\n'"${output}"
    if is_auth_error "$output"; then
        detail+=$'\n'"⚠️ AUTH/CREDENTIAL ERROR — check SSH keys or GitHub token"
    fi
    notify "$detail"
}

# ── Auth circuit breaker ─────────────────────────────────────────────────

get_auth_fails()   { [[ -f "$AUTH_FAIL_FILE" ]] && cat "$AUTH_FAIL_FILE" || echo 0; }
record_auth_fail() { echo $(( $(get_auth_fails) + 1 )) > "$AUTH_FAIL_FILE"; }
clear_auth_fails() { rm -f "$AUTH_FAIL_FILE"; }

is_auth_error() {
    echo "$1" | grep -qiE 'permission denied|authentication|publickey|could not read from remote|403|401|rate limit|secondary rate'
}

check_breaker() {
    local n; n=$(get_auth_fails)
    if [[ "$n" -ge "$MAX_AUTH_FAILS" ]]; then
        log "CIRCUIT BREAKER: $n auth failures — cooling ${AUTH_BACKOFF}s"
        echo 0 > "$AUTH_FAIL_FILE"
        return 1
    fi
}

# ── Failed-push semaphores ───────────────────────────────────────────────

fail_key()        { echo "${1}__${2}" | tr '/' '_'; }
get_failed_hash() { local f="${FAIL_DIR}/$(fail_key "$1" "$2")"; [[ -f "$f" ]] && cat "$f" || echo ""; }
set_failed_hash() { mkdir -p "$FAIL_DIR"; echo "$3" > "${FAIL_DIR}/$(fail_key "$1" "$2")"; }
clear_failed()    { rm -f "${FAIL_DIR}/$(fail_key "$1" "$2")"; }

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 1 — DISCOVER
# ═══════════════════════════════════════════════════════════════════════════

discover() {
    "${PODMAN[@]}" ps --format '{{.ID}} {{.Names}}' 2>/dev/null | grep -E '(agent-|agentchat-)' || true
}

agent_name() {
    local n="$1"; n="${n#agent-}"; n="${n#agentchat-}"
    echo "$n" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g'
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 2 — DETECT (one podman exec per container)
# ═══════════════════════════════════════════════════════════════════════════

container_heads() {
    local cid="$1"
    "${PODMAN[@]}" exec "$cid" bash -c '
        for d in '"$SOURCE"'/*/; do
            [ -d "$d/.git" ] && echo "$(basename "$d") $(git -C "$d" rev-parse HEAD 2>/dev/null)"
        done
        [ -d '"$SOURCE"'/.git ] && echo ". $(git -C '"$SOURCE"' rev-parse HEAD 2>/dev/null)"
    ' 2>/dev/null || true
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 3 — COPY (E2E encrypted via wormhole: container → relay → host)
# ═══════════════════════════════════════════════════════════════════════════
#
# WORMHOLE_RELAY_CONTAINER — URL containers use to reach the relay
#                             (default: http://host.containers.internal:8787)
# WORMHOLE_RELAY_HOST      — URL the host uses to receive from the relay
#                             (default: http://localhost:8787)
#
# Falls back to tar pipe if wormhole CLI is not available in the container.

WORMHOLE_RELAY_CONTAINER="${WORMHOLE_RELAY_CONTAINER:-http://host.containers.internal:8787}"
WORMHOLE_RELAY_HOST="${WORMHOLE_RELAY_HOST:-http://localhost:8787}"

# Check once per run if wormhole is available in a container
_WORMHOLE_CHECKED=""
_WORMHOLE_AVAILABLE=false

wormhole_available() {
    local cid="$1"
    if [[ "$_WORMHOLE_CHECKED" != "$cid" ]]; then
        _WORMHOLE_CHECKED="$cid"
        if "${PODMAN[@]}" exec "$cid" which wormhole &>/dev/null; then
            _WORMHOLE_AVAILABLE=true
        else
            _WORMHOLE_AVAILABLE=false
        fi
    fi
    [[ "$_WORMHOLE_AVAILABLE" == "true" ]]
}

wormhole_send_receive() {
    local cid="$1" src_path="$2" dest="$3"
    mkdir -p "$dest"

    local send_output code
    send_output=$("${PODMAN[@]}" exec "$cid" wormhole send "$src_path" \
        --relay "$WORMHOLE_RELAY_CONTAINER" 2>&1) || return 1
    # Parse code from: "  wormhole receive <code> ..."
    code=$(echo "$send_output" | grep -oE 'wormhole receive [0-9]+-[a-z]+-[a-z]+' | awk '{print $3}' | head -1)
    [[ -z "$code" ]] && { vlog "WORMHOLE: could not parse code from send output"; return 1; }

    vlog "WORMHOLE: send → code=$code"
    wormhole receive "$code" --relay "$WORMHOLE_RELAY_HOST" --output "$dest" 2>&1 || return 1
    return 0
}

tar_copy_repo() {
    local cid="$1" repo="$2" dest="$3"
    mkdir -p "$dest"
    set +o pipefail
    if [[ "$repo" == "." ]]; then
        "${PODMAN[@]}" exec "$cid" tar cf - "${TAR_EXCLUDE[@]}" -C "$SOURCE" . \
            2>/dev/null | tar xf - -C "$dest" 2>/dev/null
    else
        "${PODMAN[@]}" exec "$cid" tar cf - "${TAR_EXCLUDE[@]}" -C "$SOURCE" "$repo" \
            2>/dev/null | tar xf - -C "$dest" 2>/dev/null
    fi
    set -o pipefail
}

copy_repo() {
    local cid="$1" repo="$2" dest="$3"
    local src_path
    if [[ "$repo" == "." ]]; then
        src_path="$SOURCE"
    else
        src_path="${SOURCE}/${repo}"
    fi

    if wormhole_available "$cid"; then
        vlog "COPY (wormhole E2E): ${repo}"
        wormhole_send_receive "$cid" "$src_path" "$dest" && return 0
        vlog "WORMHOLE failed, falling back to tar pipe"
    fi
    tar_copy_repo "$cid" "$repo" "$dest"
}

copy_full() {
    local cid="$1" dest="$2"
    local tmp="${dest}.tmp.$$"
    rm -rf "$tmp"; mkdir -p "$tmp"

    if wormhole_available "$cid"; then
        vlog "COPY FULL (wormhole E2E)"
        if wormhole_send_receive "$cid" "$SOURCE" "$tmp"; then
            if [[ -d "$tmp" ]] && [[ -n "$(ls -A "$tmp" 2>/dev/null)" ]]; then
                mkdir -p "$dest"
                cp -a "$tmp/." "$dest/" 2>/dev/null || true
                rm -rf "$tmp"
                return 0
            fi
        fi
        vlog "WORMHOLE failed, falling back to tar pipe"
        rm -rf "$tmp"; mkdir -p "$tmp"
    fi

    # Fallback: tar pipe
    set +o pipefail
    "${PODMAN[@]}" exec "$cid" tar cf - "${TAR_EXCLUDE[@]}" \
        -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")" 2>/dev/null \
        | tar xf - -C "$tmp" --strip-components=1 2>/dev/null
    set -o pipefail
    if [[ -d "$tmp" ]] && [[ -n "$(ls -A "$tmp" 2>/dev/null)" ]]; then
        mkdir -p "$dest"
        cp -a "$tmp/." "$dest/" 2>/dev/null || true
        rm -rf "$tmp"
        return 0
    fi
    rm -rf "$tmp"
    return 1
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 4 — SANITIZE (strip hooks, symlinks, exec bits)
# ═══════════════════════════════════════════════════════════════════════════

sanitize() {
    local d="$1"
    find "$d" -path '*/.git/hooks/*' -type f -delete 2>/dev/null || true
    find "$d" -path '*/.git/hooks' -type d -exec rmdir {} + 2>/dev/null || true
    find "$d" -type l -delete 2>/dev/null || true
    find "$d" -type f -perm +111 -exec chmod -x {} + 2>/dev/null || true
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 5 — PUSH (wormhole → GitHub)
# ═══════════════════════════════════════════════════════════════════════════

git_push() {
    GIT_TERMINAL_PROMPT=0 timeout 30 \
        git -c core.hooksPath=/dev/null \
            -c 'url.git@github.com:.insteadOf=https://github.com/' \
            -C "$1" push origin "$2" 2>&1
}

push_repo() {
    local repo_dir="$1"
    local repo_name; repo_name=$(basename "$repo_dir")

    [[ ! -d "${repo_dir}/.git" ]] && return 0
    git -C "$repo_dir" remote get-url origin &>/dev/null || return 0

    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue
        is_protected "$branch" && continue

        local head; head=$(git -C "$repo_dir" rev-parse "$branch" 2>/dev/null) || continue

        # Skip if same commit already failed
        local prev; prev=$(get_failed_hash "$repo_name" "$branch")
        [[ -n "$prev" && "$prev" == "$head" ]] && { vlog "SKIP ${repo_name}/${branch} — same commit failed"; continue; }

        [[ "$DRY_RUN" == "true" ]] && { log "[dry-run] push ${repo_name}/${branch}"; continue; }

        local out rc=0
        out=$(git_push "$repo_dir" "$branch") || rc=$?

        if [[ $rc -eq 0 ]]; then
            if echo "$out" | grep -q "Everything up-to-date"; then
                vlog "UP-TO-DATE ${repo_name}/${branch}"
            else
                log "PUSHED ${repo_name}/${branch}"
                notify "🚀 ${repo_name}/${branch}"
                STATS_PUSHED=$((STATS_PUSHED + 1))
            fi
            clear_failed "$repo_name" "$branch"
            clear_auth_fails
        elif [[ $rc -eq 124 ]]; then
            log "TIMEOUT ${repo_name}/${branch} @ ${head:0:7} — retry next cycle"
            notify_error "${repo_name}" "${branch}" "git push timed out after 30s" "$head" "124"
        else
            log "PUSH ERROR ${repo_name}/${branch} @ ${head:0:7} (exit ${rc}):"
            echo "$out" | sed 's/^/  /'
            notify_error "${repo_name}" "${branch}" "$out" "$head" "$rc"
            set_failed_hash "$repo_name" "$branch" "$head"
            is_auth_error "$out" && { record_auth_fail; log "AUTH FAIL #$(get_auth_fails)"; }
        fi
    done < <(git -C "$repo_dir" branch --format='%(refname:short)' 2>/dev/null)
}

push_all_in() {
    local dest="$1"
    for d in "$dest"/*/; do
        [[ -d "$d/.git" ]] && push_repo "$d"
    done
    [[ -d "$dest/.git" ]] && push_repo "$dest"
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 6 — MERGE PRs (periodic)
# ═══════════════════════════════════════════════════════════════════════════

merge_prs() {
    local health; health=$(gh api rate_limit 2>&1) || { log "MERGE: gh unreachable"; return 1; }
    local remaining; remaining=$(echo "$health" | python3 -c \
        "import sys,json; print(json.load(sys.stdin).get('resources',{}).get('core',{}).get('remaining',0))" 2>/dev/null) || remaining=0
    [[ "$remaining" -lt 50 ]] && { log "MERGE: rate limited ($remaining left)"; return 1; }

    local merged=0 api=0
    for repo in "${MERGE_REPOS[@]}"; do
        [[ $api -ge $MAX_API_CALLS ]] && break
        local prs; prs=$(gh pr list --repo "tjamescouch/${repo}" --state open \
            --json number,title,headRefName,mergeable --limit 20 2>/dev/null) || continue
        api=$((api + 1))

        echo "$prs" | python3 -c "
import sys, json
for pr in json.load(sys.stdin):
    print(f'{pr[\"number\"]}|{pr[\"title\"]}|{pr[\"headRefName\"]}|{pr.get(\"mergeable\",\"UNKNOWN\")}')
" 2>/dev/null | while IFS='|' read -r num title branch mergeable; do
            [[ $api -ge $MAX_API_CALLS ]] && break
            [[ "$mergeable" == "CONFLICTING" ]] && continue
            [[ "$branch" != feature/* ]] && continue
            [[ "$DRY_RUN" == "true" ]] && { log "[dry-run] merge ${repo}#${num}"; continue; }
            if gh pr merge --repo "tjamescouch/${repo}" "$num" --merge --admin 2>/dev/null; then
                log "MERGED ${repo}#${num} '${title}'"
                merged=$((merged + 1))
            else
                log "MERGE FAILED ${repo}#${num} '${title}'"
                notify "❌ MERGE FAILED ${repo}#${num} '${title}' (branch: ${branch}, mergeable: ${mergeable})"
            fi
            api=$((api + 1))
        done
    done
    [[ $merged -gt 0 ]] && log "Merged $merged PRs"
}

# ═══════════════════════════════════════════════════════════════════════════
# STAGE 7 — CLEANUP stale remote branches (periodic)
# ═══════════════════════════════════════════════════════════════════════════

cleanup_branches() {
    [[ "$DELETE_OLD_DAYS" -le 0 ]] && return 0

    local cutoff; cutoff=$(date -v-${DELETE_OLD_DAYS}d +%s 2>/dev/null \
        || date -d "${DELETE_OLD_DAYS} days ago" +%s 2>/dev/null) || return 0

    for agent_dir in "${WORMHOLE}"/*/; do
        [[ ! -d "$agent_dir" ]] && continue
        for repo_dir in "$agent_dir" "$agent_dir"*/; do
            [[ ! -d "${repo_dir}/.git" ]] && continue
            local repo_name; repo_name=$(basename "$repo_dir")

            GIT_TERMINAL_PROMPT=0 timeout 30 git -c core.hooksPath=/dev/null \
                -c 'url.git@github.com:.insteadOf=https://github.com/' \
                -C "$repo_dir" fetch origin --prune 2>/dev/null || continue

            while IFS= read -r ref; do
                [[ -z "$ref" ]] && continue
                local branch="${ref#origin/}"
                is_protected "$branch" && continue
                local ts; ts=$(git -C "$repo_dir" log -1 --format='%ct' "refs/remotes/origin/${branch}" 2>/dev/null) || continue
                [[ -z "$ts" || "$ts" -ge "$cutoff" ]] && continue
                local age=$(( ($(date +%s) - ts) / 86400 ))
                [[ "$DRY_RUN" == "true" ]] && { log "[dry-run] delete ${repo_name}/${branch} (${age}d)"; continue; }
                if GIT_TERMINAL_PROMPT=0 timeout 30 git -c core.hooksPath=/dev/null \
                    -c 'url.git@github.com:.insteadOf=https://github.com/' \
                    -C "$repo_dir" push origin --delete "$branch" 2>/dev/null; then
                    log "DELETED ${repo_name}/${branch} (${age}d old)"
                fi
            done < <(git -C "$repo_dir" branch -r --format='%(refname:short)' 2>/dev/null | grep '^origin/' | grep -v 'origin/HEAD')
        done
    done
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════════════════════════════════════

main() {
    [[ -n "$LOG_FILE" ]] && exec >> "$LOG_FILE" 2>&1

    log "Pipeline starting (poll=${INTERVAL}s, merge every ${MERGE_EVERY} cycles)"
    log "  Wormhole: $WORMHOLE"
    log "  Source:   $SOURCE"
    mkdir -p "$WORMHOLE"

    local first_run=true

    while [[ "$RUNNING" == "true" ]]; do
        CYCLE=$((CYCLE + 1))

        # Circuit breaker
        if ! check_breaker; then
            local b=0; while [[ $b -lt $AUTH_BACKOFF && "$RUNNING" == "true" ]]; do sleep 1; b=$((b+1)); done
            continue
        fi

        local synced=0 errors=0

        # ── Sync + Push each container ───────────────────────────────────
        while IFS=' ' read -r cid cname; do
            [[ -z "$cid" ]] && continue
            local name; name=$(agent_name "$cname")
            [[ -z "$name" ]] && continue
            local dest="${WORMHOLE}/${name}"

            if [[ "$first_run" == "true" ]]; then
                # Bootstrap: full copy, seed cache, push everything
                log "Bootstrap $name"
                if copy_full "$cid" "$dest"; then
                    sanitize "$dest"
                    while IFS=' ' read -r repo hash; do
                        [[ -n "$repo" && -n "$hash" ]] && HEADS["${name}/${repo}"]="$hash"
                    done < <(container_heads "$cid")
                    push_all_in "$dest"
                    synced=$((synced + 1))
                else
                    log "ERROR: bootstrap $name failed"
                    notify "❌ BOOTSTRAP FAILED for ${name} — podman copy returned no data"
                    errors=$((errors + 1))
                fi
                continue
            fi

            # Incremental: check which repos have new HEADs
            local changed=""
            while IFS=' ' read -r repo hash; do
                [[ -z "$repo" || -z "$hash" ]] && continue
                local key="${name}/${repo}"
                [[ "${HEADS[$key]:-}" == "$hash" ]] && continue
                changed+=" $repo"
                HEADS["$key"]="$hash"
            done < <(container_heads "$cid")

            [[ -z "$changed" ]] && continue
            log "Changed in ${name}:${changed}"

            for repo in $changed; do
                local rdest="$dest/$repo"
                [[ "$repo" == "." ]] && rdest="$dest"

                if copy_repo "$cid" "$repo" "$dest"; then
                    sanitize "$rdest"
                    push_repo "$rdest"
                    synced=$((synced + 1))
                    STATS_SYNCED=$((STATS_SYNCED + 1))
                else
                    log "ERROR: sync ${name}/${repo}"
                    notify "❌ SYNC FAILED ${name}/${repo} — tar copy from container failed"
                    errors=$((errors + 1))
                fi
            done
        done < <(discover)

        first_run=false
        STATS_ERRORS=$((STATS_ERRORS + errors))

        [[ $synced -gt 0 || $errors -gt 0 ]] && log "Cycle $CYCLE: $synced synced, $errors errors"

        # ── Periodic: merge PRs + cleanup branches ───────────────────────
        if [[ $((CYCLE % MERGE_EVERY)) -eq 0 ]]; then
            log "Merge check (cycle $CYCLE)..."
            merge_prs || true
            cleanup_branches || true
        fi

        # ── Heartbeat ────────────────────────────────────────────────────
        if [[ $((CYCLE % 600)) -eq 0 ]]; then
            log "HEARTBEAT: cycles=$CYCLE synced=$STATS_SYNCED pushed=$STATS_PUSHED errors=$STATS_ERRORS"
        fi

        [[ "$RUN_ONCE" == "true" ]] && break

        # Interruptible sleep
        local i=0; while [[ $i -lt $INTERVAL && "$RUNNING" == "true" ]]; do sleep 1; i=$((i+1)); done
    done

    log "Pipeline stopped"
}

main
