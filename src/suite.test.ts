/*
 * The suite runner: what it leaves out on a system, it says, and the list cannot lie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readExclusions, expandPattern, plan, systemName, exclusionListPath } from "./suite.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("an exclusion carries the reason written above it, and a file without one is refused", () => {
  const list = readExclusions("# header paragraph\n# says nothing about a file\n\n# the reason\n# on two lines\nsrc/a.test.ts\n", "l.txt");
  assert.deepEqual(list, [{ file: "src/a.test.ts", reason: "the reason on two lines" }]);
  assert.throws(() => readExclusions("# header\n\nsrc/a.test.ts\n", "l.txt"), /"src\/a\.test\.ts" has no reason written above it/);
  assert.deepEqual(readExclusions("# only a header\n", "l.txt"), []);
});

test("the plan expands the patterns itself, leaves the listed file out, and refuses a list that names no file of the suite", () => {
  const d = mkdtempSync(join(tmpdir(), "suite-"));
  try {
    mkdirSync(join(d, "src"));
    for (const f of ["b.test.ts", "a.test.ts", "c.test.mjs", "not-a-test.ts"]) writeFileSync(join(d, "src", f), "");
    assert.deepEqual(expandPattern("src/*.test.ts", d), ["src/a.test.ts", "src/b.test.ts"]);
    assert.deepEqual(expandPattern("src/a.test.ts", d), ["src/a.test.ts"], "a plain path passes through");
    const args = ["node", "--test", "--test-timeout=5", "src/*.test.ts", "src/*.test.mjs"];
    const none = plan(args, [], d);
    assert.deepEqual(none.command, ["node", "--test", "--test-timeout=5", "src/a.test.ts", "src/b.test.ts", "src/c.test.mjs"]);
    const one = plan(args, [{ file: "src/c.test.mjs", reason: "hangs here" }], d);
    assert.deepEqual(one.command, ["node", "--test", "--test-timeout=5", "src/a.test.ts", "src/b.test.ts"]);
    assert.deepEqual(one.excluded, [{ file: "src/c.test.mjs", reason: "hangs here" }]);
    /* A shell that expanded the patterns already gives plain paths: the same plan. */
    const expanded = plan(["node", "--test", "src/a.test.ts", "src/b.test.ts", "src\\c.test.mjs"], [{ file: "src/c.test.mjs", reason: "r" }], d);
    assert.deepEqual(expanded.command, ["node", "--test", "src/a.test.ts", "src/b.test.ts"]);
    assert.throws(() => plan(args, [{ file: "src/gone.test.ts", reason: "r" }], d), /names src\/gone\.test\.ts, which is not a file of this suite: the list lies/);
    assert.throws(() => plan([], [], d), /no command given/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the system's name, and the Windows list names files this suite has, each with its reason", () => {
  assert.equal(systemName("win32"), "windows");
  assert.equal(systemName("darwin"), "macos");
  assert.equal(systemName("linux"), "linux");
  const windows = exclusionListPath(ROOT, "windows");
  assert.ok(existsSync(windows), "the Windows list is missing");
  const list = readExclusions(readFileSync(windows, "utf8"), windows);
  assert.ok(list.length >= 1);
  for (const e of list) {
    assert.ok(existsSync(join(ROOT, e.file)), `${e.file} is listed and does not exist`);
    assert.ok(e.reason.length > 40, `${e.file}: the reason is a sentence, not a word`);
  }
  assert.doesNotThrow(() => plan(["node", "--test", "src/*.test.ts", "src/*.test.mjs"], list, ROOT));
  for (const system of ["linux", "macos"] as const) {
    assert.ok(!existsSync(exclusionListPath(ROOT, system)), `${system} has an exclusion list: every file runs there, and a list would say otherwise`);
  }
});

test("npm test goes through the runner and caps every case, so a hang is a named failure and not a silent job", () => {
  const script = String(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.test);
  assert.match(script, /node src\/suite\.ts node --test --test-timeout=\d+ src\/\*\.test\.ts src\/\*\.test\.mjs$/);
  const timeout = Number(script.match(/--test-timeout=(\d+)/)![1]);
  assert.ok(timeout >= 600_000 && timeout <= 1_800_000, `${timeout} ms: a cap under ten minutes cuts real cases, one over thirty hides a hang`);
});
