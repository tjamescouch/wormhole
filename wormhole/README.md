# wormhole

Easy encrypted file transfer. Send files and directories through a relay with memorable codes.

## How it works

```
sender                          relay                         receiver
  |                               |                              |
  |  generate code: 42-banana-thunder                            |
  |  derive encryption key (PBKDF2)                              |
  |  derive relay key (PBKDF2, different salt)                   |
  |  encrypt payload (AES-256-GCM)                               |
  |                               |                              |
  |  PUT /transfer/{relayKey}  -->|                              |
  |                               |  (stores encrypted blob)     |
  |                               |                              |
  |  "wormhole receive 42-banana-thunder"                        |
  |                               |                              |
  |                               |<-- GET /transfer/{relayKey}  |
  |                               |  (deletes after retrieval)   |
  |                               |                              |
  |                               |  decrypt with same code      |
  |                               |  extract files               |
```

The relay never sees plaintext — encryption key and relay key are derived from the same code using different salts.

## Quick Start

```sh
# Send a file
wormhole send photo.jpg
# => To receive, run:
#    wormhole receive 42-banana-thunder

# Send a directory (packed with slurp)
wormhole send src/

# Receive
wormhole receive 42-banana-thunder

# Self-host the relay
wormhole relay
```

## Install

```sh
npm install
npm run build
```

## CLI

```
wormhole send <file-or-dir>     Pack, encrypt, and upload
wormhole receive <code>          Download, decrypt, and extract
wormhole relay                   Start the relay server

Options:
  --relay, -r <url>    Relay URL (default: localhost:8787, or WORMHOLE_RELAY env)
  --output, -o <path>  Output directory for receive (default: .)
  --code, -c <code>    Custom transfer code for send
```

## Crypto

- **Key derivation**: PBKDF2 with 100K iterations, SHA-256
- **Encryption**: AES-256-GCM with random 12-byte IV
- **Code format**: `{1-999}-{word}-{word}` (~656K combinations from 500-word list)
- Two keys derived per code:
  - `encryption_key = PBKDF2(code, "wormhole-encryption-v1")`
  - `relay_key = PBKDF2(code, "wormhole-relay-key-v1")`

## Relay

Minimal HTTP server with in-memory storage:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/transfer/:id` | PUT | Store encrypted blob (max 1MB) |
| `/transfer/:id` | GET | Retrieve and delete (one-time pickup) |
| `/transfer/:id` | DELETE | Explicitly delete |
| `/health` | GET | Server status |

Rules:
- 1MB max per transfer
- 10 minute TTL
- One-time retrieval (GET deletes the entry)
- Fly.io deployable (`fly deploy` from `wormhole-relay/`)

## Directory Transfers

Directories are packed using [slurp](../slurp/) — compressed into a self-extracting POSIX shell archive, then encrypted and sent through the relay. On receive, the archive is detected and extracted automatically.

## Testing

```sh
# Relay tests (21 tests)
cd wormhole-relay && npm test

# Client tests (28 tests)
cd wormhole && npm test
```

49 tests covering crypto round-trips, code generation, relay store + HTTP, and E2E file/directory transfers.

## Stack

- TypeScript, ESM
- Zero production dependencies
- Node.js stdlib only (crypto, http, fs)

## License

MIT
