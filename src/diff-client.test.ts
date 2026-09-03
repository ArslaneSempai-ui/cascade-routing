/*
 * DEUX RELEVÉS CLIENT, COMPARÉS CAS PAR CAS — ET REFUSÉS S'ILS NE VIENNENT PAS DU MÊME FICHIER.
 *
 * `measure:yours` écrit depuis le 3 septembre 2026 un relevé scellé à côté du CSV du client,
 * dans la forme du banc. « Run it twice, compare » ne valait jusque-là que pour nos propres
 * relevés : `diff` joignait tout chemin à la racine du dépôt, et un relevé client, qui vit à
 * côté du fichier du client, n'existait pas pour lui. Ces cas lancent la vraie commande sur
 * deux relevés écrits dans un dossier temporaire, avec leur chemin absolu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourcesIncompatibles } from "./diff.ts";

const CMD = fileURLToPath(new URL("./diff.ts", import.meta.url));

function releve(measuredAt: string, sha256: string, bits: Record<string, Record<string, string>>) {
  const extraction: Record<string, Record<string, { reussites: string; accuracy: number; items: number }>> = {};
  for (const [palier, champs] of Object.entries(bits)) {
    extraction[palier] = {};
    for (const [champ, b] of Object.entries(champs)) {
      const bons = [...b].filter((x) => x === "1").length;
      extraction[palier]![champ] = { reussites: b, accuracy: bons / b.length, items: b.length };
    }
  }
  return { kind: "cascade-client-record", version: 1, measuredAt, source: { file: "cas.csv", sha256, cases: 24 }, extraction };
}

test("deux relevés client du même fichier, par chemin absolu : comparés cas par cas, les pertes nommées", () => {
  const d = mkdtempSync(join(tmpdir(), "diff-client-"));
  try {
    const avant = join(d, "cas-measured.json"), apres = join(d, "cas-measured-2.json");
    writeFileSync(avant, JSON.stringify(releve("2026-09-03T10:00:00.000Z", "a".repeat(64),
      { small: { name: "111100000000000000000000" }, large: { name: "111111111111111111111110" } })));
    writeFileSync(apres, JSON.stringify(releve("2026-09-03T11:00:00.000Z", "a".repeat(64),
      { small: { name: "111110000000000000000000" }, large: { name: "111111111111111111111100" } })));
    const r = spawnSync(process.execPath, [CMD, avant, apres], { encoding: "utf8" });
    assert.match(r.stdout, /2 cell\(s\) compared, 48 cases/, r.stdout + r.stderr);
    assert.match(r.stdout, /cases gained: 1/, r.stdout);
    assert.match(r.stdout, /CASES LOST: 1/, r.stdout);
    assert.match(r.stdout, /large\/name/, "la cellule qui perd un cas doit être nommée.");
    assert.equal(r.status, 1, "une perte de cas sort en 1 — c'est ce qu'un pas d'intégration lit.");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("deux relevés client de fichiers DIFFÉRENTS sont refusés, en nommant les deux", () => {
  const d = mkdtempSync(join(tmpdir(), "diff-client-"));
  try {
    const a = join(d, "a-measured.json"), b = join(d, "b-measured.json");
    writeFileSync(a, JSON.stringify(releve("2026-09-03T10:00:00.000Z", "a".repeat(64), { small: { name: "1111" } })));
    writeFileSync(b, JSON.stringify(releve("2026-09-03T11:00:00.000Z", "b".repeat(64), { small: { name: "1110" } })));
    const r = spawnSync(process.execPath, [CMD, a, b], { encoding: "utf8" });
    assert.equal(r.status, 2, `un refus sort en 2, pas en ${r.status}. Sortie :\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /DIFFERENT files/);
    assert.match(r.stderr, /aaaaaaaaaaaa/, "le refus nomme la première empreinte.");
    assert.match(r.stderr, /bbbbbbbbbbbb/, "et la seconde.");
    assert.doesNotMatch(r.stdout, /cases gained/, "rien ne doit avoir été comparé.");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("sourcesIncompatibles : même empreinte ou empreinte absente, rien à dire ; deux empreintes, refus", () => {
  const meme = { measuredAt: "x", extraction: {}, source: { sha256: "1".repeat(64) } };
  assert.equal(sourcesIncompatibles(meme, meme), null);
  assert.equal(sourcesIncompatibles({ measuredAt: "x", extraction: {} }, meme), null,
    "un relevé du banc, sans source, se compare comme avant.");
  const autre = { measuredAt: "y", extraction: {}, source: { sha256: "2".repeat(64), file: "b.csv" } };
  assert.match(sourcesIncompatibles(meme, autre)!, /DIFFERENT files/);
});
