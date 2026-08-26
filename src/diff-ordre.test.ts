/*
 * « LES DEUX RELEVÉS LES PLUS RÉCENTS » ÉTAIENT LES DEUX DERNIERS PAR ORDRE ALPHABÉTIQUE.
 *
 * Mesuré le 27 août 2026 sur les cinq relevés livrés :
 *
 *   par nom    coeur-rendu (10:40)  ->  un-coeur-pris (09:52)     l'après précède l'avant
 *   par date   coeur-rendu (10:40)  ->  charge-8 (18:38)          la vraie paire
 *
 * Deux défauts, pas un. La paire par défaut était INVERSÉE — cet outil est vendu comme la
 * garde qui dit ce qu'un agrégat en hausse cache, et dans cet ordre il rendait chaque cas
 * gagné pour un cas perdu — et le relevé réellement le plus récent n'était jamais comparé,
 * son nom le plaçant au milieu.
 *
 * L'outil imprimait « 10:40 -> 09:52 » dans sa propre sortie. Les deux dates étaient là, dans
 * le bon ordre pour être lues à l'envers, et rien ne s'y opposait.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ordonnerParMesure, relevesDisponibles, comparer } from "./diff.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));

test("les relevés se rangent par date de mesure, et le tri par nom ne donne PAS le même ordre", () => {
  const noms = relevesDisponibles();
  assert.ok(noms.length >= 3, `${noms.length} relevé(s) : la lecture du dossier a échoué.`);

  const date = (n: string) => (JSON.parse(readFileSync(join(racine, n), "utf8")) as { measuredAt: string }).measuredAt;
  for (let i = 1; i < noms.length; i++) {
    assert.ok(date(noms[i - 1]!) <= date(noms[i]!),
      `${noms[i - 1]} (${date(noms[i - 1]!)}) est rangé avant ${noms[i]} (${date(noms[i]!)}).`);
  }

  /*
   * NON-VACUITÉ, et ici elle décide de tout : si le tri par nom donnait le même ordre, ce cas
   * passerait au vert sur le code d'origine et ne garderait rien. Il faut que les deux ordres
   * DIFFÈRENT sur les relevés livrés pour que le vert ci-dessus veuille dire quelque chose.
   */
  const parNom = readdirSync(racine).filter((f) => /^profiles-.*\.json$/.test(f)).sort();
  assert.notDeepEqual(noms, parNom,
    "l'ordre par date et l'ordre par nom coïncident sur les relevés livrés : ce cas ne peut\n"
    + "  plus distinguer le code corrigé du code d'origine. Il faut un relevé dont le nom et la\n"
    + "  date ne s'accordent pas, sinon la garde n'est plus éprouvée.");
});

test("un relevé sans date de mesure est REFUSÉ, il ne se range pas à une extrémité", () => {
  const bons = [{ nom: "b.json", measuredAt: "2026-08-20T18:38:00Z" },
    { nom: "a.json", measuredAt: "2026-08-19T09:51:25Z" }];
  assert.deepEqual(ordonnerParMesure(bons), ["a.json", "b.json"],
    "témoin positif : l'ordre normal doit rester atteignable.");

  for (const sans of [{ nom: "x.json" }, { nom: "x.json", measuredAt: "" }, { nom: "x.json", measuredAt: 17 }]) {
    assert.throws(() => ordonnerParMesure([...bons, sans]), /carries no measuredAt/,
      `${JSON.stringify(sans)} est rangé au lieu d'être refusé. Sans date il atterrit à une\n`
      + "  extrémité de l'ordre et décide de la paire par défaut sans que personne l'ait voulu.");
  }
});

test("une cellule qui n'existe que dans le SECOND relevé est dite, pas oubliée", () => {
  const cel = (bits: string) => ({ reussites: bits, accuracy: [...bits].filter((b) => b === "1").length / bits.length, items: bits.length });
  const avant = { measuredAt: "A", extraction: { t: { commune: cel("1100") } } };
  const apres = { measuredAt: "B", extraction: { t: { commune: cel("1100"), neuve: cel("1010") } } };

  const r = comparer(avant as never, apres as never);
  const dite = r.cellulesEcartees.find((e) => e.cellule === "t/neuve");
  assert.ok(dite,
    "un palier ajouté entre deux passes n'apparaît nulle part : ni comparé, ni écarté.\n"
    + "  La boucle parcourt les clés du PREMIER relevé, donc la cellule neuve n'existe pas —\n"
    + "  et c'est précisément celle qu'on voulait regarder.");
  assert.match(dite!.pourquoi, /premier/,
    "la raison ne dit pas de quel relevé la cellule est absente : un diagnostic inversé envoie\n"
    + "  chercher dans le bon fichier ce qui est dans l'autre.");

  /* Le sens inverse était déjà dit, et il doit le rester. */
  const r2 = comparer(apres as never, avant as never);
  assert.ok(r2.cellulesEcartees.some((e) => e.cellule === "t/neuve" && /second/.test(e.pourquoi)),
    "le sens qui marchait ne marche plus.");
});

test("un « après » antérieur à son « avant » fait REFUSER la commande, et rien ne s'affiche après", () => {
  const cmd = fileURLToPath(new URL("./diff.ts", import.meta.url));
  const lancer = (...a: string[]) => spawnSync(process.execPath, [cmd, ...a],
    { cwd: racine, encoding: "utf8", timeout: 120_000 });

  const recents = relevesDisponibles().slice(-2);
  const r = lancer(recents[1]!, recents[0]!);

  assert.equal(r.status, 2,
    `comparer ${recents[1]} avec ${recents[0]} — l'après avant l'avant — sort en ${r.status}.\n`
    + "  Dans cet ordre chaque cas gagné est rapporté comme un cas perdu.");
  assert.match(r.stderr, /was measured BEFORE/, "le refus ne dit pas ce qu'il refuse.");
  assert.match(r.stderr, new RegExp(`node src/diff\\.ts ${recents[0]!.replace(/\./g, "\\.")}`),
    "le refus ne donne pas la commande qui répare : un refus sans issue se fait commenter.");

  /*
   * LE REFUS DOIT ÊTRE TERMINAL. Un refus qui laisse la comparaison s'imprimer ensuite est un
   * avertissement, et un avertissement se lit une fois puis s'enjambe — pendant que le chiffre
   * inversé, lui, part quand même.
   */
  assert.doesNotMatch(`${r.stdout}`, /cell\(s\) compared/,
    "la comparaison s'imprime APRÈS le refus : les chiffres à signes inversés sortent quand même.");

  /* TÉMOIN POSITIF : le bon ordre doit passer, sinon la garde interdit l'usage normal. */
  const ok = lancer(recents[0]!, recents[1]!);
  assert.notEqual(ok.status, 2,
    `le bon ordre est refusé lui aussi (${ok.status}) :\n  ${ok.stderr.trim().split("\n")[1] ?? ""}`);
  assert.match(ok.stdout, /cell\(s\) compared/, "le bon ordre ne compare plus rien.");
});
