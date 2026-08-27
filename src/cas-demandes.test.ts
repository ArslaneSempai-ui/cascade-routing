/*
 * SIX COMMANDES SUR HUIT LISAIENT `--cases=` SANS AUCUNE GARDE.
 *
 * `Number("")` vaut 0, et `??` ne rattrape pas la chaîne vide : `--cases=` faisait tourner
 * une passe sur zéro dossier, qui écrivait ensuite son fichier — daté, complet, avec l'allure
 * d'une mesure. `departager-reglage --cases=` écrasait un relevé VERSIONNÉ par une passe sur
 * rien.
 *
 * La garde existait, dans `fuite.ts` et `regler-prompt.ts`, recopiée mot pour mot. Leur
 * commentaire disait déjà que la copie n'était pas sa place — et pendant ce temps six autres
 * commandes n'en avaient pas du tout. **Une garde recopiée signale l'endroit où elle manque
 * ailleurs.**
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { lireCas } from "./cas-demandes.ts";

test("les formes qui rendaient zéro dossier sont refusées, et les bonnes passent", () => {
  const cas = (a: string[]) => lireCas(a, 120);

  /* Le défaut : le drapeau absent, et le drapeau tapé sans valeur — une frappe interrompue. */
  assert.deepEqual(cas([]), { cas: 120 });
  assert.deepEqual(cas(["--cases="]), { cas: 120 },
    "`--cases=` vide doit valoir « non précisé ». `Number(\"\")` vaut 0, et une passe sur zéro\n"
    + "  dossier écrivait un fichier qui avait l'air d'une mesure.");
  assert.deepEqual(cas(["--cases=  "]), { cas: 120 });

  /* Les refus, et chacun d'eux rendait zéro dossier sans un mot. */
  for (const v of ["abc", "0", "-5", "3.5", "1e400", "NaN", "Infinity"]) {
    const r = cas([`--cases=${v}`]);
    assert.ok("refus" in r, `--cases=${v} est accepté : \`generateRecords\` rend zéro dossier`
      + " pour NaN comme pour 0 comme pour un négatif, et la passe écrira quand même.");
    assert.match((r as { refus: string }).refus, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "le refus ne cite pas la valeur reçue : un refus qui ne dit pas ce qu'il a lu se relit"
      + " sans rien apprendre.");
  }

  /* TÉMOIN POSITIF : le vert doit être atteignable, sinon le bloc ci-dessus dirait seulement
     que tout est refusé. */
  assert.deepEqual(cas(["--cases=12"]), { cas: 12 });
  assert.deepEqual(cas(["--tier=large", "--cases=300"]), { cas: 300 });
});

test("aucune commande ne lit `--cases=` par elle-même", () => {
  /*
   * LA COUVERTURE SE DÉDUIT, ELLE NE SE RÉCITE PAS. Une liste de commandes écrite ici
   * oublierait la prochaine — c'est exactement ce qui est arrivé aux six.
   */
  const src = fileURLToPath(new URL(".", import.meta.url));
  const lecteurs: string[] = [];
  let balayes = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "cas-demandes.ts") continue;
    const t = readFileSync(join(src, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/.*$/gm, " ");
    balayes++;
    if (/startsWith\(\s*["']--cases=["']\s*\)/.test(t)) lecteurs.push(f);
  }

  /* Un dossier vide rendrait « aucun lecteur non gardé » sans avoir rien lu. */
  assert.ok(balayes >= 20,
    `${balayes} commande(s) balayée(s) dans src/ : la lecture du dossier a échoué, et une liste`
    + " vide se lirait comme « tout est gardé ».");

  /* Non-vacuité : le motif doit reconnaître la lecture là où elle est légitime. */
  const commun = readFileSync(join(src, "cas-demandes.ts"), "utf8");
  assert.match(commun, /startsWith\(\s*["']--cases=["']\s*\)/,
    "le motif ne reconnaît plus une lecture de `--cases=` : ce cas ne garde plus rien.");

  /* Le compte du 26 août 2026 — six commandes sur huit — reste ici, dans le commentaire :
     c'est un fait daté, il ne se vérifie pas, et un message d'échec est lu au moment où
     quelqu'un cherche une cause. Lui servir un nombre qui a dérivé depuis est le pire moment. */
  assert.deepEqual(lecteurs, [],
    `${lecteurs.join(", ")} lit \`--cases=\` sans passer par \`cas-demandes.ts\`.\n`
    + "  `Number(\"\")` vaut 0 : la passe tournerait sans aucun dossier et écrirait quand même\n"
    + "  son fichier.\n"
    + "  → `import { casDemandes } from \"./cas-demandes.ts\";`");
});

test("le refus se produit VRAIMENT au point d'appel, pas seulement dans la fonction", async () => {
  /*
   * Éprouver `lireCas` ne dit rien de ce que fait la commande. Le défaut d'origine était
   * précisément au point d'appel : la fonction n'y était pas.
   */
  const cmd = fileURLToPath(new URL("./contrainte.ts", import.meta.url));
  const r = spawnSync(process.execPath, [cmd, "--cases=abc"], { encoding: "utf8", timeout: 60_000 });

  assert.notEqual(r.status, 0,
    `\`contrainte.ts --cases=abc\` sort en ${r.status} : la commande a mesuré sur zéro dossier.`);
  assert.match(`${r.stderr}${r.stdout}`, /--cases=abc is not a number of records/,
    "la commande refuse, mais pas pour cette raison-là : un refus sincère sur une garde\n"
    + "  voisine se lit comme un refus sur celle qu'on éprouve.");
});
