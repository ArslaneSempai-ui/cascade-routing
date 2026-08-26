/**
 * L'étage que ce dépôt supposait déjà fait : lire un document AVANT d'en extraire les champs.
 *
 * Tout ce qui est mesuré ici part d'un texte. Un client en conformité, lui, reçoit des SCANS
 * — passeports photographiés, justificatifs numérisés, relevés télécopiés. Entre sa pile de
 * documents et la première ligne de cet outil, il y a une étape que personne n'avait mesurée
 * et que le README supposait résolue.
 *
 * ─── POURQUOI UN OCR ET PAS UN MODÈLE DE VISION ───
 *
 * Mesuré le 24 août 2026 sur une carte de restaurant fabriquée, vérité terrain connue :
 *
 *     moondream (1,7 Go)   0 plat sur 9    INVENTE
 *     llava:7b  (4,7 Go)   0 plat sur 9    INVENTE, de façon crédible
 *     cet OCR              10 prix sur 10  ne peut pas inventer
 *
 * `llava` a produit une liste de plats grecs plausible à partir du seul nom du restaurant.
 * C'est le défaut le plus coûteux qu'un outil d'audit puisse avoir : une réponse fausse qui a
 * l'air juste. UN OCR NE PEUT PAS FAIRE ÇA — il lit ou il ne lit pas, et ce qu'il ne lit pas,
 * il l'omet au lieu de le combler.
 *
 * ─── CE QUE ÇA COÛTE, ET CE QUE ÇA NE COÛTE PAS ───
 *
 * Zéro appel réseau, zéro tarif : la reconnaissance est celle du système. Elle est donc aussi
 * SPÉCIFIQUE À macOS, et c'est écrit plutôt que caché — sur une autre plateforme il faut son
 * équivalent, et `npm run ocr` refuse au lieu de rendre un résultat vide.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("./ocr/lire.swift", import.meta.url));
const BINAIRE = fileURLToPath(new URL("./ocr/lire", import.meta.url));

export type Bloc = {
  texte: string;
  /** Les deux coins hauts, en fraction de l'image. L'angle du document s'y lit. */
  tlx: number; tly: number; trx: number; try: number;
  confiance: number;
};

/** Ce qui manque pour lire une image ici, ou `null` si tout est là. */
export function ceQuiManque(): string | null {
  if (process.platform !== "darwin") {
    return `la reconnaissance de texte employée ici est celle de macOS, et cette machine est `
      + `${process.platform}. Un équivalent existe ailleurs — tesseract, entre autres — mais il `
      + `n'est pas mesuré dans ce dépôt, et publier un chiffre obtenu avec un autre moteur sous `
      + `le même nom serait exactement ce que cet outil refuse.`;
  }
  if (existsSync(BINAIRE)) return null;
  try {
    execFileSync("swiftc", ["-O", SOURCE, "-o", BINAIRE], { stdio: ["ignore", "ignore", "pipe"] });
    return null;
  } catch {
    return `\`swiftc\` est introuvable : il vient avec les outils de ligne de commande de Xcode `
      + `(\`xcode-select --install\`). Sans lui, l'étage de lecture ne peut pas être compilé, et `
      + `cet outil refuse plutôt que de mesurer une chaîne dont il manque le premier maillon.`;
  }
}

/**
 * Les blocs de texte d'une image, avec leur position.
 *
 * LES POSITIONS NE SONT PAS UN LUXE. Sans elles, une colonne de prix arrive détachée de ses
 * intitulés et l'ordre de lecture ne les réunit pas : mesuré sur un menu à deux colonnes,
 * l'appariement par ordre d'apparition attache la moitié des valeurs à la mauvaise ligne, et
 * rend un résultat complet, plausible et faux.
 */
export function lire(chemin: string): Bloc[] {
  /*
   * CE REFUS NE TOMBE PAS ICI ET TOMBE SUR LA CHAÎNE — LES DEUX COMPTENT.
   *
   * Un balayage l'a signalé comme survivant : retiré, aucun cas ne bougeait. La première
   * explication était que `ceQuiManque()` **compile le binaire à la demande** — mesuré le
   * 25 août 2026 dans un arbre neuf où `src/ocr/lire` était absent, l'appel a rendu `null`
   * après avoir produit 92 Ko de binaire. Donc sur une machine macOS outillée, aucune entrée
   * ne le déclenche.
   *
   * **Cette explication était vraie de cette machine et fausse de celle qui décide.**
   * L'intégration publique tourne sur `ubuntu-latest`, et la première condition de
   * `ceQuiManque()` est `process.platform !== "darwin"`. Le refus y est donc pleinement
   * atteignable, et c'est là que la vérification publiée se fait.
   *
   * Le cas correspondant dans `ocr-gardes.test.ts` affirme dans les deux états sans jamais
   * sauter : la plateforme décide laquelle des deux propriétés est vraie, et chacune est
   * éprouvée là où elle a un sens. Un cas sauté annoncerait une couverture qu'il n'a pas.
   */
  /* survivant:ok inatteignable ici — `ceQuiManque()` compile le binaire à la demande, 92 Ko
     produits dans un arbre neuf, donc aucune entrée ne le déclenche sur une machine outillée.
     La garde EST atteignable sur `ubuntu-latest`, où la chaîne publie sa vérification : elle
     n'est pas morte, elle est hors de portée d'ici. Sans cette marque le balayage la resignale
     à chaque passe, et un avertissement qu'on réexplique chaque nuit finit ignoré — le jour où
     un vrai survivant s'y glisse, personne ne le distingue. */
  const manque = ceQuiManque();
  if (manque) throw new Error(manque);

  /*
   * LA RAISON DU BINAIRE, PAS « COMMAND FAILED ».
   *
   * `execFileSync` lève sur une sortie non nulle avec un message qui ne dit rien de ce qui
   * s'est passé. Or le lecteur distingue quatre pannes — pas de chemin, fichier introuvable,
   * fichier qui n'est pas une image, reconnaissance échouée — et les nommer une par une côté
   * Swift ne sert à rien si le message meurt ici.
   */
  let sortie: string;
  try {
    sortie = execFileSync(BINAIRE, [chemin], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; status?: number };
    const dit = String(err.stderr ?? "").trim();
    throw new Error(dit ? `${dit} (code ${err.status})`
      : `the image reader failed on ${chemin} saying nothing (code ${err.status}).`);
  }

  return interpreter(sortie, chemin);
}

/**
 * Ce que le binaire a rendu, lu — ou la panne, nommée.
 *
 * ─── POURQUOI C'EST UNE FONCTION À PART ───
 *
 * Le refus « this is not a list » était une garde survivante : retirée, aucun cas ne bougeait.
 * Pas parce qu'elle est inutile — parce qu'elle n'était atteignable qu'en faisant rendre au
 * binaire autre chose qu'une liste, ce qu'aucun cas ne peut demander. Sortir l'interprétation
 * de la sortie la rend éprouvable avec une chaîne, sans processus et sans binaire.
 *
 * ─── CE QUE LA GARDE ÉVITE, ET CE N'EST PAS UNE PLANTAGE ───
 *
 * Sans elle, `JSON.parse("{}")` rend un objet, `Array.isArray` n'est pas consulté, et l'objet
 * repart comme une liste de blocs. Les appelants itèrent dessus : zéro bloc, aucune erreur,
 * **un document lu comme s'il était vide**. Une image dont le texte n'a pas été reconnu et une
 * image sans texte se rapporteraient identiquement — et c'est précisément la distinction que le
 * commentaire ci-dessous protège.
 */
export function interpreter(sortie: string, chemin: string): Bloc[] {
  /* Un tableau vide est un FAIT — « j'ai regardé, il n'y a pas de texte ». Une sortie qui ne
     se parse pas est une panne, et les deux ne doivent pas se rapporter pareil. */
  try {
    const blocs = JSON.parse(sortie) as Bloc[];
    if (!Array.isArray(blocs)) throw new Error("this is not a list");
    return blocs;
  } catch (e) {
    throw new Error(`the image reader failed on ${chemin}: returned ${sortie.length} `
      + `character(s) that cannot be read (${(e as Error).message}): `
      + `${JSON.stringify(sortie.slice(0, 120))}`);
  }
}

/**
 * L'angle du document, lu dans les coins plutôt qu'estimé.
 *
 * Ma première version le déduisait par régression des débuts de ligne sur leur hauteur. Elle
 * rendait −38,7° pour 7° réels, et la raison vaut d'être gardée : SUR UN DOCUMENT, LES DÉBUTS
 * DE LIGNE SONT ALIGNÉS — la variable explicative ne varie pas, donc la pente explose. Chaque
 * bloc porte déjà son propre angle dans ses deux coins hauts ; la médiane des blocs assez
 * larges rend 5,9° pour 7° appliqués, ce qui suffit très largement.
 */
export function inclinaison(blocs: Bloc[]): number {
  const angles = blocs.filter((b) => b.trx - b.tlx > 0.05)
    .map((b) => Math.atan2(b.try - b.tly, b.trx - b.tlx))
    .sort((a, b) => a - b);
  return angles.length ? angles[Math.floor(angles.length / 2)]! : 0;
}

/** Le texte du document, remis dans l'ordre de lecture après redressement. */
export function texte(blocs: Bloc[]): string {
  const pente = Math.tan(inclinaison(blocs));
  return [...blocs]
    .sort((a, b) => (a.tly - pente * a.tlx) - (b.tly - pente * b.tlx))
    .map((b) => b.texte).join("\n");
}
