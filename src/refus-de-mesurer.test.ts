import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, cpSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";
import { arbreJetable, retirerArbreJetable } from "./arbre-jetable.ts";

/*
 * LES REFUS QUI PROTÈGENT UN CHIFFRE PUBLIÉ — et qui ne tenaient rien.
 *
 * Le balayage des gardes a trouvé ces trois-là survivantes : retirées, aucun cas ne bougeait.
 * Chacune empêche la publication d'un nombre qui aurait l'air valide :
 *
 *   · `measure.ts` refuse de lancer une heure de calcul sur un geste distrait ;
 *   · `measure.ts` refuse de mesurer sur un arbre modifié, parce que chaque palier mesuré
 *     serait marqué non reproductible — y compris par celui qui l'a mesuré ;
 *   · `egress.ts` refuse de démarrer sans `lsof`, parce que publier « aucune connexion
 *     observée » après n'avoir RIEN PU observer est exactement le défaut qu'il existe pour
 *     empêcher.
 *
 * ─── COMMENT DEUX GARDES SE SERVENT DE CONTRÔLE POSITIF L'UNE À L'AUTRE ───
 *
 * Le contrôle positif de la première ne peut pas être « la commande démarre » : elle
 * téléchargerait un gigaoctet et tournerait une heure. Il est donc **le refus suivant** : avec
 * l'accord donné, sur un arbre sali, la commande doit refuser pour l'ARBRE. Ça prouve d'un seul
 * lancement que la première garde a été franchie, sans rien lancer de coûteux.
 */

const RACINE = fileURLToPath(new URL("..", import.meta.url));


test("measure refuse une heure de calcul sur un geste distrait", { timeout: 600_000 }, (t) => {
  if (!existsSync(join(RACINE, ".git"))) { t.diagnostic("hors dépôt git"); return; }
  const WT = arbreJetable("refus-mesure");
  try {
    const sansAccord = lancer([join(WT, "src", "measure.ts")],
      { cwd: WT, env: { MESURE_VOULUE: "" }, msMax: 120_000 });
    exigerRefus(sansAccord, /this pass downloads/, "measure sans accord explicite");
    assert.match(sansAccord.texte, /--je-veux-mesurer|MESURE_VOULUE/,
      "le refus doit dire COMMENT passer outre : un refus sans issue se contourne autrement, "
      + "et la façon dont on le contourne n'est jamais celle qu'on aurait voulue.");

    /* LE CONTRÔLE POSITIF, sans rien lancer de coûteux : avec l'accord, sur un arbre sali, la
       commande doit refuser pour l'ARBRE — donc elle a bien dépassé la première garde. */
    appendFileSync(join(WT, "src", "corpus.ts"), "\n/* une ligne qui salit l'arbre */\n");
    const avecAccord = lancer([join(WT, "src", "measure.ts"), "--je-veux-mesurer"],
      { cwd: WT, msMax: 120_000 });
    exigerRefus(avecAccord, /uncommitted changes/, "measure avec accord, sur arbre sali");
    assert.doesNotMatch(avecAccord.texte, /this pass downloads/,
      "l'accord donné, la première garde ne doit plus parler.");
  } finally { retirerArbreJetable(WT); }
});

test("measure refuse de mesurer sur un arbre modifié, et dit comment passer outre", { timeout: 600_000 }, (t) => {
  if (!existsSync(join(RACINE, ".git"))) { t.diagnostic("hors dépôt git"); return; }
  const WT = arbreJetable("refus-mesure");
  try {
    appendFileSync(join(WT, "src", "corpus.ts"), "\n/* une ligne qui salit l'arbre */\n");
    const sale = lancer([join(WT, "src", "measure.ts"), "--je-veux-mesurer"],
      { cwd: WT, msMax: 120_000 });
    exigerRefus(sale, /uncommitted changes/, "measure sur arbre sali");
    assert.match(sale.texte, /not reproducible/,
      "le refus doit dire CE QUI se casse — un relevé non reproductible — et pas seulement "
      + "qu'il refuse. Sans ça, `--allow-dirty` se pose sans y penser.");
    assert.match(sale.texte, /--allow-dirty/,
      "et nommer l'issue, dont la raison part dans le relevé.");
  } finally { retirerArbreJetable(WT); }
});

test("egress refuse de conclure quand il ne peut RIEN observer", { timeout: 600_000 }, () => {
  /*
   * LE ZÉRO QUI NE VEUT RIEN DIRE. Sans `lsof`, ce contrôle ne voit aucune connexion — et
   * « aucune connexion observée » est précisément ce qu'il publierait. Un scan cassé et un
   * scan qui ne trouve rien rendent le même chiffre ; seul le refus les distingue.
   *
   * On casse l'environnement d'une seule façon, et de la bonne : un `PATH` d'où `lsof` est
   * absent. Le reste de la commande est intact.
   */
  /*
   * ─── DANS UN ARBRE JETABLE, ET CE N'EST PAS UN CONFORT ───
   *
   * `egress` écrit son relevé dans `egress.json`, À LA RACINE DU DÉPÔT, et ce fichier est
   * SUIVI par git. Lancé ici, ce cas salissait donc l'arbre partagé — et les deux cas
   * au-dessus exigent un arbre propre. Il se serait empoisonné lui-même : vert au premier
   * lancement, rouge au suivant, sans que rien dans son message ne le dise. Une session
   * voisine l'a vu avant que ça coûte quelque chose.
   *
   * Mesuré : l'empreinte d'`egress.json` change pendant le lancement, et `git status` passe
   * de vide à « M egress.json ».
   */
  const WT = arbreJetable("egress-lsof");
  try {
    const chemin = join(WT, "src", "egress.ts");
    const sansLsof = lancer([chemin, "src/sonde.ts"],
      { cwd: WT, env: { PATH: "/nonexistent" }, msMax: 120_000 });
    exigerRefus(sansLsof, /lsof.*is not available|not available.*lsof/s, "egress sans lsof");
    assert.match(sansLsof.texte, /does not\s+start|so it does not/,
      "le refus doit dire qu'il NE DÉMARRE PAS — un avertissement suivi d'une mesure quand même "
      + "publierait le zéro qu'il vient de déclarer sans valeur.");

    /* LE CONTRÔLE POSITIF : le même appel, `PATH` intact, doit dépasser la garde. */
    const normal = lancer([chemin, "src/sonde.ts"], { cwd: WT, msMax: 25_000 });
    assert.match(normal.texte, /Watching network traffic/,
      `egress ne démarre pas dans l'état sain : le refus mesuré à côté ne prouve donc rien.\n`
      + normal.texte.slice(0, 300));
  } finally { retirerArbreJetable(WT); }
});
