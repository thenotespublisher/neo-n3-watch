import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToAddress, normalizeContractHash } from "../src/format";

// reference values generated with neo-mamba
const VECTORS: [string, string, string][] = [
  [
    "NQ6D7uurJ7nrK4NSzV4A4iyezeCUtwQmqf",
    "LdBLR0fhfXUvP7yICdCI9TY9zGc=",
    "0x67cc3d36f588d00988bc3f2f757de147474bd02d",
  ],
  [
    "NepwUjd9GhqgNkrfXaxj9mmsFhFzGoFuWM",
    "z3bii9AGLEpHjuNVYQETGfPPpNI=",
    "0xd2a4cff31913016155e38e474a2c06d08be276cf",
  ],
  [
    "NiHURyS83nX2mpxtA7xq84cGxVbHojj5Wc",
    "9WPqQLwoPU0OBcSOowWz8qBzQO8=",
    "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5",
  ],
  [
    "NKuyBkoGdZZSLyPbJEetheRhMjeznFZszf",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "0x0000000000000000000000000000000000000000",
  ],
];

for (const [address, base64, hash] of VECTORS) {
  test(`bytesToAddress decodes ${address}`, () => {
    assert.deepEqual(bytesToAddress(base64), { address, hash });
  });
}

test("bytesToAddress ignores values that are not 20 bytes", () => {
  assert.equal(bytesToAddress("AAAA"), undefined);
  assert.equal(bytesToAddress(Buffer.alloc(19).toString("base64")), undefined);
  assert.equal(bytesToAddress(Buffer.alloc(21).toString("base64")), undefined);
  assert.equal(bytesToAddress(""), undefined);
});

test("bytesToAddress ignores values that are not canonical base64", () => {
  assert.equal(bytesToAddress("not base64!!"), undefined);
  assert.equal(bytesToAddress("z3bii9AGLEpHjuNVYQETGfPPpNI"), undefined);
});

test("normalizeContractHash accepts the hash with or without 0x", () => {
  const hash = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";
  assert.equal(normalizeContractHash(hash), hash);
  assert.equal(normalizeContractHash(hash.slice(2)), hash);
  assert.equal(normalizeContractHash(hash.toUpperCase().replace("0X", "0x")), hash);
  assert.equal(normalizeContractHash(`  ${hash}  `), hash);
});

test("normalizeContractHash rejects invalid hashes", () => {
  for (const bad of ["", "0x1234", "xyz", "0x" + "g".repeat(40), "0x" + "a".repeat(41)]) {
    assert.throws(() => normalizeContractHash(bad), /Invalid contract hash/);
  }
});
