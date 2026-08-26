/*
 * LES QUATRE CODES DE SORTIE DE `diff`, QU'UNE CHAÎNE D'INTÉGRATION LIT.
 *
 * Le balayage du 26 août 2026 les a tous rendus survivants : aucun cas ne les atteignait. Ce
 * sont pourtant les seuls signaux que reçoit quelque chose d'automatique, et une session
 * voisine a mesuré qu'y passer `exit(1)` à `exit(0)` laisse la suite entièrement verte.
 *
 * Le plus important est le 2 de « NOTHING WAS COMPARED » : **un outil qui n'a rien pu comparer
 * et un outil qui n'a rien trouvé à signaler rendent le même écran rassurant.** Sans ce code,
 * une comparaison cassée se lit comme « aucune régression » — et c'est la conclusion qu'on
 * publie. C'est la même famille que le scan cassé qui rend « rien trouvé ».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";
import { arbreJetable, retirerArbreJetable } from "./arbre-jetable.ts";

/*
 * `lire()` ne lit QUE depuis la racine du dépôt : `join(RACINE, f)`. Écrire les relevés dans
 * l'arbre vivant pour éprouver cette commande le salirait — exactement ce que le crochet
 * signale depuis aujourd'hui, et exactement le défaut qui a fait tomber trois cas ce matin.
 * On travaille donc dans un arbre jetable, créé une fois pour les quatre cas.
 */
const ARBRE = arbreJetable("diff-sorties");
const CMD = join(ARBRE, "src", "diff.ts");

const releve = (quand: string, reussites: string, champ = "name") => ({
  measuredAt: quand,
  extraction: { rules: { [champ]: { reussites, accuracy: 50 } } },
});

/** Écrit deux relevés dans un bac et rend leurs chemins. */
let n = 0;
const paire = (a: object, b: object): [string, string] => {
  /* Des NOMS, pas des chemins : `lire` les joint à la racine. Et des noms uniques par cas,
     sinon les quatre cas se marcheraient dessus dans le même arbre. */
  const f1 = `profiles-t${++n}-avant.json`, f2 = `profiles-t${n}-apres.json`;
  writeFileSync(join(ARBRE, f1), JSON.stringify(a));
  writeFileSync(join(ARBRE, f2), JSON.stringify(b));
  return [f1, f2];
};

test.after(() => retirerArbreJetable(ARBRE));

test("rien de comparé n'est PAS rien de changé, et le code de sortie le dit", () => {
  /* Le second relevé ne porte pas la cellule : rien n'a pu être comparé. Sans le code 2, cette
     passe se lit exactement comme une passe sans régression. */
  const [a, b] = paire(releve("2026-01-01", "1111"), releve("2026-01-02", "1111", "autre-champ"));
  const r = lancer([CMD, a, b]);
  exigerRefus(r, /NOTHING WAS COMPARED/, "une comparaison vide doit sortir en erreur");
  assert.equal(r.code, 2, `le code doit être 2, reçu ${r.code} — une chaîne lit le code, pas la prose.`);
  assert.match(r.texte, /not the same as/,
    "le refus ne dit pas en quoi c'est différent de « aucun changement » : c'est toute la garde.");
});

test("aucun cas changé sort en 0", () => {
  const [a, b] = paire(releve("2026-01-01", "1010"), releve("2026-01-02", "1010"));
  const r = lancer([CMD, a, b]);
  assert.equal(r.code, 0, `attendu 0, reçu ${r.code} : ${r.texte.slice(0, 200)}`);
  assert.match(r.texte, /No case changed outcome/);
});

test("des cas PERDUS sortent en 1 — c'est ce qui doit arrêter une chaîne", () => {
  /* Un cas qui réussissait et ne réussit plus. Sans le 1, une régression passe sans bruit. */
  const [a, b] = paire(releve("2026-01-01", "1111"), releve("2026-01-02", "1011"));
  const r = lancer([CMD, a, b]);
  assert.equal(r.code, 1, `une régression doit sortir en 1, reçu ${r.code} : ${r.texte.slice(0, 200)}`);
  assert.match(r.texte, /CASES LOST: 1/, "le compte des cas perdus n'est pas dit.");
});

test("des cas GAGNÉS seulement sortent en 0 — sinon le 1 ne voudrait rien dire", () => {
  /* CONTRE-ÉPREUVE du cas précédent : si toute différence sortait en 1, le code ne
     distinguerait plus une régression d'une amélioration, et une chaîne s'arrêterait sur un
     progrès. C'est ce qui donne son sens au 1. */
  const [a, b] = paire(releve("2026-01-01", "1011"), releve("2026-01-02", "1111"));
  const r = lancer([CMD, a, b]);
  assert.equal(r.code, 0, `un gain seul doit sortir en 0, reçu ${r.code} : ${r.texte.slice(0, 200)}`);
  assert.match(r.texte, /cases gained: 1/);
});
