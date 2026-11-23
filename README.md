# neo-n3-watch

Real-time Neo N3 contract event monitor. Stream on-chain notifications straight to your terminal — no node setup, no code, just `npx`.

```
── Block 4821903 ───────────────────────────
  TX      0xabc123...
  Contract 0xd2a4cff31913016155e38e474a2c06d08be276cf
  Event    Transfer
  Args
    [0] ByteString = NQ6D7uurJ7nrK4NSzV4A4iyezeCUtwQmqf (0x67cc3d36f588d00988bc3f2f757de147474bd02d)
    [1] ByteString = NepwUjd9GhqgNkrfXaxj9mmsFhFzGoFuWM (0xd2a4cff31913016155e38e474a2c06d08be276cf)
    [2] Integer = 500000000
```

## Why

Every Neo N3 dApp developer eventually needs to watch contract events while testing — but doing it today means either writing custom RPC polling code, running a full indexer, or staring at a block explorer. `neo-n3-watch` gives you a focused, zero-setup event stream in your terminal in one command.

## Install

```bash
npm install -g neo-n3-watch
```

Or run without installing:

```bash
npx neo-n3-watch --contract 0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5
```

## Usage

```bash
neo-n3-watch [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --contract <hash>` | Filter by contract script hash, with or without `0x` | all contracts |
| `-e, --event <name>` | Filter by event name (e.g. `Transfer`) | all events |
| `-n, --network <name>` | `mainnet` or `testnet` | `mainnet` |
| `--rpc <url>` | Custom RPC node URL (overrides `--network`) | — |
| `--webhook <url>` | POST every matched event as JSON to this URL (https only) | — |
| `--webhook-secret <secret>` | Sign webhook bodies with HMAC-SHA256. Can also be set with `NEO_N3_WATCH_WEBHOOK_SECRET` | — |
| `-p, --poll <ms>` | Polling interval in milliseconds | `2000` |

### Examples

Watch all NEO token transfers on mainnet:
```bash
neo-n3-watch --contract 0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5 --event Transfer
```

Watch all events from any contract on testnet:
```bash
neo-n3-watch --network testnet
```

Watch a custom contract with fast polling:
```bash
neo-n3-watch --contract 0xYOUR_CONTRACT_HASH --network testnet --poll 1000
```

Use a custom RPC node:
```bash
neo-n3-watch --rpc https://your-node.example.com:443 --contract 0xYOUR_CONTRACT_HASH
```

### Addresses

Stack values that are `ByteString`s of exactly 20 bytes are almost always script hashes, so they are printed as Neo N3 addresses with the script hash in parentheses. Any other value is printed as the node returned it. A 20 byte value that is not a script hash would also be shown as an address.

## Webhooks

Send every matched event to your own service:

```bash
neo-n3-watch --contract 0xd2a4cff31913016155e38e474a2c06d08be276cf --event Transfer \
  --webhook https://example.com/neo-events --webhook-secret "$SECRET"
```

Each event is sent as one `POST` with a JSON body:

```json
{
  "block": 4821903,
  "tx": "0xabc123...",
  "index": 1,
  "contract": "0xd2a4cff31913016155e38e474a2c06d08be276cf",
  "event": "Transfer",
  "state": [
    { "type": "ByteString", "value": "LdBLR0fhfXUvP7yICdCI9TY9zGc=", "address": "NQ6D7uurJ7nrK4NSzV4A4iyezeCUtwQmqf" },
    { "type": "ByteString", "value": "z3bii9AGLEpHjuNVYQETGfPPpNI=", "address": "NepwUjd9GhqgNkrfXaxj9mmsFhFzGoFuWM" },
    { "type": "Integer", "value": "500000000" }
  ]
}
```

`state` is what the node returned. `address` is added to 20 byte `ByteString`s. `index` is the position of the event in its transaction, counted before filtering, so `tx` and `index` identify an event.

If you set a secret, the body is signed and the signature is sent in `X-Neo-Watch-Signature: sha256=<hex>`. To check it, compute the HMAC-SHA256 of the raw request body with the same secret and compare in constant time:

```js
const crypto = require("crypto");
const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const valid =
  signature.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

How delivery works:

- The URL must use `https://`. `http://` is only accepted for `localhost`, `127.0.0.1` and `[::1]`, for local testing.
- Events are sent in order in the background, so the terminal output never waits for your endpoint.
- A request times out after 5 seconds. Network errors, timeouts, `5xx` and `429` are retried twice with a growing delay. Other errors are not retried and redirects are not followed.
- When the last attempt fails the event is dropped and a warning is printed to stderr. Up to 1000 events wait in memory, any more are dropped with a warning.
- Only the scheme, host and port of the webhook URL are printed, never the path or query.

Delivery is best effort. Events are not stored, so they are lost if neo-n3-watch stops or your endpoint stays down. After an RPC error in the middle of a block the same event can be sent a second time, so ignore repeats of the same `tx` and `index`. For guaranteed delivery you need a hosted relay, this is a local command line tool.

## Default RPC Nodes

| Network | URL |
|---------|-----|
| mainnet | `https://mainnet1.neo.coz.io:443` |
| testnet | `https://testnet1.neo.coz.io:443` |

## How It Works

`neo-n3-watch` polls `getBlockCount` on the Neo N3 RPC every `--poll` milliseconds. For each new block it fetches all transactions and their `ApplicationLog`, then filters notifications by contract hash and/or event name and pretty-prints them to your terminal.

No indexer. No database. No websocket. Just RPC polling — lightweight and works with any public Neo N3 node.

## Known Limitations

- Relies on RPC polling (not WebSocket push), so minimum latency equals the block time (~15s on mainnet)
- Requires Node.js 18 or newer
- A transaction is skipped if the node cannot return its application log
- The RPC node must have the `ApplicationLogs` plugin enabled (all public COZ nodes do)
- Very high-volume contracts may produce a lot of output — use `--event` to narrow the stream

## Development

```bash
npm install
npm test
```

The tests run the command against a fake node and a fake webhook receiver, so they need no network.

## License

Apache 2.0 — see [LICENSE](./LICENSE)

## Contributing

PRs welcome. Open an issue first for bigger changes.
