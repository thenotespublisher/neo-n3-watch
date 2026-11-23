#!/usr/bin/env node

import { rpc } from "@cityofzion/neon-js";
import chalk from "chalk";
import ora from "ora";
import { Option, program } from "commander";
import { StackItem, bytesToAddress, normalizeContractHash } from "./format";
import { VERSION } from "./version";
import {
  WebhookPayload,
  buildPayload,
  parseWebhookUrl,
  sendWebhook,
} from "./webhook";

const NETWORKS: Record<string, string> = {
  mainnet: "https://mainnet1.neo.coz.io:443",
  testnet: "https://testnet1.neo.coz.io:443",
};

const MAX_PENDING_WEBHOOKS = 1000;

function formatValue(item: StackItem): string {
  if (item.type === "ByteString" && typeof item.value === "string") {
    const decoded = bytesToAddress(item.value);
    if (decoded) return `${decoded.address} ${chalk.gray(`(${decoded.hash})`)}`;
  }
  const val = item.value;
  if (val === null || val === undefined) return chalk.gray("null");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function printEvent(
  blockIndex: number,
  txHash: string,
  contract: string,
  eventName: string,
  state: StackItem[]
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
          chalk.white(` = ${formatValue(item)}`)
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
  webhook: string | undefined;
  webhookSecret: string | undefined;
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

  let contractFilter: string | undefined;
  let webhookUrl: URL | undefined;
  try {
    contractFilter = options.contract
      ? normalizeContractHash(options.contract)
      : undefined;
    webhookUrl = options.webhook ? parseWebhookUrl(options.webhook) : undefined;
    if (options.webhookSecret && !webhookUrl) {
      throw new Error("--webhook-secret needs --webhook");
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  const webhookTarget = webhookUrl;

  const client = new rpc.RPCClient(rpcUrl);

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
  if (webhookTarget) {
    console.log(chalk.gray(`  Webhook : ${webhookTarget.origin}`));
  }
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

  let deliveries: Promise<void> = Promise.resolve();
  let pendingDeliveries = 0;

  function deliver(payload: WebhookPayload) {
    if (!webhookTarget) return;
    if (pendingDeliveries >= MAX_PENDING_WEBHOOKS) {
      console.error(
        chalk.yellow(
          `Webhook queue full, dropped ${payload.event} in ${payload.tx}`
        )
      );
      return;
    }
    pendingDeliveries++;
    deliveries = deliveries.then(async () => {
      const result = await sendWebhook(webhookTarget, payload, {
        secret: options.webhookSecret,
      });
      pendingDeliveries--;
      if (!result.ok) {
        console.error(
          chalk.yellow(
            `Webhook delivery failed (${result.error}): ${payload.event} in ${payload.tx}`
          )
        );
      }
    });
  }

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

          let notificationIndex = 0;
          const executions: any[] = appLog?.executions ?? [];
          for (const exec of executions) {
            const notifications: any[] = exec?.notifications ?? [];
            for (const notif of notifications) {
              const index = notificationIndex++;
              const notifContract: string = (notif.contract ?? "").toLowerCase();
              const notifEvent: string = notif.eventname ?? "";
              const state: StackItem[] = notif.state?.value ?? [];

              if (contractFilter && notifContract !== contractFilter) continue;
              if (
                eventFilter &&
                notifEvent.toLowerCase() !== eventFilter
              )
                continue;

              printEvent(i, tx.hash, notif.contract, notifEvent, state);
              deliver(
                buildPayload(i, tx.hash, index, notif.contract, notifEvent, state)
              );
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
  .version(VERSION)
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
    "--webhook <url>",
    "POST every matched event as JSON to this URL (https only)"
  )
  .addOption(
    new Option(
      "--webhook-secret <secret>",
      "Sign webhook bodies with HMAC-SHA256 (X-Neo-Watch-Signature header)"
    ).env("NEO_N3_WATCH_WEBHOOK_SECRET")
  )
  .option(
    "-p, --poll <ms>",
    "Polling interval in milliseconds (default: 2000)",
    (v: string) => parseInt(v, 10),
    2000
  )
  .action(watch);

program.parse();
