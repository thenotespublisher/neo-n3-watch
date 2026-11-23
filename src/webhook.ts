import { createHmac } from "crypto";
import { StackItem, bytesToAddress } from "./format";
import { VERSION } from "./version";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface WebhookPayload {
  block: number;
  tx: string;
  index: number;
  contract: string;
  event: string;
  state: (StackItem & { address?: string })[];
}

export interface WebhookOptions {
  secret?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export type WebhookResult = { ok: true } | { ok: false; error: string };

export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid webhook URL "${raw}"`);
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url;
  throw new Error(
    "Webhook URL must use https:// (http:// is only allowed for localhost)"
  );
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function buildPayload(
  block: number,
  tx: string,
  index: number,
  contract: string,
  event: string,
  state: StackItem[]
): WebhookPayload {
  return {
    block,
    tx,
    index,
    contract,
    event,
    state: state.map((item) => {
      const decoded =
        item.type === "ByteString" && typeof item.value === "string"
          ? bytesToAddress(item.value)
          : undefined;
      return decoded ? { ...item, address: decoded.address } : item;
    }),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : err.message;
  }
  return String(err);
}

export async function sendWebhook(
  url: URL,
  payload: WebhookPayload,
  options: WebhookOptions = {}
): Promise<WebhookResult> {
  const { secret, timeoutMs = 5000, retries = 2, backoffMs = 500 } = options;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `neo-n3-watch/${VERSION}`,
  };
  if (secret) headers["X-Neo-Watch-Signature"] = signBody(secret, body);

  let error = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs * 2 ** (attempt - 1))
      );
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true };
      error = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      error = errorMessage(err);
    }
  }
  return { ok: false, error };
}
