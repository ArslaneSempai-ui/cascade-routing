/*
 * LES RÈGLES DE FORME, TENUES PAR UNE MACHINE.
 *
 * Quatre règles de design revenaient de rejet en rejet et vivaient dans une mémoire : la
 * couleur ne porte jamais seule, pas d'encadré teinté sous une figure, une figure-commande
 * porte son nom accessible, et aucune commande n'est morte. Une règle qui vit dans une
 * mémoire ne se déclenche que si on se la rappelle au bon moment — ce qui veut dire un jour
 * sur deux.
 *
 * Ce fichier tient les deux qui se vérifient sur les sources. Les deux autres se vérifient
 * sur la page rendue, et vivent donc dans `verifier-ecran.mjs`, qui l'ouvre déjà.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const css = () => readFileSync(racine + "src/registre.css", "utf8");
const graphes = () => readFileSync(racine + "src/graphes.js", "utf8");

/** Le corps d'une règle CSS, pour un sélecteur donné exactement. */
function bloc(feuille: string, selecteur: string): string | null {
  const m = feuille.match(new RegExp(`(^|\\n)\\s*${selecteur.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`));
  return m ? m[2]! : null;
}

test("l'explication sous une figure n'est pas un encadré teinté", () => {
  /*
   * L'admonition box — fond coloré, gros filet vertical à gauche — est le marqueur le plus
   * reconnaissable d'une interface générée, et elle a été rejetée sur les sept écrans le
   * 18 août 2026. Elle revient toute seule dès qu'on écrit une classe d'explication sans y
   * penser : le test la refuse à la source.
   */
  const feuille = css();
  for (const classe of [".renvoi", ".suite"]) {
    const corps = bloc(feuille, classe);
    assert.ok(corps, `${classe} n'existe plus dans le registre`);
    assert.match(corps!, /background:\s*none/,
      `${classe} doit déclarer un fond nul, sinon un encadré teinté peut revenir`);
    assert.match(corps!, /border:\s*0/,
      `${classe} doit déclarer une bordure nulle : le filet vertical est la moitié du motif`);
    assert.doesNotMatch(corps!, /border-left\s*:\s*[1-9]/,
      `${classe} porte un filet à gauche`);
    assert.doesNotMatch(corps!, /background(-color)?\s*:\s*(?!none)(var|#|rgb)/,
      `${classe} porte un fond coloré`);
  }
});

test("aucune bande disqualifiée ne repose sur sa seule couleur", () => {
  /*
   * Vert ne veut pas dire « bien » partout — sur les marchés chinois et japonais le rouge
   * est la hausse — et huit pour cent des hommes ne distinguent pas les deux verts. Toute
   * zone qui signifie quelque chose porte donc une trame et un mot écrit ; la couleur ne
   * fait que renforcer ce qui se lit déjà sans elle.
   *
   * Le contrôle est mécanique : partout où `graphes.js` dessine une bande, il dessine aussi
   * une hachure et pose une étiquette.
   */
  const source = graphes();
  const i = source.indexOf('class="bande ');
  assert.ok(i > 0, "plus aucune bande dans la couche partagée : le test ne garde plus rien");
  const apres = source.slice(i, i + 900);
  assert.match(apres, /class="hachure"/,
    "une bande est dessinée sans sa trame : elle ne se lirait plus en niveaux de gris");
  assert.match(apres, /class="etiq-bande"/,
    "une bande est dessinée sans son intitulé : la couleur porterait seule");

  /* Et la légende d'un histogramme porte un mot par clé, jamais une pastille seule. */
  const legende = source.slice(source.indexOf("cle-hist"), source.indexOf("cle-hist") + 400);
  assert.match(legende, /ech\(c\.texte\)/,
    "une clé de légende sans texte : la pastille porterait seule");
});

test("les couches partagées sont bien celles d'identite", (t) => {
  /*
   * Ces règles ne valent que si le fichier contrôlé est celui que l'écran sert. Une copie
   * oubliée dans un dépôt est un contrôle qui passe au vert sur un fichier que personne ne
   * regarde — c'est déjà arrivé avec la démo du RAG, deux versions en retard.
   */
  const source = fileURLToPath(new URL("../../identite/", import.meta.url));
  if (!existsSync(source + "registre.css")) return t.skip("!existsSync(source + 'registre.css') — ce cas n'a rien regardé, et il le dit."); // dépôt cloné seul : rien à comparer

  /*
   * LA LISTE VIENT DU DISQUE, PAS D'ICI.
   *
   * Elle a longtemps tenu en deux noms — `registre.css` et `graphes.js` — écrits à la main.
   * Or ce dépôt porte QUINZE fichiers du même nom qu'identite, et les deux qui avaient
   * réellement pourri, `capturer.mjs` et `verifier-ecran.mjs`, étaient précisément hors de la
   * liste : 436 et 220 lignes de retard, sans qu'un seul contrôle s'en aperçoive. L'un
   * comptait les figures d'un écran au lieu de les inspecter, et disait « vérifié » sur une
   * page morte.
   *
   * Le mode de panne est asymétrique : un fichier retiré fait tomber la lecture, bruyamment.
   * Un fichier AJOUTÉ ne fait rien — la liste cesse de couvrir, et le vert reste vert.
   */
  const DETACHES: Record<string, { pourquoi: string; depuis: string }> = {
    "registre.test.ts": { pourquoi: "reprend le contrôle partagé et y ajoute celui-ci", depuis: "2026-08-24" },
    "demo.test.ts": { pourquoi: "dérive les routes du src/ui.html de ce dépôt, pas d'un modèle commun", depuis: "2026-08-24" },
    "ecran.test.ts": { pourquoi: "parse le script du ui.html de ce dépôt", depuis: "2026-08-24" },
    "clone-neuf.mjs": { pourquoi: "la chaîne de vérification d'un clone est propre à ce dépôt", depuis: "2026-08-24" },
  };

  const communs = readdirSync(source)
    .filter((f) => /\.(ts|js|mjs|css)$/.test(f) && existsSync(racine + "src/" + f));
  assert.ok(communs.length >= 8,
    `${communs.length} fichier(s) commun(s) trouvé(s) avec identite : la lecture a échoué, et ce `
    + `test passerait au vert sans avoir rien comparé.`);

  const divergents: string[] = [];
  const exceptionsMortes: string[] = [];
  for (const f of communs) {
    const pareil = readFileSync(racine + "src/" + f, "utf8") === readFileSync(source + f, "utf8");
    if (f in DETACHES) { if (pareil) exceptionsMortes.push(f); continue; }
    if (!pareil) divergents.push(f);
  }

  assert.deepEqual(divergents, [],
    `fichier(s) partagé(s) ayant divergé d'identite : ${divergents.join(", ")}\n`
    + `  → recopier depuis identite plutôt que corriger sur place ; ou, si la divergence est\n`
    + `    voulue, l'inscrire dans DETACHES avec sa raison et sa date.`);

  /* UNE EXCEPTION QUI NE SERT PLUS EST UNE EXCEPTION QUI CACHE. Tant qu'elle est là, le
     fichier n'est plus comparé — et le jour où il divergera pour de bon, rien ne le dira. */
  assert.deepEqual(exceptionsMortes, [],
    `exception(s) devenue(s) inutile(s) : ${exceptionsMortes.join(", ")} ne diverge(nt) plus.\n`
    + `  → les retirer de DETACHES, sinon ces fichiers restent hors du contrôle pour rien.`);

  /*
   * ─── UN FICHIER PARTAGÉ DOIT LE DIRE LUI-MÊME ───
   *
   * Le contrôle ci-dessus attrape la divergence, mais APRÈS coup. Deux sessions ont chacune
   * corrigé un fichier partagé sur place le même jour, découvert au commit que le crochet
   * refusait, et refait le travail dans `identite`. Rien dans les fichiers ne le disait, et
   * la règle vivait dans la mémoire de qui l'avait déjà payée.
   *
   * Une règle qui vit dans une mémoire ne survit pas à la session suivante. Celle-ci vit
   * maintenant sur la première ligne de chaque fichier concerné, là où on la lit AVANT
   * d'écrire plutôt qu'après.
   *
   * Et le contrôle part de la liste lue au disque : un fichier partagé ajouté demain arrive
   * avec l'obligation sans que personne y pense.
   *
   * LES DÉTACHÉS N'EN PORTENT PAS, et c'est le point de la liste. Poser la marque en bloc a
   * écrasé les quatre versions divergentes de ce dépôt — dont ce fichier-ci — parce que la
   * recopie ne lisait pas `DETACHES`. Git les a rendues intactes ; la leçon est que la liste
   * des exceptions doit être lue par TOUT ce qui touche aux fichiers partagés, pas seulement
   * par le contrôle qui les compare.
   */
  const sansMarque = communs.filter((f) =>
    !(f in DETACHES) && !readFileSync(source + f, "utf8").startsWith("/* PARTAGÉ"));
  assert.deepEqual(sansMarque, [],
    `${sansMarque.length} fichier(s) partagé(s) ne disent pas qu'ils le sont : ${sansMarque.join(", ")}.\n`
    + "  → une session qui les ouvre corrigera la copie, et ne l'apprendra qu'au commit refusé.\n"
    + "    Posez la marque « /* PARTAGÉ … */ » en première ligne, dans identite, puis recopiez.");
});
