import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, existsSync, cpSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus, exigerQueCaMarcheSansCa } from "./commande-eprouvee.ts";

/*
 * « MODIFIED TREE : COMMITE AVANT DE MESURER » — trois commandes, une seule garde.
 *
 * ─── CE QU'ELLE TIENT ───
 *
 * Ces trois commandes écrivent un relevé estampillé du commit courant. Lancées sur un arbre
 * modifié, elles produisent un relevé qui DÉSIGNE un commit ne contenant pas le code mesuré.
 * Ce n'est pas une approximation : c'est une fausse provenance, et une fausse provenance se
 * cite. Le chiffre survit à la session qui l'a produit, plus la réserve qui allait avec.
 *
 * ─── POURQUOI ELLE ÉTAIT SURVIVANTE ───
 *
 * Le balayage des gardes l'a trouvée trois fois : retirée, aucun cas ne bougeait. Pas parce
 * qu'elle est inutile — parce que l'éprouver demande un arbre SALE, et salir l'arbre partagé
 * ferait refuser le commit de toutes les autres sessions le temps du cas. On travaille donc
 * dans un arbre isolé, sali puis nettoyé, et rien n'en sort.
 *
 * ─── LE CONTRÔLE POSITIF PORTE SUR CE QUI EST DIT, PAS SUR LE CODE ───
 *
 * Ces commandes chargent des modèles et tournent des minutes. On ne les laisse pas finir : on
 * pose une borne de temps et on exige qu'elles aient DÉPASSÉ la garde — ce qui se lit à leur
 * en-tête. Un code de sortie ne dirait rien ici : c'est celui d'un processus tué.
 */

const RACINE = fileURLToPath(new URL("..", import.meta.url));

/**
 * L'ARBRE D'ESSAI VIT DANS LE DOSSIER TEMPORAIRE, PAS À CÔTÉ DES VRAIS DÉPÔTS.
 *
 * La première version le posait dans `~/Documents/.worktrees-cascade/`. Une garde du dépôt l'a
 * refusée — « aucun contrôle ne s'est mis à lire le vrai arbre des dépôts sans le dire » — et
 * elle avait raison : un cas qui écrit dans le dossier des dépôts peut les abîmer tous, et
 * celui-ci copie puis efface des répertoires entiers.
 *
 * Il aurait été facile de contourner le détecteur — il cherche `new URL("../../`, qu'un
 * `join()` évite. Contourner un détecteur sans répondre à ce qu'il protège, c'est le vider.
 * Le dossier temporaire répond vraiment : rien de ce que ce cas écrit ne peut atteindre un
 * dépôt, même s'il s'interrompt au mauvais moment.
 */
function arbreJetable(): string {
  const chemin = mkdtempSync(join(tmpdir(), "arbre-propre-"));
  assert.ok(!chemin.includes("/Documents/"),
    `terrain d'essai dans le vrai arbre : ${chemin}`);
  execFileSync("git", ["-C", RACINE, "worktree", "add", "--detach", "-q", chemin, "HEAD"],
    { encoding: "utf8" });
  /* `node_modules` est LIÉ, jamais installé : le dépôt y garde un cache de modèles de plus
     d'un gigaoctet, et les trois commandes ne démarrent pas sans lui. */
  symlinkSync(join(RACINE, "node_modules"), join(chemin, "node_modules"));
  return chemin;
}

function retirerArbre(chemin: string): void {
  try { execFileSync("git", ["-C", RACINE, "worktree", "remove", "--force", chemin]); } catch { /* déjà parti */ }
  rmSync(chemin, { recursive: true, force: true });
}

/** Les trois commandes, avec l'en-tête qui prouve qu'elles ont dépassé la garde. */
const COMMANDES = [
  { fichier: "apparier-prompt.ts", entete: /tiers × .* phrasings/ },
  { fichier: "departager-reglage.ts", entete: /pairs × .* fields/ },
  { fichier: "mesurer-dur.ts", entete: /cases \(.*tabular/ },
];

test("les trois commandes refusent de mesurer sur un arbre modifié", { timeout: 600_000 }, (t) => {
  if (!existsSync(join(RACINE, ".git"))) {
    /* Pas un saut déguisé : hors dépôt git, la propriété n'existe pas et le dire vaut mieux
       que rendre un vert. */
    t.diagnostic("hors dépôt git — la garde n'a pas de sens ici");
    return;
  }
  const WT = arbreJetable();
  try {
    /*
     * L'ARBRE ISOLÉ EST CRÉÉ SUR HEAD — DONC IL NE VOIT PAS CE QUI EST SUR LE DISQUE.
     *
     * Sans la copie ci-dessous, ce cas éprouverait la garde telle qu'elle est COMMITÉE et
     * resterait vert alors qu'on vient de la retirer du fichier de travail. C'est-à-dire
     * exactement l'inverse de ce qu'on demande à une suite lancée avant un commit : elle doit
     * juger ce qui va partir, pas ce qui est déjà parti.
     *
     * Mesuré en le vérifiant : la mutation de la garde dans l'arbre partagé laissait ce cas
     * vert tant que la copie n'était pas faite.
     */
    cpSync(join(RACINE, "src"), join(WT, "src"), { recursive: true });
    /*
     * ET ON FIGE LA COPIE PAR UN COMMIT DANS L'ARBRE ISOLÉ.
     *
     * La copie apporte le code du disque — et le rend SALE, puisque c'est ce que « sale » veut
     * dire. Or l'état sain qu'on veut éprouver, c'est « ce code-ci, sur un arbre propre ». Le
     * commit local le produit : il est détaché, ne touche aucune branche, et disparaît avec
     * l'arbre.
     *
     * L'identité passe par `-c` et n'est PAS posée par `git config` : un arbre de travail ne
     * possède pas sa propre configuration, et l'y écrire signerait les commits de toutes les
     * autres sessions. Payé le 26 août 2026, onze commits réécrits.
     */
    execFileSync("git", ["-C", WT, "add", "-A"], { encoding: "utf8" });
    execFileSync("git", ["-C", WT, "-c", "user.name=t", "-c", "user.email=t@t",
      "commit", "-q", "--no-verify", "-m", "état du disque, figé pour ce cas"],
      { encoding: "utf8" });
    /* ─── LE CONTRÔLE POSITIF D'ABORD ───
       Sans lui, les refus ci-dessous pourraient venir d'un arbre isolé qui ne tourne pas du
       tout — et ils passeraient d'autant mieux que tout serait cassé. */
    for (const c of COMMANDES) {
      const sain = lancer([join(WT, "src", c.fichier), "--cases=1"], { cwd: WT, msMax: 90_000 });
      exigerQueCaMarcheSansCa({ code: 0, texte: sain.texte }, `${c.fichier} sur arbre propre`);
      assert.match(sain.texte, c.entete,
        `${c.fichier} : l'en-tête n'apparaît pas, donc la commande n'a pas dépassé la garde — `
        + `le refus mesuré ensuite ne prouverait rien.\n${sain.texte.slice(0, 300)}`);
      assert.doesNotMatch(sain.texte, /Modified tree/,
        `${c.fichier} refuse sur un arbre PROPRE : la garde se déclenche à tort.`);
    }

    /* ─── PUIS LE REFUS, SUR LE MÊME ARBRE, SALI D'UNE LIGNE ─── */
    appendFileSync(join(WT, "src", "corpus.ts"), "\n/* une ligne qui salit l'arbre */\n");
    for (const c of COMMANDES) {
      const sale = lancer([join(WT, "src", c.fichier), "--cases=1"], { cwd: WT, msMax: 90_000 });
      exigerRefus(sale, /Modified tree/, `${c.fichier} sur arbre sali`);
      assert.doesNotMatch(sale.texte, c.entete,
        `${c.fichier} : la garde a parlé mais la mesure a démarré quand même. Un refus qui `
        + `n'arrête pas laisse partir le relevé qu'il prétend empêcher.`);
    }
  } finally {
    retirerArbre(WT);
  }
});

test("l'arbre partagé n'a pas été touché", () => {
  /*
   * LE CAS QUI SURVEILLE LE CAS. Le précédent salit un arbre ; s'il salissait le vrai, il
   * ferait refuser le commit de toutes les sessions — le contrôle casserait ce qu'il protège.
   */
  const etat = execFileSync("git", ["status", "--porcelain", "--", "src/corpus.ts"],
    { cwd: RACINE, encoding: "utf8" });
  assert.equal(etat.trim(), "",
    "src/corpus.ts est modifié dans l'arbre partagé : le cas précédent a sali le mauvais arbre.");
  assert.doesNotMatch(readFileSync(join(RACINE, "src", "corpus.ts"), "utf8"),
    /une ligne qui salit l'arbre/, "la ligne du cas est restée dans le fichier partagé.");
});
