# wormhole-relay

HTTP relay server for [wormhole](../wormhole/) encrypted file transfers.

## Usage

```sh
npm install
npm run build
npm start
```

Default port: 8787 (override with `PORT` env var).

## Deploy to Fly.io

```sh
fly deploy
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/transfer/:id` | PUT | Store encrypted blob (max 1MB) |
| `/transfer/:id` | GET | Retrieve and delete (one-time pickup) |
| `/transfer/:id` | DELETE | Explicitly delete |
| `/health` | GET | Server status + transfer count |

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8787 | Server port |

Store defaults: 1MB max per transfer, 10-minute TTL, 60-second cleanup interval.

## Testing

```sh
npm test
```

21 tests covering store operations and HTTP endpoints.

## License

MIT
