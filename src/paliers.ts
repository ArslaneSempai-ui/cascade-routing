/**
 * Les quatre paliers, et rien d'autre.
 *
 * Leur nom vivait dans `tiers.ts`, avec les modèles — donc avec l'import de
 * `@huggingface/transformers`. L'écran a besoin des noms et pas des modèles : les garder
 * ensemble aurait fait descendre un runtime de modèles dans le navigateur pour lire quatre
 * chaînes de caractères. Ce fichier n'importe rien.
 */

export type TierName = "rules" | "small" | "large" | "human";

export const TIERS: TierName[] = ["rules", "small", "large", "human"];
