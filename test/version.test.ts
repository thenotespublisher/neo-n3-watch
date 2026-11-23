import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { VERSION } from "../src/version";

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")
  );
  assert.equal(VERSION, pkg.version);
});
