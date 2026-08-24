/**
 * Vérifier qu'un rapport d'audit est authentique et n'a pas été modifié.
 *
 * ─── POURQUOI CE FICHIER EST DANS LE DÉPÔT PUBLIC ───
 *
 * Un rapport qui affirme sa propre authenticité n'affirme rien. La vérification doit pouvoir
 * être faite par quelqu'un qui ne nous fait pas confiance — l'audit interne du client, son
 * commissaire aux comptes, un régulateur — avec un outil qu'il n'a pas à nous demander.
 *
 * Il est donc public, sans aucune dépendance, et il tient dans un fichier qu'un auditeur peut
 * lire en entier avant de le lancer. La clé publique est à côté, dans le même dépôt.
 *
 *     node src/verifier-rapport.mjs <rapport.html>
 *
 * ─── CE QUE LA VÉRIFICATION PROUVE, ET CE QU'ELLE NE PROUVE PAS ───
 *
 * Elle prouve deux choses : que le rapport a été émis par le détenteur de la clé privée, et
 * qu'aucun octet n'a bougé depuis. C'est tout, et c'est écrit dans la sortie — parce qu'un
 * outil qui dit « vérifié » sans dire de quoi laisse le lecteur conclure ce qui l'arrange.
 *
 * Elle ne prouve RIEN sur la justesse des chiffres. Un rapport faux, signé, reste faux ; il
 * devient simplement impossible de prétendre qu'il vient d'ailleurs. La justesse est tenue
 * par autre chose : les mesures, leurs intervalles, et le journal des rétractations.
 *
 * ─── CE QUI EST SIGNÉ : LE DOCUMENT ENTIER ───
 *
 * Pas le seul bloc de données — la première version faisait ça, et le tableau lisible n'était
 * couvert par rien : on pouvait changer un chiffre dans la colonne visible et la vérification
 * restait au vert. Le corps signé est tout ce qui précède le bloc de signature, octet pour
 * octet, style et balises compris.
 *
 * Et on ne reconstruit rien pour comparer. Reconstruire, c'est ouvrir la porte au défaut de
 * canonisation : deux sérialisations du même objet diffèrent d'un espace, et la signature
 * échoue sur un rapport parfaitement valide. Il n'y a rien à canoniser ici.
 */
import { createVerify, createPublicKey, verify as verifierBrut } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DEBUT_DONNEES = '<script type="application/json" id="rapport">';
const DEBUT_SIGNATURE = '<script type="application/json" id="signature">';
const FIN = "</script>";

/** Extrait la chaîne exacte d'un bloc, sans la reconstruire. */
export function bloc(contenu, ouverture) {
  const i = contenu.indexOf(ouverture);
  if (i === -1) return null;
  const j = contenu.indexOf(FIN, i + ouverture.length);
  if (j === -1) return null;
  return contenu.slice(i + ouverture.length, j);
}

/** Le dernier bloc portant cette ouverture — la césure ne doit pas pouvoir être déplacée. */
export function dernierBloc(contenu, ouverture) {
  const i = contenu.lastIndexOf(ouverture);
  if (i === -1) return null;
  const j = contenu.indexOf(FIN, i + ouverture.length);
  if (j === -1) return null;
  return contenu.slice(i + ouverture.length, j);
}

export function empreinteDeCle(pem) {
  return createHash("sha256").update(pem.replace(/\r\n/g, "\n").trim() + "\n").digest("hex").slice(0, 32);
}

/**
 * Le verdict. Il rend un motif quand il refuse : « signature invalide » sans dire laquelle
 * des cinq raisons a joué envoie le lecteur chercher au mauvais endroit.
 */
export function verifier(contenu, clePubliquePem) {
  const donnees = bloc(contenu, DEBUT_DONNEES);
  if (donnees === null) return { valide: false, motif: "aucun bloc de données : ce fichier n'est pas un rapport signé." };
  const brutSignature = dernierBloc(contenu, DEBUT_SIGNATURE);
  if (brutSignature === null) return { valide: false, motif: "le rapport ne porte aucune signature." };

  let sig;
  try { sig = JSON.parse(brutSignature); }
  catch { return { valide: false, motif: "le bloc de signature n'est pas du JSON lisible." }; }
  if (sig.alg !== "Ed25519") return { valide: false, motif: `algorithme « ${sig.alg} » inattendu — seul Ed25519 est reconnu.` };

  const attendue = empreinteDeCle(clePubliquePem);
  if (sig.cle !== attendue) {
    return { valide: false, motif:
      `le rapport est signé par une autre clé que celle de ce dépôt.\n`
      + `  rapport : ${sig.cle}\n  dépôt   : ${attendue}` };
  }

  /*
   * LA SIGNATURE PORTE SUR LE DOCUMENT ENTIER, PAS SUR LE SEUL BLOC DE DONNÉES.
   *
   * La première version ne signait que le JSON embarqué, et le tableau lisible n'était
   * couvert par rien : remplacer un chiffre dans la colonne visible laissait la vérification
   * au vert. Le lecteur voyait un faux chiffre et l'outil confirmait l'authenticité.
   *
   * Le corps signé est tout ce qui précède le bloc de signature. On coupe au DERNIER, pour
   * qu'un bloc ajouté après coup ne puisse pas déplacer la césure.
   */
  const coupe = contenu.lastIndexOf(DEBUT_SIGNATURE);
  const corps = contenu.slice(0, coupe);
  if (corps.length === 0) return { valide: false, motif: "le document signé est vide." };

  let ok;
  try {
    ok = verifierBrut(null, Buffer.from(corps, "utf8"), createPublicKey(clePubliquePem), Buffer.from(sig.valeur, "base64"));
  } catch (e) {
    return { valide: false, motif: `la vérification a échoué : ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!ok) return { valide: false, motif: "la signature ne correspond pas au contenu : le rapport a été modifié après émission." };

  let data;
  try { data = JSON.parse(donnees); }
  catch { return { valide: false, motif: "la signature est bonne mais les données ne sont pas du JSON lisible." }; }
  return { valide: true, donnees: data, octets: Buffer.byteLength(corps, "utf8") };
}

void createVerify;   // gardé pour lisibilité de l'import ; la vérification Ed25519 est sans étage de hachage

function principal() {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error("Usage : node src/verifier-rapport.mjs <rapport.html>\n\n"
      + "Vérifie qu'un rapport d'audit cascade a été émis par le détenteur de la clé\n"
      + "publiée dans ce dépôt, et qu'aucun octet n'a bougé depuis.");
    process.exit(2);
  }
  const cle = readFileSync(fileURLToPath(new URL("../cle-publique.pem", import.meta.url)), "utf8");
  let contenu;
  try { contenu = readFileSync(chemin, "utf8"); }
  catch (e) { console.error(`impossible de lire ${chemin} : ${e instanceof Error ? e.message : e}`); process.exit(2); }

  const r = verifier(contenu, cle);
  if (!r.valide) {
    console.error(`✗ NON VÉRIFIÉ\n\n  ${r.motif}`);
    process.exit(1);
  }
  const d = r.donnees;
  console.log(
    `✓ Signature valide — ${r.octets} octets signés.\n\n`
    + `  Émis le      ${d.emisLe ?? "?"}\n`
    + `  Pour         ${d.client ?? "?"}\n`
    + `  Corpus       ${d.corpus?.empreinte ?? "?"} (${d.corpus?.dossiers ?? "?"} dossiers)\n`
    + `  Outil        ${d.outil?.commit ?? "?"}\n\n`
    + `Ce que ça prouve : le rapport vient du détenteur de la clé de ce dépôt, et aucun\n`
    + `octet n'a bougé depuis son émission.\n\n`
    + `Ce que ça ne prouve pas : que les chiffres sont justes. Un rapport faux et signé\n`
    + `reste faux — il devient seulement impossible d'en attribuer l'origine à quelqu'un\n`
    + `d'autre. La justesse est tenue par les mesures, leurs intervalles, et le journal\n`
    + `des rétractations.`);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
