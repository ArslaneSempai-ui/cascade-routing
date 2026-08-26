import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { interpreter } from "./ocr.ts";

/*
 * LA SORTIE DU BINAIRE, INTERPRÉTÉE — et la garde que rien n'atteignait.
 *
 * Le refus « this is not a list » a été trouvé survivant par le balayage des gardes : retiré,
 * aucun cas ne bougeait. Il n'était pas atteignable, parce qu'il aurait fallu faire rendre au
 * binaire autre chose qu'une liste. L'interprétation est sortie en fonction pour ça.
 *
 * CE QUE LA GARDE ÉVITE N'EST PAS UN PLANTAGE. Sans elle, `{}` repart comme une liste de blocs,
 * les appelants itèrent dessus, et un document dont le texte n'a pas été reconnu se rapporte
 * exactement comme une image sans texte. Zéro bloc, aucune erreur, un résultat plausible et
 * faux — la panne la plus chère de ce dépôt, et celle qui ne se voit jamais.
 */

test("une liste de blocs passe — sans ça, tout refus ci-dessous serait ambigu", () => {
  const blocs = [{ texte: "Anna", x: 0, y: 0, l: 10, h: 4 }];
  assert.deepEqual(interpreter(JSON.stringify(blocs), "img.png"), blocs);
});

test("une liste VIDE est un fait, pas une panne", () => {
  /*
   * LA DISTINCTION QUE TOUT LE FICHIER PROTÈGE. « J'ai regardé, il n'y a pas de texte » est un
   * résultat. Le confondre avec une panne ferait refuser des images blanches parfaitement
   * lisibles ; l'inverse ferait passer une panne pour une image blanche.
   */
  assert.deepEqual(interpreter("[]", "img.png"), []);
});

test("un objet qui n'est pas une liste est REFUSÉ, pas rendu comme une liste vide", () => {
  /*
   * LA GARDE SURVIVANTE. Le jour où ce cas tombe, quelqu'un a retiré `Array.isArray` — et le
   * symptôme ne sera pas une erreur, ce sera un document lu comme vide.
   */
  assert.throws(() => interpreter("{}", "img.png"), (e: Error) => {
    assert.match(e.message, /this is not a list/,
      "le refus doit dire ce qui ne va pas, pas seulement échouer.");
    assert.match(e.message, /img\.png/,
      "et nommer l'image : sur une passe de plusieurs centaines, « une sortie illisible » "
      + "sans le fichier ne se retrouve pas.");
    return true;
  });
  assert.throws(() => interpreter('"une chaîne"', "img.png"), /this is not a list/);
  assert.throws(() => interpreter("42", "img.png"), /this is not a list/);
  assert.throws(() => interpreter("null", "img.png"), /this is not a list/,
    "`null` non plus : `JSON.parse` le rend sans broncher et il itérerait comme un vide.");
});

test("une sortie qui ne se parse pas est une panne, et le refus montre ce qui a été reçu", () => {
  assert.throws(() => interpreter("Segmentation fault", "img.png"), (e: Error) => {
    assert.match(e.message, /cannot be read/);
    assert.match(e.message, /Segmentation fault/,
      "montrer le début de ce qui a été reçu épargne une heure : c'est presque toujours un "
      + "message d'erreur arrivé sur la sortie standard.");
    assert.match(e.message, /18 character/,
      "et la longueur, parce qu'une sortie vide et une sortie tronquée ne se diagnostiquent "
      + "pas pareil.");
    return true;
  });
  assert.throws(() => interpreter("", "img.png"), /0 character\(s\) that cannot be read/);
});

test("`lire` passe par `interpreter` — et ce cas regarde le TEXTE, pas le comportement", () => {
  /*
   * ─── CE QUE CE CAS VAUT, ET CE QU'IL NE VAUT PAS ───
   *
   * Les quatre cas ci-dessus éprouvent `interpreter`. Aucun ne tomberait si quelqu'un
   * remplaçait `return interpreter(sortie, chemin)` par `return JSON.parse(sortie) as Bloc[]`
   * dans `lire`. Mesuré : la substitution passe le typage sans une erreur et laisse la suite
   * verte. La garde serait alors parfaitement éprouvée et parfaitement contournée.
   *
   * IL N'Y A PAS DE CAS DE COMPORTEMENT POSSIBLE ICI, et il faut le dire plutôt que de laisser
   * croire le contraire. Atteindre ce chemin demande que le binaire RÉUSSISSE en rendant autre
   * chose qu'une liste — c'est-à-dire d'injecter ce qu'il rend. Tant que `lire` appelle
   * `execFileSync` sur un chemin constant, aucune entrée ne le produit.
   *
   * Donc ce cas regarde le texte de la source, ce qui est faible, et il annonce sa faiblesse.
   * Ce qu'il interdit précisément : que `lire` interprète la sortie lui-même. Le jour où
   * quelqu'un ouvre une couture pour injecter le lanceur, ce cas se remplace par un vrai.
   */
  const src = readFileSync(fileURLToPath(new URL("./ocr.ts", import.meta.url)), "utf8");
  /* Le CORPS de `lire`, pas tout ce qui la sépare d'`interpreter` : la documentation
     d'`interpreter` cite `JSON.parse` pour expliquer ce que la garde évite, et une tranche
     trop large la prenait pour du code. Un contrôle qui lit du texte doit d'abord savoir
     quel texte il lit. */
  const debut = src.indexOf("export function lire(");
  const corps = src.slice(debut, src.indexOf("\n}\n", debut));
  assert.ok(corps.length > 200, "la découpe a échoué : ce cas ne regarderait rien.");
  assert.match(corps, /return interpreter\(sortie, chemin\);/,
    "`lire` doit déléguer l'interprétation, pas la refaire.");
  assert.doesNotMatch(corps, /JSON\.parse/,
    "et ne pas parser lui-même : c'est exactement la substitution qui contourne la garde "
    + "sans rien faire tomber.");
});
