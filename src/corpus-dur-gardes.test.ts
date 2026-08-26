import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lireFichier, corpusDur, CHAMPS } from "./corpus-dur.ts";

/*
 * LES REFUS DU LECTEUR DE CORPUS DUR.
 *
 * ─── POURQUOI CE FICHIER EXISTE ───
 *
 * Un balayage des gardes a retiré ces refus un par un : aucun cas ne bougeait. Six survivants
 * dans un seul fichier — et une concentration pareille ne décrit pas des oublis épars, elle
 * désigne un fichier que rien n'exerce.
 *
 * Ce qu'ils gardent n'est pas mince. `corpus-dur/` est écrit À LA MAIN, et c'est la vérité de
 * référence sur laquelle des taux publiés sont calculés. Un corpus mal écrit qui passe en
 * silence — une clé en double, un cas sans document, un champ absent — ne fait pas tomber la
 * mesure : il la DÉCALE. C'est la pire des deux issues, parce que le chiffre sort quand même.
 *
 * ─── CE QU'ILS N'ÉPROUVENT PAS ───
 *
 * La ligne 81, « cellule vide non reconnue », est INATTEIGNABLE : vérifié par force brute, le
 * vide est capté plus haut et toute chaîne trimée non vide rend au moins une lecture. Elle est
 * déclarée `survivant:ok` dans la source avec sa raison. Lui écrire un témoin rendrait un vert
 * qui ne regarde rien — c'est précisément ce que ce fichier existe pour éviter.
 */

const ENTETE = "# fixture\n\n";

/** Un cas complet et valide, dont chaque témoin ne casse qu'une chose. */
function casValide(id: string, texte = "Client: Anna Petrova", table?: string): string {
  const lignes = Object.keys(CHAMPS).map((nom) => `|${nom}|Anna Petrova|`);
  return `### ${id} — un cas\n\n\`\`\`\n${texte}\n\`\`\`\n\n${table ?? lignes.join("\n")}\n`;
}

function dossierAvec(fichiers: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "corpus-dur-"));
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(d, nom), contenu);
  return d;
}

test("le corpus témoin passe — sans lui, tout refus ci-dessous serait ambigu", () => {
  /*
   * LE CONTRÔLE POSITIF, ET IL EST OBLIGATOIRE ICI. Chaque cas ci-dessous affirme qu'une
   * entrée fautive est refusée. Si la fixture était mal formée par construction, ils
   * passeraient tous en refusant pour une raison qui n'est pas celle qu'ils nomment.
   */
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1") });
  try {
    const cas = corpusDur(d);
    assert.equal(cas.length, 1, "le corpus témoin doit livrer exactement son cas.");
    assert.equal(cas[0]!.id, "MD1");
    assert.equal(cas[0]!.texte.trim(), "Client: Anna Petrova");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("une barre nue mêlée à un séparateur est refusée, en nommant fichier et ligne", () => {
  /*
   * « 3/4/1990 / 4 March 1990 » : le premier est une valeur qui contient des barres, le second
   * un séparateur de lectures. Les confondre transformerait UNE lecture en trois, et le cas
   * compterait juste sur une réponse que personne n'a écrite.
   */
  const table = Object.keys(CHAMPS)
    .map((nom, i) => i === 0 ? `|${nom}|3/4/1990 / 4 March 1990|` : `|${nom}|Anna|`).join("\n");
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1", "Doc", table) });
  try {
    assert.throws(() => corpusDur(d), (e: Error) => {
      assert.match(e.message, /mêle une barre nue et un séparateur/);
      assert.match(e.message, /documents-malformes\.md:\d+/,
        "le refus doit nommer le fichier ET la ligne : un corpus écrit à la main se corrige "
        + "à la ligne, pas au fichier.");
      return true;
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("un balisage non interprété est refusé plutôt que pris pour une valeur", () => {
  /*
   * `**REFUSE**` et `*(not stated)*` ont un sens pour ce lecteur. Une cellule qui porte des
   * astérisques SANS être l'une de ces deux formes est une intention que personne n'a
   * traduite — la prendre au pied de la lettre ferait d'un balisage une réponse attendue.
   */
  const table = Object.keys(CHAMPS)
    .map((nom, i) => i === 0 ? `|${nom}|**probablement** Anna|` : `|${nom}|Anna|`).join("\n");
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1", "Doc", table) });
  try {
    assert.throws(() => corpusDur(d), /porte un balisage non interprété/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("deux cas ne peuvent pas partager une clé, et le refus nomme les deux sources", () => {
  /*
   * LA COLLISION SILENCIEUSE EST CHIFFRÉE. Deux cas de même clé : le second écrase le premier
   * dans toute table indexée par clé, et le taux publié porte alors sur un corpus plus petit
   * que celui qu'on annonce — sans qu'aucune ligne ne manque à l'œil.
   */
  const d = dossierAvec({
    "documents-malformes.md": ENTETE + casValide("MD1") + "\n" + casValide("MD1", "Autre"),
  });
  try {
    assert.throws(() => corpusDur(d), (e: Error) => {
      assert.match(e.message, /la clé documents-malformes#MD1 désigne deux cas/);
      return true;
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("un cas sans document est refusé — il compterait comme une réponse manquée", () => {
  const sansTexte = `### MD1 — un cas\n\n`
    + Object.keys(CHAMPS).map((nom) => `|${nom}|Anna|`).join("\n") + "\n";
  const d = dossierAvec({ "documents-malformes.md": ENTETE + sansTexte });
  try {
    assert.throws(() => corpusDur(d), /MD1 : aucun document lu/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("un champ absent est refusé, et le refus dit LEQUEL", () => {
  /*
   * Le champ absent est le plus dangereux des trois : la mesure tourne, le cas existe, et le
   * champ manquant est simplement compté nulle part. Un dénominateur qui rétrécit en silence
   * améliore tous les taux qui le divisent.
   */
  const table = Object.keys(CHAMPS).slice(0, -1).map((nom) => `|${nom}|Anna|`).join("\n");
  const manquant = CHAMPS[Object.keys(CHAMPS).at(-1)!];
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1", "Doc", table) });
  try {
    assert.throws(() => corpusDur(d), (e: Error) => {
      assert.match(e.message, /champs absents/);
      assert.ok(e.message.includes(manquant!),
        `le refus doit nommer « ${manquant} », sinon il envoie relire cinq colonnes.`);
      return true;
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("lireFichier lit bien le dossier qu'on lui donne, pas le dossier du dépôt", () => {
  /*
   * LA COUTURE ELLE-MÊME. Si le paramètre était ignoré, les six cas ci-dessus liraient le vrai
   * corpus — qui est valide — et passeraient tous sans rien refuser. Ils annonceraient une
   * couverture entièrement fausse, et c'est le genre de vert qui ne se remarque jamais.
   */
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("ZZ9", "Un texte unique") });
  try {
    const cas = lireFichier("documents-malformes.md", d);
    assert.equal(cas.length, 1);
    assert.equal(cas[0]!.id, "ZZ9", "le dossier passé doit être celui qui est lu.");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("le marqueur *accepted:* est interprété, jamais noté tel quel", () => {
  /*
   * Le format du fichier le documente (« Grade the accepted alternatives as stated ») et le
   * lecteur ne l'interprétait pas : 13 clés de notation portaient « *accepted:* carte… » et un
   * palier rendant la complétion déclarée correcte était noté FAUX. Les taux publiés du corpus
   * dur sous-notaient chaque palier sur le champ document. Audit du 27 août 2026.
   */
  const table = [
    "|full name|Anna Petrova|",
    "|date of birth|3 May 1990|",
    "|document type|CARTE NATIONALE D'IDENTIT|*accepted:* carte nationale d'identité / national identity card|",
    "|country|Bulgaria|",
    "|address|1 rue de la Paix|",
  ].join("\n");
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1", "Client: Anna Petrova", table) });
  const cas = lireFichier("documents-malformes.md", d);
  /* Les clés d'attendus sont les noms COURTS des champs (`document`), pas les intitulés du
     tableau — vérifié en lisant la sortie réelle plutôt qu'en la supposant. */
  const doc = cas[0]!.attendus["document"]!;
  assert.deepEqual(doc.lectures,
    ["CARTE NATIONALE D'IDENTIT", "carte nationale d'identité", "national identity card"],
    `la clé de notation porte encore le marqueur, ou perd une alternative : ${JSON.stringify(doc.lectures)}\n`
    + "  Un palier rendant « carte nationale d'identité » — déclarée correcte par le format —\n"
    + "  serait noté faux, et les taux publiés sous-noteraient ce palier.");
});

test("un marqueur *mot:* NON interprété refuse — la promesse est « refuse plutôt qu'ignorer »", () => {
  /* CONTRE-ÉPREUVE de l'interprétation : si demain quelqu'un écrit `*note:*` dans une cellule,
     le lecteur ne doit pas l'avaler en silence comme il avalait `*accepted:*` pendant des
     semaines. L'astérisque simple contournait la garde `**`/`*(`. */
  const table = [
    "|full name|Anna Petrova|",
    "|date of birth|3 May 1990|",
    "|document type|PASSPORT|*note:* à revoir|",
    "|country|Bulgaria|",
    "|address|1 rue de la Paix|",
  ].join("\n");
  const d = dossierAvec({ "documents-malformes.md": ENTETE + casValide("MD1", "Client: Anna Petrova", table) });
  assert.throws(() => lireFichier("documents-malformes.md", d), /balisage non interprété/,
    "un marqueur inconnu est entré dans une clé de notation sans un mot : la prochaine\n"
    + "  pollution des taux publiés durera aussi longtemps que la première.");
});
