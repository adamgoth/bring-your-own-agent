import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { outputDirectory, saveTarballs } from "./sdk-output.mjs";

test("retained artifacts have a stable default and accept a repository-relative output directory", () => {
  assert.equal(outputDirectory([], "/project"), null);
  assert.equal(
    outputDirectory(["--keep"], "/project"),
    resolve("/project/artifacts/sdk"),
  );
  assert.equal(
    outputDirectory(["--keep", "--out", "vendor/byoa"], "/app"),
    resolve("/app/vendor/byoa"),
  );
  assert.throws(() => outputDirectory(["--out"]), /requires a directory/);
  assert.equal(
    outputDirectory(["--pack-only"], "/project"),
    resolve("/project/artifacts/sdk"),
  );
  assert.equal(
    outputDirectory(["--pack-only", "--out", "/app/vendor/byoa"], "/project"),
    resolve("/app/vendor/byoa"),
  );
});

test("saved archives survive temporary consumer cleanup without copying caches", () => {
  const root = mkdtempSync(join(tmpdir(), "sdk-output-test-"));
  try {
    const source = join(root, "source");
    const output = join(root, "app/vendor/byoa");
    // Use the helper's directory creation for the empty scratch fixture too.
    saveTarballs([], source);
    const archive = join(source, "byoagent-browser-0.1.0.tgz");
    writeFileSync(archive, "fixture archive");
    writeFileSync(join(source, "cache"), "must not be copied");
    const saved = saveTarballs([archive], output);
    rmSync(source, { recursive: true, force: true });
    assert.equal(readFileSync(saved[0], "utf8"), "fixture archive");
    assert.deepEqual(readdirSync(output), ["byoagent-browser-0.1.0.tgz"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
