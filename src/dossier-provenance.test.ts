/*
 * DEUX FOIS LA MÊME GRANDEUR, DEUX SOURCES — ET UN CHIFFRE QUE PERSONNE NE PEUT VÉRIFIER.
 *
 * `VALIDATION.md` est engendré. Deux défauts y vivaient côte à côte, tous deux invisibles
 * tant que rien ne bougeait :
 *
 *   · le montant « for the whole routing » s'écrivait `${Math.round(191)}` — un littéral
 *     enveloppé dans un arrondi, posé entre deux montants réellement dérivés, ce qui lui
 *     donnait leur allure. Vingt lignes plus bas, la MÊME grandeur s'écrivait
 *     `${euro(s.cost)}`, dérivée du relevé. Les deux rendaient `$191`. Le jour où `s.cost`
 *     bouge, une ligne suit, l'autre reste, et `dossier.ts --check` fige la contradiction
 *     comme référence — c'est un mensonge à retardement, pas une coquille.
 *
 *   · deux latences étaient tapées à la main avec un commentaire « mesuré sur l'OFAC ».
 *     Un commentaire n'est pas une provenance : rien ne le relie à un relevé, et rien ne
 *     tombe s'il devient faux. Le relevé scellé livré ici porte 18–22 ms et 43–48 ms ;
 *     aucune des deux valeurs tapées n'y correspond.
 *
 * Ces cas éprouvent la STRUCTURE, pas les valeurs : déplacer un montant publié est une
 * décision commerciale, et elle ne se prend pas dans un correctif.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dossier } from "./dossier.ts";
import { readProfiles } from "./measure.ts";
import { ASSUMPTIONS } from "./assumptions.ts";

/*
 * SANS LES COMMENTAIRES — et ce cas me l'a appris en tombant.
 *
 * Ma première version cherchait `Math.round(<littéral>)` dans le fichier entier. Elle a
 * rougi sur le commentaire que je venais d'écrire pour EXPLIQUER le défaut, qui le cite
 * verbatim. Accuser une citation, c'est accuser le témoin d'être ce qu'il éprouve.
 */
const source = () =>
  readFileSync(fileURLToPath(new URL("./dossier.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/.*$/gm, " ");

/** Le montant qui suit un `$`, dans la phrase demandée. */
function montant(texte: string, apres: RegExp): string | null {
  const l = texte.split("\n").find((x) => apres.test(x));
  return l ? (l.match(/\$[\d  ,.]+/)?.[0].trim() ?? null) : null;
}

test("les deux montants du routage viennent de la même source", () => {
  const texte = dossier(readProfiles()!, ASSUMPTIONS);

  const ici = montant(texte, /for the whole routing/);
  const la = montant(texte, /^Overall:/);

  /* Témoin de non-vacuité : comparer deux absents passerait sans rien garder. */
  assert.ok(ici, "la phrase « for the whole routing » a disparu : ce cas ne garde plus rien.");
  assert.ok(la, "la ligne « Overall: » a disparu : ce cas ne garde plus rien.");

  assert.equal(ici, la,
    `le même montant s'écrit « ${ici} » à un endroit et « ${la} » à l'autre.\n`
    + "  Une grandeur publiée depuis deux sources diverge le jour où l'une des deux bouge,\n"
    + "  et `--check` fige alors la contradiction comme référence.");
});

test("aucun littéral ne se déguise en calcul pour ce montant", () => {
  const src = source();
  assert.ok(!/Math\.round\(\s*\d+\s*\)/.test(src),
    "`Math.round(<littéral>)` est de retour : un nombre tapé qui prend l'allure d'un calcul\n"
    + "  parce qu'il est posé à côté de vrais calculs. C'est le défaut d'origine.");
  assert.match(src, /for the whole routing\.`\)/,
    "la phrase visée n'existe plus sous cette forme : ce cas ne garde plus ce qu'il croit.");
});

test("une latence non dérivable porte sa provenance dans le code, et la dit au lecteur", () => {
  const src = source();

  /* La provenance est une DONNÉE — datée, nommée, et marquée non dérivable — et non un
     commentaire à côté du chiffre. Un commentaire ne tombe jamais. */
  assert.match(src, /derivableIci:\s*false/,
    "la marque « non dérivable ici » a disparu : un chiffre qu'aucun relevé du dépôt ne\n"
    + "  porte redeviendrait indiscernable d'un chiffre mesuré.");
  assert.match(src, /corpusAbsent:\s*"[^"]+"/,
    "ce qui MANQUE pour re-dériver doit être nommé : « non dérivable » seul ne dit pas quoi faire,\n"
    + "  et une hypothèse gelée dont personne ne sait ce qui la dégèlerait est une hypothèse\n"
    + "  abandonnée.");
  assert.match(src, /geleeLe:\s*"\d{4}-\d{2}-\d{2}"/, "et la date du gel, pas celle d'une mesure.");

  /* Le commentaire qui affirmait une mesure ne doit pas revenir : c'était lui, le mensonge. */
  assert.ok(!/\/\*[^*]*mesuré sur l'OFAC[^*]*\*\//.test(
    readFileSync(fileURLToPath(new URL("./dossier.ts", import.meta.url)), "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, " ")),
    "« mesuré sur l'OFAC » est de retour à côté du chiffre : une affirmation de mesure que\n"
    + "  rien dans le dépôt ne soutient.");

  /* Et la réserve VOYAGE : une réserve qui reste dans le code n'existe pas pour le lecteur. */
  const texte = dossier(readProfiles()!, ASSUMPTIONS);
  assert.match(texte, /not re-measurable from this repository/,
    "le document ne dit plus au lecteur lesquels de ses chiffres il ne peut pas vérifier.");
  assert.match(texte, /frozen assumption, not a measurement/,
    "le document doit dire que c'est une hypothèse GELÉE, pas une mesure — c'est la\n"
    + "  différence exacte entre montrer la limite et la laisser découvrir.");
});

/*
 * LE DOCUMENT DISPENSÉ DU CLIQUET, ET LES SIX TAUX TAPÉS QU'IL PORTAIT.
 *
 * `cascade.test.ts` refuse qu'un taux de plus soit tapé dans la prose des `.md`, et il
 * DISPENSE `VALIDATION.md` et `SONDE.md` : « aucun n'est tapé, ils naissent du relevé à
 * chaque `npm run` ». La phrase était fausse. La table OFAC portait quatre colonnes dont
 * deux arrivaient en chaînes littérales — six taux — sous un commentaire qui affirmait
 * l'inverse en capitales.
 *
 * Ce que l'exemption promettait, `--check` ne peut pas le tenir : il compare le fichier à
 * la sortie du générateur, laquelle rend les mêmes littéraux. Il éprouve une TRANSCRIPTION,
 * jamais une mesure. Un taux tapé dans le générateur est aussi mort qu'un taux tapé dans le
 * document — il est seulement plus difficile à voir.
 *
 * Ça avait déjà coûté une phrase fausse au lecteur, et elle contredisait la table imprimée
 * trois lignes au-dessus : « they do not answer at all: 0, 15 and 24 values returned »,
 * quand les règles rendent 290, 198 et 259 valeurs sur ce même CSV. Un taux de 100,0 % sur
 * n=290 est incompatible avec « zéro valeur rendue » ; personne ne l'a vu parce que rien ne
 * regardait ce fichier.
 */

/** Ce qui a le droit de porter un taux littéral dans un générateur, et pourquoi. */
const PERMIS: { fichier: string; extrait: string; raison: string }[] = [
  { fichier: "dossier.ts", extrait: "Wald leaves [0, 1] near 0 % or 100 %",
    raison: "phrase sur la forme de l'intervalle, aucune mesure citée" },
  { fichier: "dossier.ts", extrait: "0 of 20 gives [0 – 16.1 %]",
    raison: "les deux bornes Wilson publiées, tenues par precision() dans interval.test.ts" },
  { fichier: "dossier.ts", extrait: '"95 % interval"',
    raison: "l'en-tête d'une colonne, pas un chiffre mesuré" },
  { fichier: "dossier.ts", extrait: "scored the hand-written rules at 100 % on all five fields",
    raison: "récit d'un incident révolu : le remesurer n'aurait pas de sens" },
  { fichier: "dossier.ts", extrait: 'birth: "96.7 %"',
    raison: "colonne OFAC/large, gelée : voir OFAC_LARGE_MESURE_LE et sa raison" },
  { fichier: "dossier.ts", extrait: 'document: "35.3 %"', raison: "idem" },
  { fichier: "dossier.ts", extrait: 'country: "85.3 %"', raison: "idem" },
  { fichier: "sonde.ts", extrait: "Every rate with its 95 % interval",
    raison: "l'en-tête d'une colonne, pas un chiffre mesuré" },
  { fichier: "sonde.ts", extrait: "These move by 20–30 % between runs",
    raison: "réserve sur la variabilité entre passes, pas un taux publié" },
];

test("aucun taux ne se tape dans un générateur de document engendré", () => {
  const sansCommentaires = (f: string) =>
    readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(?<!:)\/\/.*$/gm, " ");

  /*
   * LA LISTE VIENT DE L'EXEMPTION, PAS DE MA MÉMOIRE.
   *
   * Recopier « dossier.ts, sonde.ts » ici, c'est promettre de fouiller les générateurs des
   * documents dispensés tout en regardant une AUTRE collection — celle que j'avais en tête
   * le jour où j'ai écrit le cas. Un document ajouté à `ENGENDRES` demain serait dispensé
   * du cliquet et jamais fouillé, et rien ne le dirait.
   *
   * Elle se LIT dans la source de `cascade.test.ts` plutôt que de s'importer : importer un
   * fichier de cas y enregistre tous ses cas une seconde fois, et un dépôt qui compte ses
   * cas se mettrait à en compter deux fois les mêmes.
   */
  const tableau = readFileSync(fileURLToPath(new URL("./cascade.test.ts", import.meta.url)), "utf8")
    .match(/const ENGENDRES[^{]*\{([^}]*)\}/)?.[1] ?? "";
  const generateurs = [...tableau.matchAll(/src\/(\S+?\.ts)/g)].map((m) => m[1]!);
  assert.ok(generateurs.length >= 2 && generateurs.every(Boolean),
    `« ${generateurs.join(", ")} » : une commande d'ENGENDRES ne nomme plus son générateur,\n`
    + "  donc ce cliquet fouillerait moins de fichiers qu'il n'y a de documents dispensés.");

  const trouves: string[] = [];
  const couverts = new Set<number>();
  for (const f of generateurs) {
    sansCommentaires(f).split("\n").forEach((l, i) => {
      if (!/\d+(?:[.,]\d+)?\s*%/.test(l)) return;
      const j = PERMIS.findIndex((p) => p.fichier === f && l.includes(p.extrait));
      if (j >= 0) { couverts.add(j); return; }
      trouves.push(`${f}:${i + 1}  ${l.trim()}`);
    });
  }

  /*
   * TÉMOIN DE NON-VACUITÉ. Si le motif cesse de reconnaître un taux, ce cas passerait au
   * vert sans rien regarder — exactement la panne qu'il est censé rendre impossible.
   */
  assert.ok(couverts.size >= 5,
    `le relevé ne reconnaît plus que ${couverts.size} des taux déclarés permis : c'est le\n`
    + "  motif qui est cassé, pas le code. Un cliquet qui ne voit rien ne garde rien.");

  assert.deepEqual(trouves, [],
    "un taux est tapé dans un générateur, et le document qu'il écrit est DISPENSÉ du cliquet\n"
    + "  des taux tapés (voir ENGENDRES dans cascade.test.ts). `--check` ne peut pas le\n"
    + "  rattraper : il compare le fichier à la sortie du générateur, donc aux mêmes littéraux.\n"
    + "  → dérivez-le du relevé, ou inscrivez-le dans PERMIS avec la raison qui le fige.");
});

test("la colonne « ce corpus » de la table OFAC vient du relevé, pas d'une chaîne", () => {
  /*
   * CE CAS N'ÉPROUVE PAS LE DÉFAUT D'ORIGINE, ET IL FAUT LE DIRE.
   *
   * Remis dans l'état d'avant le correctif, il passe au VERT : les trois chaînes tapées
   * valaient exactement ce que le relevé livré donne aujourd'hui. Un document juste par
   * hasard est indiscernable d'un document juste par construction — c'est la phrase que ce
   * dépôt s'écrit déjà à propos de `--check`, et elle vaut ici. Ce cas ne garde donc pas le
   * passé : il attrape la DÉRIVE, le jour où le relevé bouge. Ce qui éprouve le défaut lui-même
   * est le cliquet ci-dessus.
   */
  const p = readProfiles()!;
  const texte = dossier(p, ASSUMPTIONS);

  let vus = 0;
  for (const champ of ["birth", "document", "country"] as const) {
    const l = texte.split("\n").find((x) => x.startsWith(`| \`${champ}\` |`));
    if (!l) continue;
    const cellules = l.split("|").map((c) => c.trim());
    const q = p.extraction["rules"][champ];
    const attendu = (100 * (Math.round(q.accuracy * q.items) / q.items)).toFixed(1) + " %";
    assert.equal(cellules[2], attendu,
      `la table publie « ${cellules[2]} » pour \`${champ}\` là où le relevé donne ${attendu}.`);
    vus++;
  }
  assert.equal(vus, 3, "les trois lignes de la table OFAC ont disparu : ce cas ne garde plus rien.");
});

test("le document ne peut pas se contredire sur ce que les règles rendent", () => {
  const texte = dossier(readProfiles()!, ASSUMPTIONS);

  /*
   * ON NE PEUT PAS AVOIR RAISON PLUS SOUVENT QU'ON NE RÉPOND.
   *
   * C'est l'invariant que la phrase supprimée violait : « 0 valeur rendue » sous une
   * cellule à 100,0 % de n=290. Il ne cite aucun chiffre, donc il survit à une remesure,
   * et il rougit sur toute prose qui recommencerait à raconter autre chose que la table.
   */
  /* On cherche la PHRASE, pas sa formulation : sinon le cas rougit parce que le texte a
     changé, ce qui se lit comme un défaut là où il n'y en a pas — et, pire, il resterait
     muet sur une autre phrase qui raconterait la même chose autrement. */
  const l = texte.split("\n").find((x) => /values returned/.test(x));
  assert.ok(l, "aucune phrase ne dit plus ce que les règles rendent : ce cas ne garde plus rien.");
  const rendus = (l!.match(/(\d+),\s*(\d+)\s*(?:,|and)\s*(\d+)/) ?? []).slice(1).map(Number);
  /* Le compte vit dans UNE constante que l'assertion et le message lisent tous les deux :
     écrit deux fois, il finit par diverger — et c'est le message qui ment, au moment où
     quelqu'un cherche une cause. */
  const ATTENDUS = 3;
  assert.equal(rendus.length, ATTENDUS, `« ${l} » ne porte plus ${ATTENDUS} nombres.`);

  const champs = ["birth", "document", "country"] as const;
  champs.forEach((champ, i) => {
    const ligne = texte.split("\n").find((x) => x.startsWith(`| \`${champ}\` |`))!;
    const c = ligne.split("|").map((x) => x.trim());
    const taux = Number(c[3]!.replace(/[^\d.]/g, "").replace(/^(\d+\.\d)\d*$/, "$1"));
    const n = Number(c[3]!.match(/n=(\d+)/)?.[1] ?? 0);
    assert.ok(n > 0, `la cellule OFAC de \`${champ}\` ne porte plus son échantillon.`);
    const justes = Math.round((taux / 100) * n);
    assert.ok(rendus[i]! >= justes,
      `le document dit que \`${champ}\` rend ${rendus[i]} valeurs et qu'il en a ${justes} de\n`
      + `  justes sur ${n}. On ne peut pas avoir raison plus souvent qu'on ne répond : l'une des\n`
      + "  deux phrases ne vient pas de la mesure.");
  });

  assert.ok(!/do not answer at all/.test(texte),
    "« they do not answer at all » est de retour : mesuré sur le CSV livré, les règles\n"
    + "  rendent des comptes différents sur ce même CSV.");
});
