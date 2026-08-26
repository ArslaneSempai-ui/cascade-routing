import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";
import { arbreJetable, retirerArbreJetable } from "./arbre-jetable.ts";

/*
 * « LES DÉTECTEURS NE RECONNAISSENT PLUS CE QU'ILS PRÉTENDENT RECONNAÎTRE »
 *
 * ─── LA GARDE LA PLUS IMPORTANTE DE CE FICHIER, ET RIEN NE LA TENAIT ───
 *
 * `menace.ts` publie SECURITE.md : une liste de contrôles de sécurité et leur verdict. Ses
 * détecteurs sont des fonctions de contenu — ils lisent la source et disent « borne posée »,
 * « flux coupé ». Avant de publier quoi que ce soit, la commande les éprouve sur des textes
 * dont la réponse est connue. Si l'un se met à répondre autre chose, elle REFUSE et n'écrit
 * rien.
 *
 * Sans ce refus, un détecteur cassé publie un document rassurant : « Request body bounded |
 * held » alors que la borne ne fait plus rien. **Un scan cassé et un scan qui ne trouve rien
 * rendent le même verdict**, et celui-ci part chez un acheteur.
 *
 * Le balayage des gardes l'a trouvée survivante : retirée, aucun cas ne bougeait. Elle ne
 * pouvait pas l'être — l'éprouver demande de CASSER un détecteur, et le casser dans l'arbre
 * partagé casse la mesure de tout le monde.
 *
 * ─── CE QUE LE CAS EXIGE EN PLUS DU REFUS ───
 *
 * Qu'aucun document ne soit écrit. Un refus qui parle mais publie quand même laisse partir
 * exactement ce qu'il prétend empêcher, et c'est le défaut le plus difficile à voir : la
 * sortie contient l'avertissement ET le fichier est à jour.
 */

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const empreinte = (p: string) =>
  existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16) : "absent";

test("menace refuse de publier quand un de ses détecteurs a cessé de détecter",
  { timeout: 600_000 }, (t) => {
    if (!existsSync(join(RACINE, ".git"))) { t.diagnostic("hors dépôt git"); return; }
    const WT = arbreJetable("detecteurs");
    try {
      const commande = join(WT, "src", "menace.ts");
      const document = join(WT, "SECURITE.md");

      /* ─── LE CONTRÔLE POSITIF : détecteurs intacts, la commande va jusqu'au bout ─── */
      const sain = lancer([commande], { cwd: WT, msMax: 300_000 });
      assert.equal(sain.code, 0,
        `menace ne réussit pas dans l'état sain, donc le refus mesuré ensuite ne prouverait `
        + `rien.\n${sain.texte.slice(0, 400)}`);
      assert.doesNotMatch(sain.texte, /no longer recognise/,
        "les détecteurs intacts ne doivent déclencher aucun refus.");
      const avant = empreinte(document);
      assert.notEqual(avant, "absent", "le contrôle positif doit avoir écrit le document.");

      /*
       * ─── ON CASSE UN DÉTECTEUR, ET UN SEUL ───
       *
       * `bornePosee` rend désormais toujours « borne posée, flux coupé ». Des témoins de
       * `temoins()` attendent l'inverse sur des textes qui ne coupent rien — dont celui qui
       * compte : un plafond avec `pause()` et aucune fermeture doit rester refusé.
       *
       * C'est la mutation du défaut d'origine : un détecteur qui répond oui à tout. Pas une
       * panne, pas une exception — la forme exacte qui rend un document rassurant et faux.
       */
      const source = join(WT, "src", "menace.ts");
      const texte = readFileSync(source, "utf8");
      const ancre = 'export function bornePosee(source: string): { plafond: boolean; fluxCoupe: boolean } {';
      assert.ok(texte.includes(ancre),
        "l'ancre du détecteur a changé : ce cas muterait autre chose que ce qu'il annonce.");
      writeFileSync(source,
        texte.replace(ancre, `${ancre}\n  if (source) return { plafond: true, fluxCoupe: true };`));

      const casse = lancer([commande], { cwd: WT, msMax: 300_000 });
      exigerRefus(casse, /no longer recognise/, "menace avec un détecteur cassé");
      assert.match(casse.texte, /PAUSE SANS FERMETURE|borne coupée|plafond/,
        "le refus doit NOMMER le témoin qui ne passe plus : « un détecteur est cassé » sans "
        + "dire lequel envoie relire toute la liste.");
      assert.match(casse.texte, /Nothing was written/,
        "et dire qu'il n'a rien écrit, parce que c'est la promesse qu'on vérifie juste après.");

      assert.equal(empreinte(document), avant,
        "LE DOCUMENT A ÉTÉ RÉÉCRIT MALGRÉ LE REFUS. Un refus qui publie quand même laisse "
        + "partir exactement ce qu'il prétend empêcher — et la sortie contient l'avertissement, "
        + "donc personne ne regarde le fichier.");
    } finally { retirerArbreJetable(WT); }
  });
