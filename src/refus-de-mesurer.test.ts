import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, cpSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";

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

/** Un arbre jetable, dans le dossier temporaire — jamais à côté des vrais dépôts. */
function arbreJetable(): string {
  const chemin = mkdtempSync(join(tmpdir(), "refus-mesure-"));
  assert.ok(!chemin.includes("/Documents/"), `terrain d'essai dans le vrai arbre : ${chemin}`);
  execFileSync("git", ["-C", RACINE, "worktree", "add", "--detach", "-q", chemin, "HEAD"]);
  symlinkSync(join(RACINE, "node_modules"), join(chemin, "node_modules"));
  /* Le code du DISQUE, pas celui de HEAD : une suite lancée avant un commit doit juger ce qui
     va partir. Figé par un commit détaché pour que l'arbre soit propre malgré la copie. */
  cpSync(join(RACINE, "src"), join(chemin, "src"), { recursive: true });
  execFileSync("git", ["-C", chemin, "add", "-A"]);
  execFileSync("git", ["-C", chemin, "-c", "user.name=t", "-c", "user.email=t@t",
    "commit", "-q", "--no-verify", "-m", "état du disque, figé pour ce cas"]);
  return chemin;
}

function retirer(chemin: string): void {
  try { execFileSync("git", ["-C", RACINE, "worktree", "remove", "--force", chemin]); } catch { /* parti */ }
  rmSync(chemin, { recursive: true, force: true });
}

test("measure refuse une heure de calcul sur un geste distrait", { timeout: 600_000 }, (t) => {
  if (!existsSync(join(RACINE, ".git"))) { t.diagnostic("hors dépôt git"); return; }
  const WT = arbreJetable();
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
  } finally { retirer(WT); }
});

test("measure refuse de mesurer sur un arbre modifié, et dit comment passer outre", { timeout: 600_000 }, (t) => {
  if (!existsSync(join(RACINE, ".git"))) { t.diagnostic("hors dépôt git"); return; }
  const WT = arbreJetable();
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
  } finally { retirer(WT); }
});

test("egress refuse de conclure quand il ne peut RIEN observer", { timeout: 300_000 }, () => {
  /*
   * LE ZÉRO QUI NE VEUT RIEN DIRE. Sans `lsof`, ce contrôle ne voit aucune connexion — et
   * « aucune connexion observée » est précisément ce qu'il publierait. Un scan cassé et un
   * scan qui ne trouve rien rendent le même chiffre ; seul le refus les distingue.
   *
   * On casse l'environnement d'une seule façon, et de la bonne : un `PATH` d'où `lsof` est
   * absent. Le reste de la commande est intact.
   */
  const chemin = join(RACINE, "src", "egress.ts");
  const sansLsof = lancer([chemin, "src/sonde.ts"],
    { cwd: RACINE, env: { PATH: "/nonexistent" }, msMax: 120_000 });
  exigerRefus(sansLsof, /lsof.*is not available|not available.*lsof/s, "egress sans lsof");
  assert.match(sansLsof.texte, /does not\s+start|so it does not/,
    "le refus doit dire qu'il NE DÉMARRE PAS — un avertissement suivi d'une mesure quand même "
    + "publierait le zéro qu'il vient de déclarer sans valeur.");

  /* LE CONTRÔLE POSITIF : le même appel, `PATH` intact, doit dépasser la garde. */
  const normal = lancer([chemin, "src/sonde.ts"], { cwd: RACINE, msMax: 25_000 });
  assert.match(normal.texte, /Watching network traffic/,
    `egress ne démarre pas dans l'état sain : le refus mesuré à côté ne prouve donc rien.\n`
    + normal.texte.slice(0, 300));
});
