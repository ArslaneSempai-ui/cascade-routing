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
  const manque = ceQuiManque();
  if (manque) throw new Error(manque);
  return JSON.parse(execFileSync(BINAIRE, [chemin], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
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
