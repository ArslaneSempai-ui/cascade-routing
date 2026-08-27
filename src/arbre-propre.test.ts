/*
 * HUIT COPIES DE LA GARDE D'ARBRE SALE, TROIS ISSUES INCOMPATIBLES, DEUX DÉFINITIONS.
 *
 * Relevé le 27 août 2026 : `measure` offrait `--allow-dirty="raison"`, `mesurer-ocr`
 * `--arbre-modifie` sans raison, et CINQ commandes refusaient sans offrir aucune issue —
 * `mesurer-dur`, `apparier-prompt`, `departager-reglage`, `regler-prompt`,
 * `sensibilite-prompt`. Celui qui apprend `--allow-dirty` sur `measure` se fait refuser par
 * les voisines, et `refuserDrapeauxInconnus` rejette en plus le drapeau qu'il vient
 * d'apprendre. Un refus dont l'issue change d'une commande à l'autre se lit comme un refus
 * sans issue : on le contourne, ou on abandonne.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { etatDuDepot, raisonDArbreSale, DRAPEAUX_ARBRE } from "./arbre-propre.ts";

const src = fileURLToPath(new URL(".", import.meta.url));

test("les deux issues sont acceptées, et une absence reste une absence", () => {
  assert.equal(raisonDArbreSale([]), undefined);
  assert.equal(raisonDArbreSale(["--cases=10"]), undefined,
    "un drapeau voisin est pris pour l'issue : la garde ne refuserait plus rien.");

  /* Celle de `measure`, avec sa raison — c'est elle qui entre dans la provenance. */
  assert.equal(raisonDArbreSale(['--allow-dirty=je mesure du code en cours']), "je mesure du code en cours");
  /* Celle d'`ocr`, sans raison : acceptée pour que personne ne réapprenne un geste. */
  assert.equal(raisonDArbreSale(["--arbre-modifie"]), "reason not given");
  assert.equal(raisonDArbreSale(["--allow-dirty"]), "reason not given");
});

test("une seule commande git lit l'état de l'arbre, et elle rend la liste", () => {
  const e = etatDuDepot();
  assert.ok(e, "git ne répond pas ici : ce cas ne vérifie rien.");
  assert.match(e!.commit, /^[0-9a-f]{7,40}$/, `« ${e!.commit} » n'est pas une empreinte.`);
  assert.ok(Array.isArray(e!.sale),
    "l'état rend un booléen : le refus ne peut plus NOMMER les fichiers, et un refus qui ne\n"
    + "  dit pas ce qu'il a vu se relit sans rien apprendre.");
});

test("aucune commande ne refait la garde dans son coin", () => {
  /*
   * LA COUVERTURE SE DÉDUIT. Une liste écrite ici oublierait la huitième commande — c'est
   * exactement ce qui s'est passé : cinq d'entre elles n'avaient jamais reçu l'issue.
   *
   * `hostile.ts` est nommé, avec sa raison : il porte une DEUXIÈME définition de « sale »,
   * restreinte à `src/`, et c'est délibéré. L'adopter partout élargirait sept gardes d'un coup,
   * ce qui n'est pas une conséquence d'un travail d'unification — `corpus-externe/` et les
   * fichiers de notation ne sont pas sous `src/` et changent les résultats.
   */
  /* liste-figee: les deux seuls fichiers qui ont le DROIT de lire l'arbre eux-mêmes —
     `arbre-propre.ts` parce que c'est lui qui le fait pour les autres, et `hostile.ts` parce
     qu'il porte une deuxième définition de « sale », restreinte à `src/`, déclarée et voulue.
     La liste est courte et chacun y est pour une raison écrite : l'ajout d'un troisième doit
     être un geste, pas un oubli. */
  const DECLARES = new Set(["arbre-propre.ts", "hostile.ts"]);
  const copies: string[] = [];
  let balayes = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || DECLARES.has(f)) continue;
    balayes++;
    const t = readFileSync(join(src, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/.*$/gm, " ");
    if (/"status",\s*"--porcelain"/.test(t)) copies.push(f);
  }
  assert.ok(balayes >= 20, `${balayes} module(s) balayé(s) : la lecture du dossier a échoué.`);

  /* Non-vacuité : le motif doit reconnaître la garde là où elle est légitime. */
  assert.match(readFileSync(join(src, "arbre-propre.ts"), "utf8"), /"status",\s*"--porcelain"/,
    "le motif ne reconnaît plus la lecture de l'arbre : ce cas ne garde plus rien.");

  assert.deepEqual(copies, [],
    `${copies.join(", ")} lit l'état de l'arbre par ses propres moyens.\n`
    + "  Les copies dispersées offraient des issues incompatibles, quand elles en offraient.\n"
    + "  → `exigerArbrePropre(\"ce que la commande produit\")`");
});

test("les commandes de mesure offrent TOUTES la même issue", () => {
  /*
   * Le cas au-dessus tient l'implémentation ; celui-ci tient ce que l'utilisateur voit. Une
   * commande pourrait appeler le module et refuser le drapeau plus haut, dans sa propre
   * garde des drapeaux inconnus — le geste appris échouerait quand même.
   */
  const attendues: string[] = [];
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const t = readFileSync(join(src, f), "utf8");
    if (/exigerArbrePropre\(|raisonDArbreSale\(/.test(t.replace(/\/\*[\s\S]*?\*\//g, " "))) attendues.push(f);
  }
  assert.ok(attendues.length >= 6,
    `${attendues.length} commande(s) trouvée(s) : la déduction a échoué, et le vert ne dirait rien.`);

  const sansDrapeau: string[] = [];
  for (const f of attendues) {
    const t = readFileSync(join(src, f), "utf8");
    const m = t.match(/refuserDrapeauxInconnus\(\[([^\]]*)\]/);
    if (!m) continue;                       // pas de garde des drapeaux : rien à accorder
    /*
     * `...DRAPEAUX_ARBRE` COMPTE AUTANT QUE LES NOMS ÉPELÉS, et ma première version l'a
     * refusé : elle cherchait « allow-dirty » dans la liste littérale et accusait les cinq
     * commandes qui font exactement ce qu'il fallait. Le contrôle porte sur ce que la commande
     * ACCEPTE ; que les noms viennent d'un import est le but, pas un manquement. Le lien est
     * tenu par le premier cas de ce fichier, qui éprouve le contenu de `DRAPEAUX_ARBRE`.
     */
    if (!/allow-dirty|arbre-modifie|DRAPEAUX_ARBRE/.test(m[1]!)) sansDrapeau.push(f);
  }
  /* Le maillon : si la liste importée cessait de porter les deux issues, le contrôle
     ci-dessus resterait vert sur un `...DRAPEAUX_ARBRE` devenu vide. */
  assert.deepEqual([...DRAPEAUX_ARBRE].sort(), ["--allow-dirty", "--arbre-modifie"],
    "la liste partagée ne porte plus les deux issues : les commandes qui l'importent\n"
    + "  refuseraient le drapeau qu'elles annoncent.");

  assert.deepEqual(sansDrapeau, [],
    `${sansDrapeau.join(", ")} appelle(nt) la garde mais refuse(nt) l'issue comme drapeau inconnu.\n`
    + "  L'utilisateur lit « --allow-dirty=\"why\" », le tape, et s'entend répondre que ce\n"
    + "  drapeau n'existe pas.");
});
