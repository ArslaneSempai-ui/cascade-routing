/*
 * COMPTER LES CAS — ET DIRE CE QUE LE COMPTE ÉCARTE.
 *
 * Le README annonçait « 539 tests across 61 files, counted from the sources rather than typed
 * here ». La suite en exécutait 573, dans 65 fichiers. Le compteur ne lisait que `.test.ts`
 * quand la commande lance `src/*.test.ts` ET `src/*.test.mjs` — un tiers d'un fichier de cas
 * écarté sans un mot, sur la page d'un produit vendu à des banques, et faux dans le sens qui
 * dessert.
 *
 * UNE SÉLECTION QUI N'ANNONCE PAS CE QU'ELLE ÉCARTE FINIT PAR MENTIR. Le remède n'est pas
 * d'écrire « .test.ts, .test.mjs » ici : ce serait le même défaut un cran plus loin, et le
 * jour où la commande gagne une extension, la liste écrite à la main regarderait encore
 * l'ancienne collection — en silence, comme la première fois. La liste se LIT dans le script
 * `test` de `package.json`, qui est ce qui détermine vraiment ce qui tourne.
 *
 * Ce module vit à part parce que `readme.ts` n'exporte rien : c'est une suite d'IIFE qui se
 * termine en réécrivant README.md, donc l'importer publierait la page. Un compteur qu'aucun
 * cas ne peut atteindre est un compteur qu'aucun cas ne garde.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Les suffixes que la commande de suite lance, tels qu'elle les écrit — `*` compris.
 *
 * LE MOTIF EST TOUJOURS EN RETARD SUR UNE FORME QU'ON N'A PAS PRÉVUE. Écrit pour `cascade`,
 * qui liste ses extensions en toutes lettres, il rendait `[".test"]` sur `src/*.test.*` — la
 * forme que neuf dépôts voisins emploient. Une extension qui ne correspond à AUCUN fichier :
 * le compte tombait à zéro, et le zéro se lisait comme un résultat.
 *
 * On reconnaît donc l'étoile ; mais ce n'est PAS le correctif, c'est un rattrapage. Le
 * correctif est le refus de `fichiersDeCas` : il couvre les formes qu'on n'a pas encore vues.
 */
export function extensionsLancees(scriptTest: string): string[] {
  return [...new Set(
    [...scriptTest.matchAll(/src\/\*(\.[A-Za-z0-9.*]*[A-Za-z0-9*])/g)].map((m) => m[1]!),
  )];
}

/** Un nom correspond-il au suffixe lancé ? `*` y vaut une extension non vide. */
function correspond(nom: string, suffixe: string): boolean {
  const motif = suffixe.split("").map((c) =>
    c === "*" ? "[A-Za-z0-9]+" : c === "." ? "\\." : c).join("");
  return new RegExp(motif + "$").test(nom);
}

/**
 * Les fichiers de cas que cette commande atteint, dans ce dossier.
 *
 * ─── UN COMPTEUR QUI NE RECONNAÎT PAS SA COMMANDE REFUSE, IL NE REND PAS ZÉRO ───
 *
 * C'est la règle que ce dépôt applique à tous ses contrôles, retournée vers son propre outil :
 * le zéro doit prouver qu'il a regardé. Sans ce refus, ce module copié chez un voisin qui écrit
 * ses extensions autrement sélectionnait zéro fichier, comptait zéro cas, et le README publiait
 * « 0 tests » comme une mesure. Le mode de panne est silencieux ET il porte un chiffre, ce qui
 * est la pire combinaison : personne ne va vérifier un nombre qui s'affiche.
 *
 * La condition porte sur le RÉSULTAT, pas sur l'extraction. Sur `src/*.test.*` le motif
 * d'origine extrayait bien quelque chose — `.test` — qui ne correspondait simplement à aucun
 * fichier. Un contrôle posé sur « a-t-on extrait une extension » aurait donc passé au vert sur
 * le cas même qui l'a fait écrire.
 */
export function fichiersDeCas(dossier: string, scriptTest: string): string[] {
  const suffixes = extensionsLancees(scriptTest);
  const fichiers = readdirSync(dossier)
    .filter((n: string) => suffixes.some((e) => correspond(n, e)))
    .sort();

  if (scriptTest.trim() !== "" && fichiers.length === 0) {
    throw new Error(
      `no case file reached in ${dossier}.\n`
      + `  Suffixes deduced from the \`test\` script: ${suffixes.length ? suffixes.join(", ") : "none"}\n`
      + `  Script read: ${scriptTest}\n`
      + "  A counter that does not recognise the shape it is handed must REFUSE: returning zero\n"
      + "  would publish \"0 tests\" as a measurement. → widen how the script is read, or fix the\n"
      + "  script if it really runs no cases.");
  }
  return fichiers;
}

/**
 * TOUT CE QUI RESSEMBLE À UN FICHIER DE CAS, que la commande l'atteigne ou non.
 *
 * C'est la collection de référence : le jour où quelqu'un ajoute `foo.test.mts` sans toucher
 * à `package.json`, elle le voit et la commande ne le voit pas. L'écart entre les deux est
 * exactement le défaut qu'on vient de réparer.
 */
export function fichiersQuiRessemblentADesCas(dossier: string): string[] {
  return readdirSync(dossier).filter((n: string) => /\.test\.[A-Za-z0-9]+$/.test(n)).sort();
}

export function compterLesCas(dossier: string, scriptTest: string): { n: number; fichiers: string[] } {
  const fichiers = fichiersDeCas(dossier, scriptTest);
  const n = fichiers.reduce((a: number, f: string) =>
    a + (readFileSync(join(dossier, f), "utf8").match(/^test\(/gm) ?? []).length, 0);
  return { n, fichiers };
}
