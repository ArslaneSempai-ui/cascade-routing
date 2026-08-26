/**
 * LA DÉTECTION DU POINT D'ENTRÉE S'ÉCRIT UNE FOIS.
 *
 * Cinq modules portaient chacun leur copie de
 * `import.meta.url === pathToFileURL(argv1).href`, avec chacune son commentaire expliquant le
 * piège URL-contre-chemin. Elles étaient toutes justes — c'est ce qui les rendait invisibles :
 * **deux façons de produire la même chose ne se contredisent qu'après une modification, et
 * jamais le jour où on les écrit.**
 *
 * `isMain` vit dans `cli.ts`, qui voyage entre les dépôts. Une sixième copie arriverait sans
 * que rien ne le dise ; ce cas est là pour qu'elle ne puisse pas.
 *
 * Le remplacement a été éprouvé équivalent avant d'être fait, sur les quatre cas qui séparent
 * les deux formes : chemin accentué avec espaces, invocation relative, lien symbolique — où
 * les deux rendent `false` — et exécution directe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** `cli.ts` est l'endroit où cette comparaison a le droit d'exister. */
const SOURCE_LEGITIME = "cli.ts";

/**
 * DISPENSÉ, AVEC SA RAISON ET SA CONDITION DE RETRAIT.
 *
 * `verifier-ecran.mjs` porte la même copie, mais il appartient à la couche partagée : treize
 * exemplaires, dont la source vit dans `identite`. Le corriger ICI fabriquerait la divergence
 * que cette couche existe pour empêcher — la correction doit partir de la source et se
 * propager.
 *
 * **Condition de retrait :** dès que la source ne réécrit plus la détection, cette ligne
 * disparaît. Le cas ci-dessous refuse une dispense qui ne sert plus, pour qu'elle ne survive
 * pas à la raison qui l'a fait écrire.
 */
const DISPENSES: Record<string, string> = {
  "verifier-ecran.mjs": "couche partagée, treize copies : la correction part d'identite",
  /*
   * CES DEUX-LÀ SONT COPIÉS SEULS ET EXÉCUTÉS AILLEURS — leur duplication n'est pas de la
   * négligence, c'est leur raison d'être. Trouvé en les remplaçant : deux cas existants sont
   * tombés. `menace.test.ts` copie `menace.ts` dans un dossier temporaire et l'y lance ; il n'y
   * a pas de `cli.ts` à côté, donc l'import échoue et la commande ne s'exécute plus.
   * `premiere-reponse.test.ts` exige explicitement qu'elle ne demande AUCUNE installation.
   *
   * **Un module qu'on copie seul ne peut pas dépendre d'un frère.** Les cas rouges disaient que
   * mon remplacement était trop large, pas qu'ils étaient mauvais.
   */
  "menace.ts": "copié seul dans un dossier temporaire et exécuté là — aucun frère à côté",
  "premiere-reponse.mjs": "s'envoie seule et doit tourner sans installation",
};

/** Ce qui trahit une détection réécrite à la main, commentaires retirés. */
function detectionsReecrites(code: string): number {
  const sansCommentaires = code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
  return (sansCommentaires.match(/import\.meta\.url\s*===|===\s*import\.meta\.url/g) ?? []).length;
}

test("aucun module ne réécrit la détection du point d'entrée", () => {
  const fichiers = readdirSync(SRC).filter((n) => /\.(ts|mjs)$/.test(n) && !/\.test\./.test(n));
  assert.ok(fichiers.length >= 30,
    `${fichiers.length} source(s) lue(s) : le balayage n'a pas eu lieu, son zéro ne vaut rien.`);

  /* CONTRÔLE POSITIF : le motif doit trouver la détection là où elle a le droit d'être. Sans
     ça, un motif cassé rendrait zéro partout et se lirait comme une absence de faute. */
  const legitime = detectionsReecrites(
    "const x = import.meta.url === pathToFileURL(a).href;");
  assert.equal(legitime, 1,
    "le motif ne reconnaît plus la forme qu'il cherche : son zéro ne prouverait rien");

  const fautifs: string[] = [];
  const dispensesInutiles: string[] = [];
  for (const n of fichiers) {
    if (n === SOURCE_LEGITIME) continue;
    const combien = detectionsReecrites(readFileSync(join(SRC, n), "utf8"));
    if (n in DISPENSES) {
      /* UNE DISPENSE QUI NE SERT PLUS SE FAIT REMARQUER. Sans ça elle survit à sa raison et
         dispense en silence le prochain fichier qui portera ce nom. */
      if (combien === 0) dispensesInutiles.push(n);
      continue;
    }
    if (combien > 0) fautifs.push(`${n} (${combien})`);
  }
  assert.deepEqual(dispensesInutiles, [],
    `dispense(s) devenue(s) inutiles : ${dispensesInutiles.join(", ")}\n`
    + "  → la source a été corrigée et propagée : retirer la ligne de DISPENSES.");
  assert.deepEqual(fautifs, [],
    `détection du point d'entrée réécrite dans : ${fautifs.join(", ")}\n`
    + `  → employer \`isMain(import.meta)\` de \`${SOURCE_LEGITIME}\`.\n`
    + "    Une comparaison subtile recopiée est un endroit de plus où se tromper demain, et\n"
    + "    toutes rendent le même résultat le jour où on les écrit.");
});
