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

/** Les extensions que la commande de suite lance, telles qu'elle les écrit. */
export function extensionsLancees(scriptTest: string): string[] {
  return [...new Set(
    [...scriptTest.matchAll(/src\/\*(\.[A-Za-z0-9.]*[A-Za-z0-9])/g)].map((m) => m[1]!),
  )];
}

/** Les fichiers de cas que cette commande atteint, dans ce dossier. */
export function fichiersDeCas(dossier: string, scriptTest: string): string[] {
  const extensions = extensionsLancees(scriptTest);
  return readdirSync(dossier)
    .filter((n: string) => extensions.some((e) => n.endsWith(e)))
    .sort();
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
