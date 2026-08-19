/**
 * Les paliers, et rien d'autre.
 *
 * Leur nom vivait dans `tiers.ts`, avec les modèles — donc avec l'import de
 * `@huggingface/transformers`. L'écran a besoin des noms et pas des modèles : les garder
 * ensemble aurait fait descendre un runtime de modèles dans le navigateur pour lire quelques
 * chaînes de caractères. Ce fichier n'importe rien.
 *
 * ─── Pourquoi deux échelles ───
 *
 * Les trois premiers paliers sont des encodeurs : une tête d'extraction, des plongements.
 * Ils pèsent quelques dizaines de mégaoctets, ils tournent partout, et n'importe qui clonant
 * ce dépôt reproduit leurs chiffres en deux minutes sans clé d'API. C'est l'échelle par
 * défaut, et cette propriété-là ne se brade pas.
 *
 * Les trois suivants sont des modèles génératifs locaux, servis par Ollama. Ils répondent à
 * l'objection juste — « ce n'est pas du routage de LLM » — mais ils coûtent huit gigaoctets
 * de téléchargement et un serveur à installer. Ils sont donc optionnels : mesurés une fois,
 * figés dans le profil, et jamais nécessaires pour faire tourner le reste.
 *
 * Les deux échelles cohabitent au lieu de se remplacer parce que la mesure le dit : la
 * meilleure affectation champ par champ traverse les deux familles. Un encodeur spécialisé
 * garde le nom, des règles gratuites gardent trois champs, un modèle génératif prend
 * l'adresse. Interdire le mélange aurait caché la seule conclusion qui compte.
 */

export type TierName =
  | "rules"
  | "small" | "large"                    // encodeurs — l'échelle par défaut
  | "gen-0.6b" | "gen-4b" | "gen-8b"     // génératifs locaux — l'échelle optionnelle
  | "human";

/** L'échelle par défaut : rien à installer, reproductible en deux minutes. */
export const ENCODEURS: TierName[] = ["rules", "small", "large", "human"];

/** L'échelle optionnelle : demande un serveur Ollama et huit gigaoctets de modèles. */
export const GENERATIFS: TierName[] = ["gen-0.6b", "gen-4b", "gen-8b"];

/**
 * Tous les paliers, du moins cher au plus cher.
 *
 * L'ordre n'est pas décoratif : l'écran et plusieurs tests lisent cette liste comme une
 * échelle, et un palier mal placé ferait passer une régression pour une progression.
 */
export const TIERS: TierName[] = [
  "rules", "small", "large", "gen-0.6b", "gen-4b", "gen-8b", "human",
];

/** Un palier qui a besoin d'Ollama, donc d'une installation que ce dépôt n'exige pas. */
export const estGeneratif = (t: TierName): boolean => GENERATIFS.includes(t);
