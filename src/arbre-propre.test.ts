import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus, exigerQueCaMarcheSansCa } from "./commande-eprouvee.ts";
import { arbreJetable, retirerArbreJetable } from "./arbre-jetable.ts";

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
  const WT = arbreJetable("arbre-propre");
  try {
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
    retirerArbreJetable(WT);
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
