/**
 * LA LÉGENDE D'UNE FIGURE EST UNE AFFIRMATION MESURÉE, PAS UN TEXTE.
 *
 * `ui.html` annonçait « measured on 120 held-out records » sous une figure qui montre sept
 * paliers : quatre mesurés sur mille documents, trois sur cent vingt. Un seul dénominateur
 * pour deux populations, et c'était celui du plus petit.
 *
 * Le sens de l'erreur compte. Un lecteur qui calcule un intervalle depuis cette légende
 * l'obtient environ trois fois trop large sur quatre paliers sur sept, et conclut « ces
 * deux paliers ne sont pas séparables » sur une mesure qui les sépare — donc il garde le
 * palier cher. La légende faisait exactement l'inverse de ce que l'outil vend.
 *
 * Rien ne couvrait cette ligne : aucun cas du dépôt ne citait `figRoutageTitre` avant
 * celui-ci. L'étiquette d'accessibilité de la MÊME figure avait déjà porté un nombre de
 * paliers écrit à la main et faux, corrigé le 24 août 2026. Deux fois la même figure, deux
 * fois un chiffre tapé au lieu d'être dérivé.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIELDS } from "./corpus.ts";
import { TIERS } from "./paliers.ts";
import { readProfiles } from "./measure.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));

test("la légende de la figure de routage ne tape aucune taille d'échantillon", () => {
  const ui = readFileSync(racine + "src/ui.html", "utf8");

  /*
   * ON LIT L'ARGUMENT DE L'APPEL, PAS LE TEXTE DU GABARIT.
   *
   * Première version de ce cas : chercher un nombre collé à « held-out ». Elle passait au
   * VERT sur le défaut d'origine, qui s'écrivait `figRoutageTitre(nb(120))` — le 120 est
   * dans l'appel, le « held-out » dans le gabarit, et rien ne les met côte à côte. Un
   * témoin écrit dans la forme de la garde n'éprouve que la garde.
   *
   * On extrait donc l'argument de chaque appel, parenthèses équilibrées, et on refuse tout
   * littéral numérique. C'est le point exact où le défaut vivait.
   */
  const appels: string[] = [];
  const marque = "figRoutageTitre(";
  for (let k = ui.indexOf(marque); k !== -1; k = ui.indexOf(marque, k + 1)) {
    let profondeur = 1;
    let f = k + marque.length;
    while (f < ui.length && profondeur > 0) {
      if (ui[f] === "(") profondeur++;
      else if (ui[f] === ")") profondeur--;
      if (profondeur > 0) f++;
    }
    appels.push(ui.slice(k + marque.length, f));
  }
  assert.ok(appels.length >= 1,
    "aucun appel à figRoutageTitre dans ui.html : la figure a été renommée ou retirée, et "
    + "ce cas ne garde plus rien. Le relire avant de le croire vert.");

  const enDur = appels.filter((a) => /\d/.test(a));
  assert.deepEqual(enDur, [],
    `la légende reçoit ${enDur.join(", ")} — une taille d'échantillon écrite à la main. La `
    + "figure montre des paliers qui n'ont pas la même : un chiffre tapé est faux pour au "
    + "moins l'un d'eux. Le dériver de ce qui est affiché.");
});

test(`chaque palier a bien UNE taille d'échantillon, la même sur les ${FIELDS.length} champs`, () => {
  /* La page lit `items` du PREMIER champ et l'annonce pour le palier entier. Si un palier
     portait deux tailles selon le champ, cette lecture publierait la première comme si elle
     valait pour toutes — un chiffre juste par accident. */
  const p = readProfiles();
  assert.ok(p, "aucun relevé : ce cas ne peut rien mesurer et ne doit pas rendre vert");
  const incoherents: string[] = [];
  for (const e of TIERS) {
    const tailles = new Set(FIELDS.map((c) => p!.extraction[e][c]!.items));
    if (tailles.size !== 1) incoherents.push(`${e} : ${[...tailles].join(", ")}`);
  }
  assert.deepEqual(incoherents, [],
    `${incoherents.join(" | ")} — la page annonce une seule taille par palier, en lisant le `
    + "premier champ. Ces paliers-là en portent plusieurs, donc la légende publierait un "
    + "chiffre vrai pour un champ et faux pour les autres.");
});

test("le relevé porte bien PLUSIEURS tailles — sinon ce cas ne prouve rien", () => {
  /* LA DIRECTION QUI DÉCIDE. Si tous les paliers étaient mesurés sur le même nombre de
     documents, une légende à un seul chiffre serait juste et les deux cas ci-dessus
     passeraient sans rien garder. Ce cas rougit le jour où cette hypothèse tombe, et le
     message dit alors quoi relire plutôt que quoi corriger. */
  const p = readProfiles();
  assert.ok(p, "aucun relevé");
  const tailles = new Set(TIERS.map((e) => p!.extraction[e][FIELDS[0]!]!.items));
  assert.ok(tailles.size > 1,
    `les ${TIERS.length} paliers sont tous mesurés sur ${[...tailles][0]} documents. Un seul `
    + "chiffre dans la légende serait alors correct, et les deux cas ci-dessus ne gardent "
    + "plus rien : relire cette garde avant de la croire.");
});

test("la page construite dérive la légende au lieu de la porter figée", () => {
  const page = readFileSync(racine + "docs/index.html", "utf8");
  assert.match(page, /groupesEchantillons/,
    "docs/index.html ne contient pas la dérivation : la page publiée a été construite avant "
    + "cette correction, ou depuis une autre source. Lancer `npm run pages`.");
  assert.match(page, /echantillons:/,
    "l'état servi à la page ne porte pas les tailles d'échantillon, donc la légende dira "
    + "qu'elle ne les connaît pas — ce qui est honnête mais retire un chiffre que le lecteur "
    + "a besoin de lire.");
});
