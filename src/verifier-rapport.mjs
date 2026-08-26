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
 *     node src/verifier-rapport.mjs <rapport.html> --cle=<clé obtenue ailleurs>
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
import { isMain } from "./cli.ts";
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
  if (donnees === null) return { valide: false, motif: "no data block: this file is not a signed report." };
  if (contenu.lastIndexOf(DEBUT_SIGNATURE) === -1) return { valide: false, motif: "the report carries no signature." };

  /*
   * LA FIN DU BLOC SE TROUVE AVEC LA RÈGLE DU NAVIGATEUR, PAS AVEC UNE ÉGALITÉ DE CHAÎNE.
   *
   * `indexOf("</script>")` cherche neuf caractères exacts. Un navigateur, lui, ferme un
   * `<script>` sur `</script` suivi d'un espace, d'une tabulation, d'un saut de ligne, d'un
   * `/` ou d'un `>`. Les deux frontières divergent, et c'est tout l'espace de l'attaque :
   * une charge glissée derrière `</script >` — avec espace — reste dans les octets EXCLUS
   * pour le vérificateur, et se fait RENDRE par le navigateur. Quatre fermetures valides
   * passaient ; vérifié dans un navigateur, l'écran affichait 96,7 % et 480 000 EUR pendant
   * que la vérification imprimait une sortie identique au rapport authentique.
   *
   * On prend donc la première fermeture que le NAVIGATEUR reconnaîtrait. Tout ce qui la suit
   * entre dans les octets signés.
   */
  const debut = contenu.lastIndexOf(DEBUT_SIGNATURE);
  const apres = contenu.slice(debut + DEBUT_SIGNATURE.length);
  const m = apres.match(/<\/script[\s/>]/i);
  if (!m) return { valide: false, motif: "the signature block is never closed." };
  const finBloc = debut + DEBUT_SIGNATURE.length + m.index;
  const finFermeture = finBloc + apres.slice(m.index).indexOf(">") + 1;
  if (finFermeture <= finBloc) return { valide: false, motif: "the signature block's closing tag is truncated." };

  /*
   * ET LE BLOC NE PEUT CONTENIR AUCUN « < ».
   *
   * Une signature authentique est faite de base64, d'hexadécimal et de quelques mots fixes :
   * aucun `<` n'y a sa place. L'interdire ferme d'un coup toute cette famille — le rembourrage
   * qui rouvre une balise, celui qui en ouvre une autre, et celui qui glisse une table. Une
   * garde qui interdit ce qui ne devrait jamais arriver vaut mieux qu'une garde qui essaie de
   * suivre les règles d'analyse d'un navigateur.
   */
  if (contenu.slice(debut + DEBUT_SIGNATURE.length, finBloc).includes("<")) {
    return { valide: false, motif:
      "the signature block contains a \"<\": an authentic signature never carries one.\n"
      + "  That character is what reopens a tag from inside the excluded bytes." };
  }

  const brutSignature = contenu.slice(debut + DEBUT_SIGNATURE.length, finBloc);

  let sig;
  try { sig = JSON.parse(brutSignature); }
  catch { return { valide: false, motif: "the signature block is not readable JSON." }; }
  if (sig.alg !== "Ed25519") return { valide: false, motif: `unexpected algorithm "${sig.alg}" — only Ed25519 is recognised.` };

  /*
   * ─── THE SIGNATURE BLOCK IS THE ONE PLACE THE SIGNATURE CANNOT COVER ───
   *
   * The signed body is the whole document minus this block, which is what closes the entire
   * "append something after the signature" family. But it leaves this block itself as a
   * region of bytes that no signature covers, by construction — and until now anything could
   * be added inside it.
   *
   * Found by a peer session on the fifteenth forgery attempt, after fourteen were refused. It
   * is not a forgery: nothing displays, and `<` is already rejected a few lines above, so the
   * bytes are inert. But they are UNSIGNED BYTES INSIDE A DOCUMENT PRESENTED AS VERIFIED, and
   * they stop being inert the day anything reads a field of `sig` other than the three
   * expected ones — a future version of this verifier, a tool that indexes reports, a reader
   * who opens the JSON.
   *
   * An inert channel is still a channel. Three keys are expected; a fourth is refused, and
   * named, so that adding one is a deliberate act rather than something that slips through.
   */
  const ATTENDUES = ["alg", "cle", "valeur"];
  const inconnues = Object.keys(sig).filter((k) => !ATTENDUES.includes(k));
  if (inconnues.length > 0) {
    return { valide: false, motif:
      `the signature block carries ${inconnues.length} field(s) nothing signs: ${inconnues.join(", ")}.\n`
      + `  Only ${ATTENDUES.join(", ")} are expected. The signed body is the whole document\n`
      + "  EXCEPT this block, so anything added here travels unsigned inside a document that\n"
      + "  presents itself as verified." };
  }

  const attendue = empreinteDeCle(clePubliquePem);
  if (sig.cle !== attendue) {
    return { valide: false, motif:
      `this report is signed by a key other than the one in this repository.\n`
      + `  report     : ${sig.cle}\n  repository : ${attendue}` };
  }

  /*
   * LA SIGNATURE PORTE SUR LE DOCUMENT ENTIER, PAS SUR LE SEUL BLOC DE DONNÉES.
   *
   * La première version ne signait que le JSON embarqué, et le tableau lisible n'était
   * couvert par rien : remplacer un chiffre dans la colonne visible laissait la vérification
   * au vert. Le lecteur voyait un faux chiffre et l'outil confirmait l'authenticité.
   *
   * Le corps signé est le document PRIVÉ de son bloc de signature — ce qui précède ET ce qui
   * suit. On coupe au DERNIER bloc, pour qu'un bloc ajouté après coup ne déplace pas la
   * césure. Ne signer que ce qui précède laissait un `<style>` ajouté à la fin réécrire les
   * chiffres affichés sans casser la signature.
   */
  /*
   * LA SIGNATURE A UN DÉBUT ET UNE FIN.
   *
   * La version précédente signait « tout ce qui précède le bloc de signature ». Ce qui SUIT
   * n'était donc couvert par rien — et il suffit d'ajouter un `<style>` après pour réécrire
   * un chiffre du tableau d'origine avec `::after` et `visibility`, sans toucher un seul
   * octet signé. Une session de contrôle l'a fait : mesure publiée 76,7 %, écran 96,7 %, et
   * le vérificateur imprimait « aucun octet n'a bougé » — sortie identique au caractère près
   * à celle du rapport authentique.
   *
   * Le contenu signé est donc le document PRIVÉ DE SON SEUL BLOC DE SIGNATURE : ce qui
   * précède, plus ce qui suit. Un octet ajouté n'importe où tombe dans l'un des deux.
   */
  const corps = contenu.slice(0, debut) + contenu.slice(finFermeture);
  if (corps.trim().length === 0) return { valide: false, motif: "the signed document is empty." };

  let ok;
  try {
    ok = verifierBrut(null, Buffer.from(corps, "utf8"), createPublicKey(clePubliquePem), Buffer.from(sig.valeur, "base64"));
  } catch (e) {
    return { valide: false, motif: `verification failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!ok) return { valide: false, motif: "the signature does not match the content: this report was altered after it was issued." };

  let data;
  try { data = JSON.parse(donnees); }
  catch { return { valide: false, motif: "the signature is good but the data is not readable JSON." }; }
  return { valide: true, donnees: data, octets: Buffer.byteLength(corps, "utf8") };
}

void createVerify;   // gardé pour lisibilité de l'import ; la vérification Ed25519 est sans étage de hachage

function principal() {
  const args = process.argv.slice(2);
  /*
   * TOUT CE QUI COMMENCE PAR `--` ET QU'ON NE LIT PAS EST REFUSÉ.
   *
   * Une option ignorée en silence rend un verdict qui répond à une autre question que celle
   * posée — et ici la question est « ce rapport est-il authentique ». Une faute de frappe sur
   * `--cle` ferait vérifier contre la clé du dépôt en croyant vérifier contre la sienne.
   */
  const inconnues = args.filter((a) => a.startsWith("--") && !a.startsWith("--cle="));
  if (inconnues.length) {
    console.error(`Unknown option(s): ${inconnues.join(", ")}\n\n`
      + `  Accepted: --cle=<public-key.pem>\n`
      + `  Nothing was verified: a mistyped option would have checked against a different\n`
      + `  key than the one you meant.`);
    process.exit(2);
  }
  const chemin = args.find((a) => !a.startsWith("--"));
  if (!chemin) {
    console.error("Usage: node src/verifier-rapport.mjs <report.html> [--cle=<public-key.pem>]\n\n"
      + "Checks that a cascade audit report was issued by the holder of a given public key,\n"
      + "and that no byte has changed since. Without --cle, the key published in this\n"
      + "repository is used.");
    process.exit(2);
  }
  /*
   * ─── POURQUOI LA CLÉ SE DÉSIGNE ───
   *
   * Un rapport et la clé qui le vérifie, livrés tous les deux par nous, forment un cercle :
   * qui remplace l'un peut remplacer l'autre. L'auditeur qui a obtenu notre clé par un autre
   * canal — une empreinte lue au téléphone, un dépôt de clés, un contrat signé — doit pouvoir
   * la lui donner sans éditer ce fichier. C'est la différence entre « vérifiable » et
   * « vérifiable par quelqu'un qui ne nous fait pas confiance », et la seconde est la seule
   * qui vaille quelque chose.
   *
   * Le défaut reste la clé du dépôt : le chemin court continue de marcher.
   */
  const cheminCle = args.find((a) => a.startsWith("--cle="))?.slice("--cle=".length);
  let cle;
  try {
    cle = readFileSync(cheminCle ?? fileURLToPath(new URL("../cle-publique.pem", import.meta.url)), "utf8");
  } catch (e) {
    console.error(`Cannot read the public key ${cheminCle ?? "shipped with this repository"}: `
      + `${e && e.code === "ENOENT" ? "no such file" : (e instanceof Error ? e.message : String(e))}.\n\n`
      + `  Nothing was verified.`);
    process.exit(2);
  }
  let contenu;
  try { contenu = readFileSync(chemin, "utf8"); }
  catch (e) {
    /* Le message d'exécution de Node dit « ENOENT » et le chemin deux fois. On dit ce qui
       s'est passé et ce que ça n'est PAS : un fichier illisible n'est pas un rapport invalide,
       et confondre les deux ferait conclure à une falsification. */
    const raison = (e && e.code === "ENOENT") ? "no such file"
      : (e && e.code === "EISDIR") ? "that is a directory, not a file"
      : (e && e.code === "EACCES") ? "permission denied"
      : (e instanceof Error ? e.message : String(e));
    console.error(`Cannot read ${chemin}: ${raison}.\n\n`
      + `  Nothing was verified. This is not a failed verification — it is a file that could\n`
      + `  not be opened.`);
    process.exit(2);
  }

  const r = verifier(contenu, cle);
  if (!r.valide) {
    console.error(`✗ NOT VERIFIED\n\n  ${r.motif}`);
    process.exit(1);
  }
  const d = r.donnees;
  console.log(
    `✓ Signature valid — ${r.octets} bytes signed.\n\n`
    + `  Issued      ${d.emisLe ?? "?"}\n`
    + `  For         ${d.client ?? "?"}\n`
    + `  Corpus      ${d.corpus?.empreinte ?? "?"} (${d.corpus?.dossiers ?? "?"} records)\n`
    + `  Tool        ${d.outil?.commit ?? "?"}\n\n`
    + `What this proves: the report comes from the holder of this repository's key, and no\n`
    + `byte has changed since it was issued.\n\n`
    + `What it does not prove: that the numbers are right. A false report, signed, is still\n`
    + `false — it merely becomes impossible to attribute it to anyone else. Correctness is\n`
    + `held by the measurements, their intervals, and the retraction log.`);
}

/*
 * LA DÉTECTION DU POINT D'ENTRÉE VIENT DE `cli.ts`, ELLE NE SE RÉÉCRIT PAS ICI.
 *
 * Cinq modules portaient chacun leur copie de `import.meta.url === pathToFileURL(argv1).href`,
 * chacune avec son commentaire expliquant le piège URL-contre-chemin. Cinq copies d'une
 * comparaison subtile, c'est cinq endroits où se tromper demain et une correction à faire cinq
 * fois — et elles rendent toutes le même résultat le jour où on les écrit, ce qui est
 * exactement ce qui les rend difficiles à voir.
 *
 * `isMain` est éprouvé équivalent avant ce remplacement, sur les quatre cas qui séparent les
 * deux formes : chemin accentué avec espaces, invocation relative, et lien symbolique — où les
 * deux rendent `false`.
 */

if (isMain(import.meta)) principal();
