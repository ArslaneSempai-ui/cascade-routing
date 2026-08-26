/**
 * LA DÉTECTION DU POINT D'ENTRÉE EST ÉCRITE SEPT FOIS, ET UNE HUITIÈME PEUT ÊTRE FAUSSE.
 *
 * `cli.ts` exporte `isMain()`. Sept fichiers réimplémentent la même chose à côté — et,
 * relevé le 26 août 2026, LES SEPT SONT CORRECTS : forme `pathToFileURL`, `argv[1]` gardé.
 * Il n'y a donc rien à corriger aujourd'hui, et ce fichier ne corrige rien.
 *
 * Ce qu'il empêche est la huitième. La forme fausse est celle qui vient naturellement :
 *
 *     import.meta.url === "file://" + process.argv[1]
 *
 * Elle compare une URL à un chemin. Les deux coïncident tant que le chemin ne porte ni
 * espace ni accent ; dès qu'il en porte un, la comparaison échoue et le programme se
 * termine SANS RIEN FAIRE, en code 0. `menace.test.ts:245` a mesuré exactement ça sur un
 * dossier temporaire de macOS : trois cas au vert sur un balayage qui n'avait pas eu lieu.
 *
 * Deuxième forme fausse, plus discrète : `pathToFileURL(process.argv[1])` sans garde.
 * `argv[1]` est absent sous `node --eval`, et `pathToFileURL(undefined)` LÈVE
 * — vérifié : ERR_INVALID_ARG_TYPE. Un module importé depuis un `-e` casse alors à
 * l'import, avant d'avoir rien fait.
 *
 * Aucune liste d'exceptions ici. Une garde qui commence par sept dérogations ne garde
 * rien ; celle-ci refuse deux formes que zéro fichier emploie, donc chaque rouge qu'elle
 * rendra sera neuf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));

/* Les lignes de CODE d'un fichier : ni commentaire de bloc, ni commentaire de ligne.
   Sans ce filtrage, les cinq fichiers qui EXPLIQUENT la forme fausse dans leur en-tête
   seraient dénoncés pour l'avoir citée — je m'y suis fait prendre en la cherchant. */
function lignesDeCode(source: string): { n: number; texte: string }[] {
  const sorties: { n: number; texte: string }[] = [];
  let dansBloc = false;
  source.split("\n").forEach((brute, i) => {
    let t = brute;
    if (dansBloc) {
      const fin = t.indexOf("*/");
      if (fin === -1) return;
      t = t.slice(fin + 2);
      dansBloc = false;
    }
    for (;;) {
      const debut = t.indexOf("/*");
      if (debut === -1) break;
      const fin = t.indexOf("*/", debut + 2);
      if (fin === -1) { t = t.slice(0, debut); dansBloc = true; break; }
      t = t.slice(0, debut) + t.slice(fin + 2);
    }
    /* UN `//` PRÉCÉDÉ DE `:` EST UNE URL, PAS UN COMMENTAIRE — et c'est précisément la
       forme que ce fichier traque. La première écriture coupait la ligne à "file://", donc
       `argv` disparaissait avec le reste et la forme fausse passait au VERT. Le témoin l'a
       montré : la garde ne voyait pas le défaut qu'elle décrivait. */
    const ligne = t.replace(/(^|[^:])\/\/.*$/, "$1");
    if (ligne.trim()) sorties.push({ n: i + 1, texte: ligne });
  });
  return sorties;
}

function sources(): { nom: string; code: { n: number; texte: string }[] }[] {
  return readdirSync(racine + "src")
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".mjs")) && !f.includes(".test."))
    .map((nom) => ({ nom, code: lignesDeCode(readFileSync(racine + "src/" + nom, "utf8")) }));
}

test("aucun fichier ne compare import.meta.url à un chemin brut", () => {
  const fautifs: string[] = [];
  for (const { nom, code } of sources()) {
    for (const { n, texte } of code) {
      if (!texte.includes("import.meta.url")) continue;
      /* La forme fausse colle "file://" à argv[1], par concaténation ou par gabarit. La
         forme juste passe par pathToFileURL, qui échappe. */
      if (/file:\/\/(?!.*pathToFileURL)/.test(texte) && /argv/.test(texte)) {
        fautifs.push(`${nom}:${n}`);
      }
    }
  }
  assert.deepEqual(fautifs, [],
    `${fautifs.join(", ")} compare import.meta.url à "file://" + un chemin. Les deux `
    + "coïncident tant que le chemin ne porte ni espace ni accent ; dès qu'il en porte un, "
    + "la comparaison échoue et le programme se termine sans rien faire, en code 0. "
    + "Employer isMain(import.meta) de cli.ts, ou pathToFileURL si le fichier doit rester "
    + "autonome.");
});

test("toute détection d'entrée garde process.argv[1] avant de le convertir", () => {
  const nus: string[] = [];
  for (const { nom, code } of sources()) {
    code.forEach(({ n, texte }, i) => {
      if (!/pathToFileURL\(/.test(texte) || !texte.includes("import.meta.url")) return;
      /* La garde est soit sur la ligne même — `a !== undefined &&` — soit juste au-dessus.
         Trois lignes de fenêtre : les sept écritures du dépôt tiennent en deux. */
      const fenetre = [texte, ...code.slice(Math.max(0, i - 3), i).map((l) => l.texte)].join("\n");
      if (!/!==\s*undefined|if\s*\(\s*!/.test(fenetre)) nus.push(`${nom}:${n}`);
    });
  }
  assert.deepEqual(nus, [],
    `${nus.join(", ")} convertit process.argv[1] sans l'avoir gardé. Il est absent sous `
    + "`node --eval`, et pathToFileURL(undefined) lève ERR_INVALID_ARG_TYPE : le module "
    + "casserait à l'import, avant d'avoir rien fait.");
});

test("les deux cas ci-dessus ont bien quelque chose à examiner", () => {
  /*
   * LA DIRECTION QUI DÉCIDE, ET ELLE COMPTE DEUX POPULATIONS PARCE QU'IL Y EN A DEUX.
   *
   * Les deux cas ci-dessus n'examinent que les détections ÉCRITES SUR PLACE. Un fichier qui
   * appelle `isMain(import.meta)` ne les concerne pas : il n'y a plus de forme à se tromper.
   *
   * Ce cas a rougi le jour où quatre modules sont passés à `isMain` — le compte est tombé de
   * sept à trois. C'était son travail, et le geste correct n'était pas de baisser le seuil
   * pour faire passer mon propre changement : c'était de compter séparément ce que les deux
   * premiers cas gardent, et ce qui prouve que le filtre à commentaires n'avale pas le code.
   */
  const locales = sources().filter(({ code }) =>
    code.some(({ texte }) => texte.includes("import.meta.url") && /pathToFileURL/.test(texte)));
  const parIsMain = sources().filter(({ code }) =>
    code.some(({ texte }) => /isMain\(\s*import\.meta/.test(texte)));

  assert.ok(locales.length >= 1,
    "plus aucun fichier n'écrit sa propre détection : les deux cas ci-dessus ne gardent plus "
    + "rien et passeraient sur n'importe quoi. Soit tout est passé derrière isMain — auquel "
    + "cas les retirer plutôt que les laisser rassurer — soit le filtre à commentaires avale "
    + "du code.");

  /* Le total, lui, ne dépend pas de la répartition entre les deux formes : il ne peut tomber
     que si le dépôt cesse de détecter ses points d'entrée, ou si le filtre mange le code. */
  const total = new Set([...locales, ...parIsMain].map((f) => f.nom)).size;
  assert.ok(total >= 5,
    `seulement ${total} fichier(s) détectent leur point d'entrée, sous une forme ou l'autre. `
    + `Il y en avait sept le 26 août 2026 (${locales.length} sur place, ${parIsMain.length} `
    + "par isMain). Un effondrement de ce compte veut dire que le filtre à commentaires "
    + "mange du code, et que les deux cas ci-dessus examinent le vide.");
});
