# constraints

## crypto (wormhole file transfer)
- Encryption key and relay key are derived from the same code using different PBKDF2 salts
- Relay never sees plaintext — all encryption/decryption happens client-side
- One-time retrieval: GET deletes the blob from the relay
- 1MB max transfer size per blob
- 10 minute TTL on relay storage
- Zero production dependencies — Node.js stdlib only

## pipeline (container → GitHub sync)
- Agents never hold GitHub credentials — SSH keys stay on the host
- Read-only access to container filesystem via `podman exec` tarball
- Common credential patterns (API keys, .env files) are stripped before push
- Only non-main branches are pushed — main is protected
- Branches already merged into origin/main are auto-skipped
