/**
 * The suite, minus what this system cannot run, said out loud.
 *
 * `npm test` ends in `node src/suite.ts node --test ... src/*.test.ts src/*.test.mjs`. This
 * module expands those patterns itself (cmd.exe expands nothing, and node's own expansion
 * cannot leave a file out), removes the files named in `.github/fichiers-exclus-<system>.txt`
 * for the system it runs on, prints each exclusion with its reason at the top of the output,
 * and runs the command. Without a list for the system, every file runs.
 *
 * Why a list and not a skip inside the file: the one file the Windows list names today,
 * capturer.test.mjs, is shared (source: identite) and is not edited here; on the first Windows
 * run of the matrix (2026-09-29) it never finished, and the job was cancelled 48 minutes after
 * the last line. A skip by name would print nothing (`--test-skip-pattern` reports nothing for
 * what it skips), so the gate that compares skipped names would not see it. A file left out by
 * a versioned list with a written reason is visible in three places: the list, the suite's
 * output, and the README.
 *
 * A listed file that does not exist fails the suite: a list that names nothing lies, exactly
 * like an expected-skips line whose case now runs.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";

export type Exclusion = { file: string; reason: string };

export function systemName(platform: NodeJS.Platform = process.platform): "windows" | "macos" | "linux" {
  return platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
}

/**
 * The list: comment lines, then the file they explain, one file per block. A blank line ends
 * a block, so the header paragraph of the file explains nothing by itself, and a file with no
 * comment right above it is refused: an exclusion without a written reason is a silent one.
 */
export function readExclusions(text: string, name: string): Exclusion[] {
  const out: Exclusion[] = [];
  let reason: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") { reason = []; continue; }
    if (line.startsWith("#")) { reason.push(line.replace(/^#\s?/, "")); continue; }
    if (reason.length === 0) throw new Error(`${name}: "${line}" has no reason written above it. An exclusion without a reason is a silent skip.`);
    out.push({ file: line.replaceAll("\\", "/"), reason: reason.join(" ") });
    reason = [];
  }
  return out;
}

/** Expand `dir/*.suffix` into the sorted files of that directory; anything else passes through. */
export function expandPattern(pattern: string, cwd: string): string[] {
  const m = pattern.match(/^([^*]*)\/\*([^*/]*)$/);
  if (!m) return [pattern];
  const dir = m[1]!, suffix = m[2]!;
  const abs = join(cwd, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(suffix)).sort().map((f) => `${dir}/${f}`);
}

/**
 * The command to run: the program and its options as given, then every file the patterns
 * name (already expanded by a shell, or expanded here), minus the exclusions. An exclusion
 * that names no file of the set is refused.
 */
export function plan(args: readonly string[], exclusions: readonly Exclusion[], cwd: string): { command: string[]; excluded: Exclusion[] } {
  if (args.length === 0) throw new Error("suite.ts: no command given. Usage: node src/suite.ts node --test <patterns>");
  const head: string[] = [args[0]!];
  const files: string[] = [];
  for (const a of args.slice(1)) {
    if (a.startsWith("-") && files.length === 0) { head.push(a); continue; }
    files.push(...expandPattern(a.replaceAll("\\", "/"), cwd));
  }
  const set = new Set(files);
  for (const e of exclusions) {
    if (!set.has(e.file)) {
      throw new Error(`the exclusion list names ${e.file}, which is not a file of this suite: the list lies. Remove the line, or fix the name.`);
    }
  }
  const excludedFiles = new Set(exclusions.map((e) => e.file));
  return { command: [...head, ...files.filter((f) => !excludedFiles.has(f))], excluded: [...exclusions] };
}

export function exclusionListPath(root: string, system = systemName()): string {
  return join(root, ".github", `fichiers-exclus-${system}.txt`);
}

if (isMain(import.meta)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const system = systemName();
  const listPath = exclusionListPath(root, system);
  const exclusions = existsSync(listPath) ? readExclusions(readFileSync(listPath, "utf8"), listPath) : [];
  const p = plan(process.argv.slice(2), exclusions, root);
  if (p.excluded.length) {
    console.log(`${p.excluded.length} test file(s) not run on ${system}, per .github/fichiers-exclus-${system}.txt:`);
    for (const e of p.excluded) console.log(`  ${e.file}: ${e.reason}`);
    console.log("");
  }
  const [program, ...rest] = p.command;
  const r = spawnSync(program === "node" ? process.execPath : program!, rest, { stdio: "inherit", cwd: root });
  process.exit(r.status ?? 1);
}
