/**
 * Ce qui, dans le dossier racine, EST un relevé de mesure : `profiles-*.json`, et pas le fichier
 * de signature posé à côté (`<releve>.signature.json`, lot du 8/09 : la signature détachée que
 * le Dossier vérifie). Une seule règle pour les deux lecteurs (diff.ts, measure.ts) : le 8/09,
 * chacun portait sa propre expression `/^profiles-.*\.json$/`, et la signature du relevé de
 * référence est entrée dans l'ordre des relevés comme un relevé sans date, ce qui a arrêté
 * `npm run diff` net. Une signature n'est pas un relevé ; elle ne se lit pas comme tel.
 */
export function estNomDeReleve(nom: string): boolean {
  return /^profiles-.*\.json$/.test(nom) && !/\.signature\.json$/.test(nom);
}
