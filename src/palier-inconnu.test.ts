/*
 * UN PALIER INCONNU PARTAIT VERS L'ENCODEUR `large`, EN SILENCE.
 *
 * `extract()` finissait par `tier === "small" ? qaSmall : qaLarge` : tout ce qui n'est ni
 * `rules`, ni `human`, ni génératif, ni `small` prenait le grand encodeur. Et `mesurer-dur.ts`
 * castait `--tiers=` en `TierName[]` — un cast n'est pas un contrôle, c'est une affirmation.
 *
 * `npm run dur -- --tiers=gen8b`, le tiret oublié, publiait donc dans `dur.json` un palier
 * INVENTÉ portant les chiffres de `large` : cohérent, plausible, et impossible à rapprocher
 * de quoi que ce soit.
 *
 * C'est la famille du `.length` qui répond sur trop de choses : un `else` qui prend tout ce
 * qui reste répond aussi pour ce qu'il n'a jamais vu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extract } from "./tiers.ts";
import { TIERS } from "./paliers.ts";

test("un palier inconnu est refusé par son nom, pas routé vers `large`", async () => {
  const d = { text: "Ada Lovelace, née le 10 décembre 1815", truth: { name: "Ada Lovelace" } } as never;

  for (const faux of ["gen8b", "Large", "small ", "", "rules2"]) {
    await assert.rejects(() => extract(faux as never, d, "name" as never), /unknown tier/,
      `« ${faux} » traverse : il prendrait les chiffres de l'encodeur \`large\` sous son propre nom.`);
  }

  /*
   * TÉMOIN POSITIF, et il ne demande aucun modèle : `rules` est une expression régulière pure.
   * Sans lui, une garde qui refuserait TOUT satisferait le bloc ci-dessus.
   */
  const r = await extract("rules" as never, d, "name" as never);
  assert.equal(typeof r, "string", "le palier `rules` est refusé lui aussi : la garde prend trop large.");
});

test("`mesurer-dur --tiers=` refuse un palier qui n'existe pas, et nomme ceux qui existent", () => {
  const cmd = fileURLToPath(new URL("./mesurer-dur.ts", import.meta.url));
  const r = spawnSync(process.execPath, [cmd, "--tiers=gen8b"],
    { encoding: "utf8", timeout: 120_000 });

  assert.notEqual(r.status, 0,
    `la commande accepte « gen8b » (code ${r.status}) : elle mesurera sous un nom inventé.`);
  assert.match(`${r.stderr}${r.stdout}`, /unknown tier\(s\): gen8b/,
    "le refus ne nomme pas ce qu'il refuse.");
  /* La liste des paliers connus se DEMANDE à TIERS : la citer ici serait une deuxième liste. */
  for (const t of TIERS) {
    assert.match(`${r.stderr}${r.stdout}`, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `le refus ne cite pas « ${t} » parmi les paliers connus : l'utilisateur doit deviner.`);
  }
});
