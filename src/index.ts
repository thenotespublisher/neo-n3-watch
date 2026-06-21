#!/usr/bin/env node

import { rpc } from "@cityofzion/neon-js";
import chalk from "chalk";
import ora from "ora";
import { program } from "commander";

const NETWORKS: Record<string, string> = {
  mainnet: "https://mainnet1.neo.coz.io:443",
  testnet: "https://testnet1.neo.coz.io:443",
};

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return chalk.gray("null");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function printEvent(
  blockIndex: number,
  txHash: string,
  contract: string,
  eventName: string,
  state: { type: string; value: unknown }[]
) {
  console.log(
    chalk.cyan(`\n── Block ${blockIndex} ──────────────────────────────`)
  );
  console.log(chalk.white(`  TX      `) + chalk.gray(txHash));
  console.log(chalk.white(`  Contract`) + chalk.yellow(` ${contract}`));
  console.log(chalk.white(`  Event   `) + chalk.green(` ${eventName}`));
  if (state.length > 0) {
    console.log(chalk.white(`  Args`));
    state.forEach((item, i) => {
      console.log(
        chalk.gray(`    [${i}]`) +
          chalk.magenta(` ${item.type}`) +
          chalk.white(` = ${formatValue(item.value)}`)
      );
    });
  }
}

async function watch(options: {
  contract: string | undefined;
  event: string | undefined;
  network: string;
  rpc: string | undefined;
  poll: number;
}) {
  const rpcUrl = options.rpc ?? NETWORKS[options.network];
  if (!rpcUrl) {
    console.error(
      chalk.red(
        `Unknown network "${options.network}". Use mainnet, testnet, or --rpc <url>.`
      )
    );
    process.exit(1);
  }

  const client = new rpc.RPCClient(rpcUrl);

  const contractFilter = options.contract?.toLowerCase();
  const eventFilter = options.event?.toLowerCase();

  console.log(chalk.bold.green("\n neo-n3-watch"));
  console.log(chalk.gray(`  Network : ${options.network} (${rpcUrl})`));
  console.log(
    chalk.gray(
      `  Contract: ${contractFilter ?? chalk.italic("all contracts")}`
    )
  );
  console.log(
    chalk.gray(`  Event   : ${eventFilter ?? chalk.italic("all events")}`)
  );
  console.log(chalk.gray(`  Poll    : ${options.poll}ms\n`));

  const spinner = ora("Connecting to Neo N3...").start();

  let lastBlock: number;
  try {
    lastBlock = await client.getBlockCount() - 1;
    spinner.succeed(chalk.green(`Connected. Starting from block ${lastBlock + 1}`));
  } catch (err) {
    spinner.fail(chalk.red("Failed to connect: " + (err as Error).message));
    process.exit(1);
  }

  console.log(chalk.gray("Watching for events. Press Ctrl+C to stop.\n"));

  async function poll() {
    try {
      const currentBlock = await client.getBlockCount() - 1;

      for (let i = lastBlock + 1; i <= currentBlock; i++) {
        const block = await client.getBlock(i, true);
        const txs = (block as any).tx as { hash: string }[] | undefined;
        if (!txs || txs.length === 0) continue;

        for (const tx of txs) {
          let appLog: any;
          try {
            appLog = await client.getApplicationLog(tx.hash);
          } catch {
            continue;
          }

          const executions: any[] = appLog?.executions ?? [];
          for (const exec of executions) {
            const notifications: any[] = exec?.notifications ?? [];
            for (const notif of notifications) {
              const notifContract: string = (notif.contract ?? "").toLowerCase();
              const notifEvent: string = notif.eventname ?? "";
              const state: { type: string; value: unknown }[] =
                notif.state?.value ?? [];

              if (contractFilter && notifContract !== contractFilter) continue;
              if (
                eventFilter &&
                notifEvent.toLowerCase() !== eventFilter
              )
                continue;

              printEvent(i, tx.hash, notif.contract, notifEvent, state);
            }
          }
        }

        lastBlock = i;
      }
    } catch (err) {
      console.error(chalk.red("\nPoll error: " + (err as Error).message));
    }

    setTimeout(poll, options.poll);
  }

  poll();
}

program
  .name("neo-n3-watch")
  .description(
    "Real-time Neo N3 contract event monitor — stream on-chain events to your terminal"
  )
  .version("1.0.0")
  .option(
    "-c, --contract <hash>",
    "Contract script hash to filter (e.g. 0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5)"
  )
  .option("-e, --event <name>", "Event name to filter (e.g. Transfer)")
  .option(
    "-n, --network <name>",
    "Network: mainnet or testnet (default: mainnet)",
    "mainnet"
  )
  .option("--rpc <url>", "Custom RPC node URL (overrides --network)")
  .option(
    "-p, --poll <ms>",
    "Polling interval in milliseconds (default: 2000)",
    (v: string) => parseInt(v, 10),
    2000
  )
  .action(watch);

program.parse();
