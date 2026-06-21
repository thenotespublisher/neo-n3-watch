# neo-n3-watch

Real-time Neo N3 contract event monitor. Stream on-chain notifications straight to your terminal — no node setup, no code, just `npx`.

```
── Block 4821903 ───────────────────────────
  TX       0xabc123...
  Contract 0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5
  Event    Transfer
  Args
    [0] Hash160  = 0xd2a4cff31913016155e38e474a2c06d08be276cf
    [1] Hash160  = 0x0000000000000000000000000000000000000000
    [2] Integer  = 100000000
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
| `-c, --contract <hash>` | Filter by contract script hash | all contracts |
| `-e, --event <name>` | Filter by event name (e.g. `Transfer`) | all events |
| `-n, --network <name>` | `mainnet` or `testnet` | `mainnet` |
| `--rpc <url>` | Custom RPC node URL (overrides `--network`) | — |
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
- The RPC node must have the `ApplicationLogs` plugin enabled (all public COZ nodes do)
- Very high-volume contracts may produce a lot of output — use `--event` to narrow the stream

## License

Apache 2.0 — see [LICENSE](./LICENSE)

## Contributing

PRs welcome. Open an issue first for bigger changes.
