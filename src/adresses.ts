/**
 * LES ADRESSES PUBLIQUES DE L'OUTIL, EN UN SEUL ENDROIT.
 *
 * Le site, la boîte de contact, le dépôt et sa page de démonstration. Chacune était tapée
 * là où elle servait, et le changement de nom du 5 octobre 2026 (Cascade devient Crusetra,
 * cascade-routing.com devient crusetra.com) aurait dû les trouver une à une. Elles vivent
 * ici ; le code les importe, et `adresses.test.ts` refuse qu'une adresse soit retapée
 * ailleurs dans le code ou qu'une ancienne revienne, et vérifie que le README dit les mêmes.
 *
 * Aucune ne se résout aujourd'hui : le domaine, la boîte et le dépôt renommé arrivent avant
 * la publication de cette branche, jamais après. C'est l'ordre qui protège le client.
 */

/** Le site : la page d'engagement et les pages des outils vivent dessous. */
export const SITE = "https://crusetra.com";

/** La page d'engagement que le compteur d'évaluation nomme passé trente jours. */
export const PAGE_ENGAGEMENT = `${SITE}/engagement.html`;

/** La boîte où un client envoie son relevé. */
export const CONTACT = "contact@crusetra.com";

/** Le dépôt public de cet outil. */
export const DEPOT = "https://github.com/ArslaneSempai-ui/crusetra-routing";

/** Sa page de démonstration (GitHub Pages suit le nom du dépôt, sans redirection de l'ancien). */
export const PAGES = "https://arslanesempai-ui.github.io/crusetra-routing/";
