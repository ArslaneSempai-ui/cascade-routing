/**
 * LES GENRES DE FICHIER, SOUS LE NOM NEUF ET SOUS L'ANCIEN.
 *
 * Chaque fichier que cet outil écrit se déclare par un `kind` : le relevé du client, sa
 * recertification, sa trace, les issues notées, le relevé du banc, la table des prix
 * catalogue. Le 5 octobre 2026, Cascade est devenu Crusetra, et ces genres suivent :
 * `cascade-client-record` devient `crusetra-client-record`, et ainsi de suite.
 *
 * LA RÈGLE, EN DEUX MOITIÉS QUI NE SE SÉPARENT PAS :
 *   - un ÉCRIVAIN n'émet que la forme neuve, prise ici et nulle part ailleurs ;
 *   - un LECTEUR accepte les deux, pour toujours, par `estDuGenre`.
 * Pourquoi pour toujours : le `kind` est DANS le scellé. Un relevé envoyé, signé ou publié
 * avant le changement de nom porte l'ancien genre sous son empreinte, et le réécrire
 * casserait l'empreinte. Ces fichiers-là ne se réécrivent jamais ; c'est le lecteur qui
 * se souvient de l'ancien nom. Un lecteur qui oublierait refuserait les relevés que nos
 * clients tiennent déjà, et les nôtres, livrés dans `examples/` et à la racine.
 *
 * Le nom ancien se DÉDUIT du neuf (même suffixe, autre préfixe) : il n'existe pas de
 * seconde liste à tenir à jour, donc pas de genre neuf dont on oublierait l'ancien.
 */

export const GENRES = {
  releveClient: "crusetra-client-record",
  recertification: "crusetra-recertification",
  traceClient: "crusetra-client-trace",
  issues: "crusetra-outcomes",
  releveRoutage: "crusetra-routing-record",
  prixCatalogue: "crusetra-vendor-list-prices",
} as const;

export type Genre = (typeof GENRES)[keyof typeof GENRES];

/** Le même genre sous l'ancien nom de la maison, tel que les relevés d'avant le 5/10/2026 le portent. */
export type AncienGenre<G extends string> = G extends `crusetra-${infer R}` ? `cascade-${R}` : never;

/** Ce qu'un lecteur accepte pour un genre : le nom neuf, ou l'ancien. */
export type GenreLu<G extends Genre> = G | AncienGenre<G>;

export function ancienGenre<G extends Genre>(g: G): AncienGenre<G> {
  return g.replace(/^crusetra-/, "cascade-") as AncienGenre<G>;
}

/** Vrai si `kind` désigne ce genre, sous son nom neuf ou sous l'ancien. Rien d'autre ne passe. */
export function estDuGenre<G extends Genre>(kind: unknown, g: G): kind is GenreLu<G> {
  return kind === g || kind === ancienGenre(g);
}
