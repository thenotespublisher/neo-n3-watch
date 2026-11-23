import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { signBody } from "../src/webhook";
import { server, status } from "./helpers";

const CLI = path.join(__dirname, "..", "src", "index.js");

const GAS = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const NEO = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";
const TX = "0x" + "11".repeat(32);
const SENDER = { type: "ByteString", value: "LdBLR0fhfXUvP7yICdCI9TY9zGc=" };
const RECEIVER = { type: "ByteString", value: "z3bii9AGLEpHjuNVYQETGfPPpNI=" };
const SENDER_ADDRESS = "NQ6D7uurJ7nrK4NSzV4A4iyezeCUtwQmqf";
const RECEIVER_ADDRESS = "NepwUjd9GhqgNkrfXaxj9mmsFhFzGoFuWM";

const notification = (contract: string, eventname: string, amount: string) => ({
  contract,
  eventname,
  state: {
    type: "Array",
    value: [SENDER, RECEIVER, { type: "Integer", value: amount }],
  },
});
const NOTIFICATIONS = [
  notification(NEO, "Transfer", "7"),
  notification(GAS, "Transfer", "5"),
  notification(GAS, "Approve", "1"),
];

async function fakeNode(notifications: unknown[] = NOTIFICATIONS) {
  let blockCountCalls = 0;
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      let result: unknown = null;
      if (method === "getblockcount") {
        // the second call sees one new block (index 100)
        result = blockCountCalls++ === 0 ? 100 : 101;
      } else if (method === "getblock") {
        result = { index: params[0], tx: params[0] === 100 ? [{ hash: TX }] : [] };
      } else if (method === "getapplicationlog") {
        result = { txid: params[0], executions: [{ notifications }] };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        srv.closeAllConnections();
        srv.close(() => resolve());
      }),
  };
}

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NEO_N3_WATCH_WEBHOOK_SECRET: undefined,
      ...env,
    },
  });
  let out = "";
  let err = "";
  let exited = false;
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  const exit = new Promise<number | null>((resolve) =>
    child.on("close", (code) => {
      exited = true;
      resolve(code);
    })
  );
  return {
    stdout: () => out,
    stderr: () => err,
    exited: () => exited,
    exit,
    stop: () => child.kill(),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 10000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("cli: filters, decodes addresses and sends a signed webhook", { timeout: 20000 }, async () => {
  const node = await fakeNode();
  const hook = await server(status(200));
  const cli = run([
    "--rpc", node.url,
    "--contract", GAS.slice(2),
    "--event", "Transfer",
    "--webhook", hook.url.href,
    "--webhook-secret", "s3cret",
    "--poll", "50",
  ]);
  try {
    await waitFor(() => hook.received.length >= 1);
    await sleep(300);
    assert.equal(hook.received.length, 1);

    const [request] = hook.received;
    const payload = JSON.parse(request.body);
    assert.equal(payload.block, 100);
    assert.equal(payload.tx, TX);
    assert.equal(payload.index, 1);
    assert.equal(payload.contract, GAS);
    assert.equal(payload.event, "Transfer");
    assert.equal(payload.state[0].address, SENDER_ADDRESS);
    assert.equal(payload.state[1].address, RECEIVER_ADDRESS);
    assert.deepEqual(payload.state[2], { type: "Integer", value: "5" });
    assert.equal(
      request.headers["x-neo-watch-signature"],
      signBody("s3cret", request.body)
    );

    const out = cli.stdout();
    assert.match(out, new RegExp(`${SENDER_ADDRESS} \\(0x67cc3d36f588d00988bc3f2f757de147474bd02d\\)`));
    assert.match(out, new RegExp(RECEIVER_ADDRESS));
    assert.match(out, new RegExp(`Webhook : ${hook.url.origin}\\n`));
    assert.doesNotMatch(out, /\/hook/);
    assert.doesNotMatch(out, /Approve/);
    assert.doesNotMatch(out, new RegExp(NEO));
  } finally {
    cli.stop();
    await node.close();
    await hook.close();
  }
});

test("cli: reads the webhook secret from the environment", { timeout: 20000 }, async () => {
  const node = await fakeNode();
  const hook = await server(status(200));
  const cli = run(
    ["--rpc", node.url, "--event", "Approve", "--webhook", hook.url.href, "--poll", "50"],
    { NEO_N3_WATCH_WEBHOOK_SECRET: "from-env" }
  );
  try {
    await waitFor(() => hook.received.length >= 1);
    const [request] = hook.received;
    assert.equal(
      request.headers["x-neo-watch-signature"],
      signBody("from-env", request.body)
    );
  } finally {
    cli.stop();
    await node.close();
    await hook.close();
  }
});

test("cli: prints events without a webhook", { timeout: 20000 }, async () => {
  const node = await fakeNode();
  const cli = run(["--rpc", node.url, "--poll", "50"]);
  try {
    await waitFor(() => (cli.stdout().match(/Approve/g) ?? []).length >= 1);
    assert.equal((cli.stdout().match(/Transfer/g) ?? []).length, 2);
    assert.match(cli.stdout(), new RegExp(SENDER_ADDRESS));
    assert.doesNotMatch(cli.stdout(), /Webhook :/);
  } finally {
    cli.stop();
    await node.close();
  }
});

test("cli: keeps printing and warns when the webhook keeps failing", { timeout: 20000 }, async () => {
  const node = await fakeNode();
  const hook = await server(status(500));
  const cli = run([
    "--rpc", node.url,
    "--contract", GAS,
    "--event", "Approve",
    "--webhook", hook.url.href,
    "--poll", "50",
  ]);
  try {
    await waitFor(() => /Webhook delivery failed/.test(cli.stderr()));
    assert.match(cli.stderr(), /Webhook delivery failed \(HTTP 500\): Approve in 0x1111/);
    assert.equal(hook.received.length, 3);
    assert.match(cli.stdout(), /Approve/);
    assert.equal(cli.exited(), false);
  } finally {
    cli.stop();
    await node.close();
    await hook.close();
  }
});

test("cli: drops events when too many webhooks are waiting", { timeout: 20000 }, async () => {
  const events = Array.from({ length: 1100 }, () => notification(GAS, "Approve", "1"));
  const node = await fakeNode(events);
  const hook = await server(() => {});
  const cli = run(["--rpc", node.url, "--webhook", hook.url.href, "--poll", "50"]);
  const dropped = () => (cli.stderr().match(/Webhook queue full/g) ?? []).length;
  try {
    await waitFor(() => dropped() >= 100);
    await sleep(300);
    assert.equal(dropped(), 100);
  } finally {
    cli.stop();
    await node.close();
    await hook.close();
  }
});

for (const [name, args, message] of [
  ["a webhook over plain http", ["--webhook", "http://example.com/hook"], /https/],
  ["a webhook secret without a webhook", ["--webhook-secret", "x"], /--webhook-secret needs --webhook/],
  ["an invalid contract hash", ["--contract", "nothex"], /Invalid contract hash/],
] as [string, string[], RegExp][]) {
  test(`cli: rejects ${name}`, { timeout: 20000 }, async () => {
    const cli = run(args);
    assert.equal(await cli.exit, 1);
    assert.match(cli.stderr(), message);
  });
}
