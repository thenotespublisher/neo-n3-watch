import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WebhookPayload,
  buildPayload,
  parseWebhookUrl,
  sendWebhook,
  signBody,
} from "../src/webhook";
import { VERSION } from "../src/version";
import { server, status } from "./helpers";

const PAYLOAD: WebhookPayload = {
  block: 1,
  tx: "0xabc",
  index: 0,
  contract: "0xdef",
  event: "Transfer",
  state: [],
};

test("parseWebhookUrl allows https and local http only", () => {
  for (const ok of [
    "https://example.com/hook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://[::1]:8080/hook",
  ]) {
    assert.equal(parseWebhookUrl(ok).href, new URL(ok).href);
  }
  for (const bad of [
    "http://example.com/hook",
    "http://localhost.evil.com/hook",
    "http://127.0.0.1.evil.com/hook",
    "ftp://example.com/hook",
    "not a url",
    "",
  ]) {
    assert.throws(() => parseWebhookUrl(bad), /webhook URL/i);
  }
});

test("signBody matches an HMAC-SHA256 computed by Python", () => {
  assert.equal(
    signBody("s3cret", '{"a":1}'),
    "sha256=5910e62016ef5034272c926c27071992a465c2335cecf41851bda071577f4f6d"
  );
});

test("buildPayload adds an address to 20 byte ByteStrings only", () => {
  const payload = buildPayload(7, "0xtx", 2, "0xc", "Transfer", [
    { type: "ByteString", value: "LdBLR0fhfXUvP7yICdCI9TY9zGc=" },
    { type: "ByteString", value: "AAAA" },
    { type: "Integer", value: "5" },
    { type: "Any" },
  ]);
  assert.deepEqual(payload, {
    block: 7,
    tx: "0xtx",
    index: 2,
    contract: "0xc",
    event: "Transfer",
    state: [
      {
        type: "ByteString",
        value: "LdBLR0fhfXUvP7yICdCI9TY9zGc=",
        address: "NQ6D7uurJ7nrK4NSzV4A4iyezeCUtwQmqf",
      },
      { type: "ByteString", value: "AAAA" },
      { type: "Integer", value: "5" },
      { type: "Any" },
    ],
  });
});

test("sendWebhook posts the payload as JSON", async () => {
  const s = await server(status(200));
  try {
    assert.deepEqual(await sendWebhook(s.url, PAYLOAD), { ok: true });
    assert.equal(s.received.length, 1);
    const [r] = s.received;
    assert.equal(r.method, "POST");
    assert.equal(r.headers["content-type"], "application/json");
    assert.equal(r.headers["user-agent"], `neo-n3-watch/${VERSION}`);
    assert.equal(r.headers["x-neo-watch-signature"], undefined);
    assert.deepEqual(JSON.parse(r.body), PAYLOAD);
  } finally {
    await s.close();
  }
});

test("sendWebhook signs the exact body that is sent", async () => {
  const s = await server(status(200));
  try {
    await sendWebhook(s.url, PAYLOAD, { secret: "s3cret" });
    const [r] = s.received;
    assert.equal(r.headers["x-neo-watch-signature"], signBody("s3cret", r.body));
  } finally {
    await s.close();
  }
});

test("sendWebhook retries server errors and then succeeds", async () => {
  const s = await server((n, res) => status(n < 3 ? 500 : 200)(n, res));
  try {
    assert.deepEqual(await sendWebhook(s.url, PAYLOAD, { backoffMs: 1 }), {
      ok: true,
    });
    assert.equal(s.received.length, 3);
  } finally {
    await s.close();
  }
});

test("sendWebhook retries 429", async () => {
  const s = await server((n, res) => status(n < 2 ? 429 : 200)(n, res));
  try {
    assert.deepEqual(await sendWebhook(s.url, PAYLOAD, { backoffMs: 1 }), {
      ok: true,
    });
    assert.equal(s.received.length, 2);
  } finally {
    await s.close();
  }
});

test("sendWebhook gives up after the retries", async () => {
  const s = await server(status(503));
  try {
    assert.deepEqual(
      await sendWebhook(s.url, PAYLOAD, { retries: 2, backoffMs: 1 }),
      { ok: false, error: "HTTP 503" }
    );
    assert.equal(s.received.length, 3);
  } finally {
    await s.close();
  }
});

test("sendWebhook does not retry client errors", async () => {
  const s = await server(status(400));
  try {
    assert.deepEqual(await sendWebhook(s.url, PAYLOAD, { backoffMs: 1 }), {
      ok: false,
      error: "HTTP 400",
    });
    assert.equal(s.received.length, 1);
  } finally {
    await s.close();
  }
});

test("sendWebhook does not follow redirects", async () => {
  const target = await server(status(200));
  const s = await server((_n, res) => {
    res.statusCode = 302;
    res.setHeader("Location", target.url.href);
    res.end();
  });
  try {
    const result = await sendWebhook(s.url, PAYLOAD, { retries: 0 });
    assert.equal(result.ok, false);
    assert.equal(s.received.length, 1);
    assert.equal(target.received.length, 0);
  } finally {
    await s.close();
    await target.close();
  }
});

test("sendWebhook times out", async () => {
  const s = await server(() => {});
  try {
    const result = await sendWebhook(s.url, PAYLOAD, {
      timeoutMs: 50,
      retries: 0,
    });
    assert.equal(result.ok, false);
  } finally {
    await s.close();
  }
});

test("sendWebhook reports an unreachable endpoint", async () => {
  const s = await server(status(200));
  const url = s.url;
  await s.close();
  const result = await sendWebhook(url, PAYLOAD, { retries: 0 });
  assert.equal(result.ok, false);
});
