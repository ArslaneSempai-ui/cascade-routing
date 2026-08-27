/**
 * LE CROCHET N'A JAMAIS PU VOIR UN CAS IGNORÉ.
 *
 * Il comptait les cas ignorés en cherchant `^# skipped N`, la forme TAP. `node --test` écrit
 * `ℹ skipped N`. Mesuré sur une suite portant un vrai `t.skip()` : zéro correspondance, pour
 * les deux motifs.
 *
 * Ce qui l'a caché tient en trois caractères — `${ignores:-0}`. **« ligne introuvable » et
 * « zéro cas ignoré » rendaient le même chiffre**, et le chiffre rassurant était celui de la
 * panne. Un défaut de lecture se présentait comme une bonne nouvelle, à chaque commit, depuis
 * que le crochet existe. Trouvé par une session voisine sur le pas d'intégration continue, où
 * le même motif dormait.
 *
 * CE CAS EXÉCUTE LA FONCTION DU CROCHET, IL NE LIT PAS SON TEXTE. Un cas qui vérifierait que
 * le motif « contient bien ℹ » serait écrit dans la forme de la garde : il passerait sur toute
 * réécriture qui garde le caractère et perd le sens. On extrait la fonction du fichier vivant
 * et on la fait tourner sur des sorties fabriquées — si quelqu'un la renomme ou la déplace, ce
 * cas rougit au lieu de garder un fantôme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** La fonction telle qu'elle vit dans le crochet, extraite à l'accolade équilibrée. */
function fonctionDuCrochet(): string {
  const src = readFileSync(racine + ".githooks/pre-commit", "utf8");
  const debut = src.indexOf("compterIgnores() {");
  assert.ok(debut > 0,
    "`compterIgnores` a disparu de .githooks/pre-commit : ce cas ne garde plus rien. "
    + "La retrouver, ou retirer ce cas plutôt que de le laisser rassurer.");
  let prof = 0, fin = debut;
  for (let k = src.indexOf("{", debut); k < src.length; k++) {
    if (src[k] === "{") prof++;
    else if (src[k] === "}") { prof--; if (prof === 0) { fin = k + 1; break; } }
  }
  return src.slice(debut, fin);
}

function compter(sortie: string): string {
  return execFileSync("sh", ["-c", `${fonctionDuCrochet()}\ncompterIgnores "$1"`, "sh", sortie],
    { encoding: "utf8" });
}

test("la forme que node --test écrit vraiment est comptée", () => {
  assert.equal(compter("ℹ tests 12\nℹ pass 11\nℹ skipped 1\n"), "1",
    "`ℹ skipped N` est ce que `node --test` imprime — vérifié sur une suite portant un vrai "
    + "t.skip(). Ne pas le lire, c'est ne jamais voir un cas ignoré.");
});

test("la forme TAP reste comptée — on répare sans casser l'autre", () => {
  assert.equal(compter("# skipped 2\n"), "2");
});

test("une sortie SANS ligne de résumé rend `?`, jamais `0`", () => {
  /* LE CŒUR DU DÉFAUT. Tant que l'absence rendait 0, une lecture ratée se lisait comme
     « aucun cas ignoré » — la seule réponse qui n'alerte personne. */
  assert.equal(compter("ℹ tests 12\nℹ pass 12\n"), "?",
    "sans ligne de résumé, le compte n'a pas été LU. Rendre 0 fait passer un défaut de "
    + "lecture pour une bonne nouvelle, et c'est exactement ce qui a duré jusqu'ici.");
  assert.equal(compter(""), "?");
});

test("zéro ignoré rend bien `0`, et se distingue de `?`", () => {
  /* LA DIRECTION QUI DÉCIDE. Sans ce cas, une fonction qui rendrait toujours `?` passerait
     les trois précédents sauf un, et surtout ne dirait plus jamais rien d'utile. */
  assert.equal(compter("ℹ skipped 0\n"), "0");
});


/*
 * UNE LIGNE DE LA LISTE QUI NE NOMME AUCUN CAS EXISTANT.
 *
 * La porte anti-ignorés compare l'ensemble EXACT des noms, donc elle attrape une liste qui ment
 * — mais seulement SUR UN RUNNER, c'est-à-dire après l'envoi, sur une machine où les cas de
 * plateforme s'ignorent vraiment. Une entrée devenue fausse dort jusque-là.
 *
 * VÉCU LE 27/08/2026, ET C'EST CE QUI A FAIT ÉCRIRE CE CAS. Le commit `4744421` a remplacé le
 * nom littéral « trois compilations simultanées… » par un GABARIT `${SIMULTANEES} compilations…`
 * avec `SIMULTANEES = 3`. Le lanceur rapporte donc « 3 compilations… » ; la liste attendait
 * encore « trois ». Sur le runner la porte aurait rougi des deux côtés à la fois — l'ancien nom
 * attendu et jamais vu, le nouveau vu et non attendu — sur un dépôt qui portait huit commits
 * non poussés et aucune passe d'intégration.
 *
 * Ce cas ferme la moitié qui se voit SANS runner : chaque ligne de la liste doit nommer un cas
 * qui existe. L'autre moitié — un cas qui s'ignore sans être dans la liste — ne se voit que
 * là-bas, et c'est la porte qui la tient. Les deux sont nécessaires.
 *
 * LES GABARITS SE RÉSOLVENT, OU LE CAS REFUSE. Un nom construit se lit `${X} …` dans la source ;
 * on résout `X` par la constante littérale du même fichier. Quand on n'y arrive pas, on REFUSE
 * plutôt que d'ignorer le nom : un extracteur qui écarte en silence ce qu'il ne comprend pas
 * finirait par ne plus regarder que les noms commodes, et c'est exactement le défaut du jour.
 */
function nomsDesCas(dossier: string): { noms: Set<string>; irresolus: string[] } {
  const noms = new Set<string>();
  const irresolus: string[] = [];
  for (const f of readdirSync(dossier).filter((n) => /\.test\.(ts|mjs)$/.test(n))) {
    const src = readFileSync(join(dossier, f), "utf8");
    /*
     * UN GABARIT NE DOIT SE RÉSOUDRE QUE LÀ OÙ UN CAS PEUT S'IGNORER.
     *
     * Un nom construit comme `${FIELDS.length}` n'est pas résoluble ici, et exiger qu'il le
     * soit ferait refuser ce contrôle pour un cas qui ne s'ignore JAMAIS — donc qui ne peut
     * pas figurer dans la liste. La règle se pose sur ce qui décide vraiment : seul un fichier
     * portant un point d'ignorance peut fournir une entrée. Ailleurs, un nom illisible est sans
     * conséquence, et une entrée de liste qui le nommerait serait fautive de toute façon.
     *
     * Écrit ainsi plutôt qu'en exemptant ce nom-là : une exception nommée aurait vieilli, et
     * la règle, elle, suit le fichier qui change.
     */
    const peutIgnorer = /\.skip\(/.test(src);
    const constantes = new Map<string, string>();
    for (const m of src.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+|"[^"]*"|'[^']*')\s*;/gm)) {
      constantes.set(m[1]!, m[2]!.replace(/^["']|["']$/g, ""));
    }
    for (const m of src.matchAll(/^test\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gm)) {
      const brut = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
      const resolu = brut.replace(/\$\{([A-Za-z_$][\w$]*)\}/g,
        (tout, cle: string) => constantes.get(cle) ?? tout);
      if (/\$\{/.test(resolu)) {
        if (peutIgnorer) irresolus.push(`${f} : ${resolu}`);
        continue;
      }
      noms.add(resolu);
    }
  }
  return { noms, irresolus };
}

test("chaque ligne de la liste des ignorés attendus nomme un cas qui existe", () => {
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const { noms, irresolus } = nomsDesCas(dossier);

  /* REFUS PLUTÔT QU'OUBLI : un gabarit non résolu retirerait un nom de la comparaison, et
     l'entrée correspondante passerait pour absente alors qu'elle est seulement illisible. */
  assert.deepEqual(irresolus, [],
    `${irresolus.length} nom(s) de cas construits que ce contrôle ne sait pas résoudre :\n  `
    + irresolus.join("\n  ")
    + "\n  Il les écarterait de la comparaison, et l'entrée de liste correspondante paraîtrait\n"
    + "  fausse alors qu'elle est seulement illisible ici.\n"
    + "  → poser la constante en littéral simple dans le même fichier, ou étendre la résolution.");

  /* TÉMOIN DE NON-VACUITÉ : sans lui, un extracteur cassé rendrait un ensemble vide et toute
     entrée paraîtrait fausse — ou, si l'on inversait le sens, aucune. */
  assert.ok(noms.size >= 400,
    `${noms.size} nom(s) de cas extraits : l'extraction a échoué, et la comparaison ci-dessous `
    + "porterait sur presque rien.");
  assert.ok(noms.has("chaque ligne de la liste des ignorés attendus nomme un cas qui existe"),
    "l'extracteur ne retrouve même pas ce cas-ci : il ne lit pas ce qu'il prétend lire.");

  const liste = fileURLToPath(new URL("../.github/cas-ignores-attendus.txt", import.meta.url));
  const attendus = readFileSync(liste, "utf8").split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  assert.ok(attendus.length >= 5,
    `${attendus.length} entrée(s) lue(s) dans la liste : la lecture a échoué.`);

  const fantomes = attendus.filter((a) => !noms.has(a));
  assert.deepEqual(fantomes, [],
    `${fantomes.length} entrée(s) de la liste ne nomment aucun cas de la suite :\n  `
    + fantomes.join("\n  ")
    + "\n  La porte compare l'ensemble EXACT des noms : sur le runner, celle-ci serait attendue\n"
    + "  et jamais vue, et le cas réel s'ignorerait sous un nom que rien n'attend — un rouge des\n"
    + "  deux côtés à la fois, après l'envoi.\n"
    + "  → recopier le nom EXACT tel que le lanceur l'écrit, gabarit résolu.");
});
