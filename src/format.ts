import { wallet } from "@cityofzion/neon-js";

export interface StackItem {
  type: string;
  value?: unknown;
}

export interface DecodedHash {
  address: string;
  hash: string;
}

export function bytesToAddress(base64: string): DecodedHash | undefined {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== 20 || bytes.toString("base64") !== base64) {
    return undefined;
  }
  const hash = Buffer.from(bytes).reverse().toString("hex");
  return { address: wallet.getAddressFromScriptHash(hash), hash: `0x${hash}` };
}

export function normalizeContractHash(input: string): string {
  const hex = input.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`Invalid contract hash "${input}"`);
  }
  return `0x${hex}`;
}
