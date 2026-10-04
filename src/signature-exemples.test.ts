/*
 * THE SEALED RECORDS UNDER examples/ TRAVEL WITH THEIR SIGNATURE TOO.
 *
 * `signature-livree.test.ts` (shared across the family, source: this repository) walks the
 * repository root: a sealed JSON tracked by git must have a tracked `.signature.json` beside it
 * that verifies against `cle-publique.pem` over the seal's bytes. `examples/` escaped it, and the
 * public CORD record shipped sealed and unsigned (audit of 4 October 2026). This case walks
 * `examples/` with the same three requirements, written here rather than in the shared file so
 * that the four sibling repositories, which carry a byte-identical copy of that file, do not
 * fall behind on a change only this repository needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as verifierBrut, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const racine = fileURLToPath(new URL("..", import.meta.url));
const SCEAU = /^[0-9a-f]{16}$/;

/** The tracked JSON files under examples/ that carry a seal at their root. */
export function relevesScellesDesExemples(suivis: ReadonlySet<string>): string[] {
  return [...suivis].filter((n) => n.startsWith("examples/") && n.endsWith(".json") && !n.endsWith(".signature.json"))
    .filter((n) => {
      try {
        const o: unknown = JSON.parse(readFileSync(join(racine, n), "utf8"));
        return typeof o === "object" && o !== null && SCEAU.test(String((o as Record<string, unknown>)["empreinte"] ?? ""));
      } catch { return false; }
    })
    .sort();
}

export function manquesDUnExemple(nom: string, suivis: ReadonlySet<string>, clePubliquePem: string): string[] {
  const sig = nom.replace(/\.json$/, ".signature.json");
  if (!existsSync(join(racine, sig))) return [`${nom}: no ${sig} beside it; the record is sealed but nothing says who issued it`];
  if (!suivis.has(sig)) return [`${nom}: ${sig} is on disk and not tracked by git; a reader who clones gets the record and nothing to verify it with`];
  const s = JSON.parse(readFileSync(join(racine, sig), "utf8")) as { alg?: string; valeur?: string };
  const sceau = String((JSON.parse(readFileSync(join(racine, nom), "utf8")) as Record<string, unknown>)["empreinte"]);
  let bon = false;
  try { bon = verifierBrut(null, Buffer.from(sceau, "utf8"), createPublicKey(clePubliquePem), Buffer.from(String(s.valeur ?? ""), "base64")); }
  catch { bon = false; }
  return bon ? [] : [`${nom}: ${sig} does not verify against cle-publique.pem over the seal ${sceau}`];
}

test("every sealed record shipped under examples/ carries a signature that verifies against the repository's key", (t) => {
  let suivis: Set<string>;
  try {
    suivis = new Set(execFileSync("git", ["-C", racine, "ls-files", "--", "examples"], { encoding: "utf8" }).split("\n").filter(Boolean));
  } catch {
    return t.skip("not a git checkout: the guard looks at what git ships, and without git it cannot tell a published file from a working one");
  }
  const cle = readFileSync(join(racine, "cle-publique.pem"), "utf8");
  const releves = relevesScellesDesExemples(suivis);
  assert.ok(releves.includes("examples/cord-receipts/cord-labels-grouped-measured.json"),
    `the CORD record is not among the sealed records found under examples/ (${releves.join(", ")}): the walk reads nothing`);
  const fautes = releves.flatMap((n) => manquesDUnExemple(n, suivis, cle));
  assert.deepEqual(fautes, [], "sealed records under examples/ are not verifiable by a reader who does not trust us");
});

test("the walk refuses a record without a signature, an untracked one, and one signed by another key", () => {
  /* The witness: the detector must see each of the three forms, or its green means nothing. */
  const suivisSansSig = new Set(["examples/cord-receipts/cord-labels-grouped-measured.json"]);
  assert.match(manquesDUnExemple("examples/cord-receipts/cord-labels-grouped-measured.json", suivisSansSig, readFileSync(join(racine, "cle-publique.pem"), "utf8"))[0] ?? "",
    /not tracked by git/, "a signature on disk and not tracked must be named");
  const autre = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const suivis = new Set(["examples/cord-receipts/cord-labels-grouped-measured.json", "examples/cord-receipts/cord-labels-grouped-measured.signature.json"]);
  assert.match(manquesDUnExemple("examples/cord-receipts/cord-labels-grouped-measured.json", suivis, autre)[0] ?? "",
    /does not verify/, "a signature checked against another key must fall");
  assert.deepEqual(manquesDUnExemple("examples/cord-receipts/cord-labels-grouped-measured.json", suivis, readFileSync(join(racine, "cle-publique.pem"), "utf8")), [],
    "the real signature against the real key must pass, or the guard has eaten the tool");
});
