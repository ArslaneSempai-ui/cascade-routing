/**
 * La première réponse — avant toute installation.
 *
 * ─── LE PROBLÈME QU'ELLE RÉSOUT ───
 *
 * Quelqu'un qui découvre ce dépôt doit décider en une minute s'il vaut la peine d'en passer
 * trente. Or la première chose que le dépôt lui demande est un `npm install` qui télécharge
 * des modèles : cinq minutes avant le premier chiffre, et le chiffre arrive trop tard.
 *
 * Ce fichier n'a AUCUNE dépendance. Il lit les relevés scellés livrés avec le dépôt et rend
 * la conclusion en moins d'une seconde, sur un clone frais où `node_modules` n'existe pas.
 *
 *     git clone https://github.com/ArslaneSempai-ui/crusetra-routing && cd crusetra-routing && node src/premiere-reponse.mjs
 *
 * ─── AUCUN CHIFFRE N'EST ÉCRIT ICI ───
 *
 * Tout vient des relevés. Un texte d'accueil qui recopie des chiffres est le premier à
 * mentir : il est lu par tout le monde et relu par personne, et il continue d'affirmer des
 * valeurs remesurées depuis. Si un relevé bouge, cette sortie bouge avec lui ; s'il manque,
 * elle refuse de parler plutôt que d'inventer.
 *
 * ─── ET ELLE DIT À QUI SONT LES CHIFFRES ───
 *
 * Ce sont les nôtres, sur notre corpus. Un prospect peut les REPRODUIRE, ce qui vaut mieux
 * qu'un nombre pris sur ses propres données que personne d'autre ne peut contrôler. Mais ce
 * ne sont pas les siens, et la sortie le dit avant de dire autre chose.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHash, createPublicKey, verify as verifierBrut } from "node:crypto";

const RACINE = fileURLToPath(new URL("..", import.meta.url));

function lire(nom) {
  const p = join(RACINE, nom);
  if (!existsSync(p)) {
    throw new Error(
      `${nom} is missing.\n\n`
      + "  This reading ships with the repository. If it is gone, the clone is incomplete.\n"
      + `  Restore it with \`git checkout ${nom}\`. Nothing here is typed by hand, so\n`
      + "  without it there is nothing to say.");
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

/*
 * LE SCEAU, RECALCULÉ ICI SANS RIEN IMPORTER. C'est l'algorithme d'empreinte.ts (la même
 * fonction dans les cinq outils) : JSON canonique, clés triées, `empreinte` retirée à la
 * racine seulement, SHA-256, seize hexadécimaux. Recopié plutôt qu'importé parce que ce fichier
 * tourne sans node_modules et avant toute installation ; un test compare les deux sur le relevé.
 */
function canonique(x, racine = true) {
  if (Array.isArray(x)) return x.map((v) => canonique(v, false));
  if (x && typeof x === "object") {
    return Object.keys(x).sort().reduce((a, k) => { if (!(racine && k === "empreinte")) a[k] = canonique(x[k], false); return a; }, {});
  }
  return x;
}
export function sceauDe(releve) {
  return createHash("sha256").update(JSON.stringify(canonique(releve))).digest("hex").slice(0, 16);
}

/*
 * LES REÇUS D'ABORD (Arslane, 4 octobre 2026) : le relevé public des 100 reçus CORD, scellé et
 * SIGNÉ. Le sceau est recalculé, la signature détachée est vérifiée sur ses octets contre la clé
 * publique du dépôt ; si l'un des deux ne tient pas, le texte refuse de citer un chiffre.
 */
export function recus(releve, signature, clePubliquePem, devise) {
  const sceau = sceauDe(releve);
  if (releve.empreinte !== sceau) throw new Error(`the receipts record carries seal ${releve.empreinte} and its content hashes to ${sceau}: edited after sealing, nothing is quoted from it.`);
  let ok = false;
  try { ok = verifierBrut(null, Buffer.from(sceau, "utf8"), createPublicKey(clePubliquePem), Buffer.from(String(signature.valeur ?? ""), "base64")); } catch { ok = false; }
  if (!ok) throw new Error("the receipts record's signature does not verify against cle-publique.pem: nothing is quoted from it.");
  const a = releve.audit;
  const champs = Object.keys(a.fields);
  const courant = a.cost.current?.chain;
  const lignes = [`  ON ${releve.source.cases} REAL RECEIPTS (CORD v2 test split, public), what each source read right:`, ""];
  for (const champ of champs) {
    const s = a.fields[champ].sources;
    const noms = Object.keys(s).filter((n) => s[n].accuracy !== null && s[n].accuracy !== undefined).sort((x, y) => s[y].accuracy - s[x].accuracy);
    lignes.push(`  ${champ.padEnd(9)} ` + noms.slice(0, 4).map((n) => `${n} ${pct(s[n].accuracy)} %`).join("   ") + (noms.length > 4 ? `   (${noms.length - 4} more in the record)` : ""));
  }
  lignes.push("", `  Routing within the declared margin: ${champs.map((c) => `${c} to ${a.routing[c]}`).join(", ")}.`);
  if (a.cost.annual) {
    /* The currency is the one the exposure reading declares (`usd/period`), read by the caller:
       the receipts record carries none of its own, and this text never types one. */
    lignes.push(`  At ${nombre(a.cost.annual.pagesPerYear)} pages a year, on the prices declared for this sample: ${nombre(a.cost.annual.current)} ${devise} today`
      + ` (${courant}), ${nombre(a.cost.annual.recommended)} ${devise} routed, ${nombre(a.cost.annual.saving)} ${devise} saved. Declared prices, not measured.`);
  }
  lignes.push(`  Record ${releve.empreinte}, sealed and signed; the signature verifies against cle-publique.pem.`);
  return lignes;
}

/* Groupage et pourcentages écrits à la main : `toLocaleString` dépend de la locale de la
   machine, et cette sortie doit être la même partout. */
const nombre = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x) => (x * 100).toFixed(1);
/* The period is a phrase the reading carries ("100000 documents"); its leading integer is
   grouped like every other figure printed here, and the words are kept as written. */
const grouperLaPeriode = (s) => String(s).replace(/^(\d+)(?=\s|$)/, (d) => nombre(Number(d)));

/**
 * La sortie est en ANGLAIS, comme le reste de la façade publique — README, écran, rapport.
 * Les commentaires du dépôt sont en français, les documents que lit un acheteur ne le sont
 * pas. Un dépôt qui change de langue à mi-parcours se lit comme un dépôt abandonné.
 */
export function reponse(exposition, doc, recusSignes = null) {
  const publie = exposition.points?.find((p) => p.identiqueAuPublie);
  if (!publie) {
    throw new Error("no exposure point matches the published routing: the reading and the code have diverged.");
  }
  const t = doc.publie?.taux;
  if (!t || !(t.n > 0)) throw new Error("the per-record reading carries no sample size: there is nothing to report.");

  const rapport = publie.exposition / publie.traitement;
  const b = exposition.seuil;

  /*
   * L'UNITÉ SE LIT, ELLE NE SE TAPE PAS — ET CETTE LIGNE-CI EN A INVENTÉ DEUX.
   *
   * Elle annonçait « ${traitement} EUR a year ». Le modèle déclare `usd/period`, et une
   * période vaut `volume` documents. Donc la devise était fausse, ET la période était
   * inventée : rien nulle part ne dit qu'un an s'écoule. Deux erreurs dans quatre mots,
   * sur la toute première phrase chiffrée qu'un acheteur lit d'un clone frais.
   *
   * Et le prix de l'audit est libellé en dollars. Le délai de retour vendu en première page
   * du rapport est exposition ÷ prix : une exposition lue en euros contre un prix en dollars
   * fausse d'environ un dixième le seul chiffre qui justifie l'achat.
   *
   * Ce fichier n'a AUCUNE dépendance et ne peut donc pas importer la table des unités. Il la
   * lit dans le relevé, qui la porte depuis. Et s'il ne la trouve pas il se TAIT plutôt que
   * de reconstituer : une reconstitution est exactement ce qui a écrit « EUR ».
   */
  const u = exposition.unites;
  if (!u?.traitement || !u?.exposition || !exposition.periode) {
    throw new Error(
      "exposition.json carries figures without their unit.\n\n"
      + "  This text refuses to name a currency the reading does not state. The last time it\n"
      + "  guessed, it printed euros for dollars and a year for a period nothing defines.\n"
      + "  Regenerate the reading with the component that produces it.");
  }
  if (u.traitement !== u.exposition) {
    throw new Error(`the two figures do not share a unit (${u.traitement} vs ${u.exposition}): they cannot be compared.`);
  }
  /* « usd/period » → « USD », « period ». Le dénominateur est nommé à part parce que c'est
     lui qui a menti, et qu'un lecteur ne le reconstitue pas depuis la devise seule. */
  const [devise, denominateur] = String(u.traitement).split("/");
  const DEVISE = devise.toUpperCase();
  const lesRecus = recusSignes ? recus(recusSignes.releve, recusSignes.signature, recusSignes.clePubliquePem, DEVISE) : null;

  const lignes = [
    "",
    "  CRUSETRA ROUTING measures what a wrong value costs, field by field.",
    "",
    ...(lesRecus ? [...lesRecus, "", "  ───────────────────────────────────────────────────────────────────────", "", "  AND ON OUR OWN KYC CORPUS:", ""] : []),
    `  On our corpus of ${t.n} records, the routing we publish returns`,
    `  ${t.successes} COMPLETE records out of ${t.n}: ${pct(t.rate)} %, 95 % CI ${pct(t.low)} % to ${pct(t.high)} %.`,
    "",
    "  That is the per-RECORD rate, not the per-field average. A record is complete",
    "  or it is not. Averaging across fields flatters: a record missing one field",
    "  still counts as nearly good.",
    "",
    `  That routing costs ${nombre(publie.traitement)} ${DEVISE} per ${denominateur} to run.`,
    `  What it lets through costs ${nombre(publie.exposition)} ${DEVISE}.`,
    `  A ${denominateur} is ${grouperLaPeriode(exposition.periode)}. No calendar year is measured here.`,
    "",
    `  ${nombre(rapport)} times more.`,
    "",
    b ? "  The recommendation only flips if one wrong value costs more than"
      : null,
    b ? `  ${b.bas} to ${b.haut}× one blank field. Below that, it holds.` : null,
    "",
    "  ───────────────────────────────────────────────────────────────────────",
    "",
    "  THESE ARE OUR NUMBERS, ON OUR CORPUS, not yours.",
    "",
    "  The per-record figures recompute from the shipped profile, and `npm test` holds",
    "  them. The two cost figures are read from exposition.json, which a component",
    "  outside this repository produces from that same profile; commits-reecrits.json",
    "  says where the commits those files name went.",
    "",
    "  Your numbers need your records. That is what the audit is for.",
    "",
    "  Further, still with nothing installed:",
    "    cat VALIDATION.md      what was measured, and how",
    "    cat SECURITE.md        the attack surface, checked",
    "    cat LICENCES.md        what this repository ships, and under which licence",
    "    cat retractations.json every conclusion we published and had to withdraw",
    "",
  ];
  /* On enlève les lignes ABSENTES (null), pas les lignes VIDES. La première version filtrait
     `!== ""` et écrasait toute la respiration du texte : trente lignes collées. */
  return lignes.filter((l) => l !== null).join("\n");
}

function principal() {
  try {
    const recusSignes = { releve: lire("examples/cord-receipts/cord-labels-grouped-measured.json"),
      signature: lire("examples/cord-receipts/cord-labels-grouped-measured.signature.json"),
      clePubliquePem: readFileSync(join(RACINE, "cle-publique.pem"), "utf8") };
    console.log(reponse(lire("exposition.json"), lire("document.json"), recusSignes));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

/**
 * Ce module est-il le point d'entrée ?
 *
 * `import.meta.url === \`file://${process.argv[1]}\`` compare une URL à un chemin. Ils
 * coïncident tant que le chemin ne contient ni espace ni accent ; dès qu'il en contient, l'URL
 * porte `%20` et la comparaison échoue. Le programme se termine alors SANS RIEN FAIRE, code 0.
 *
 * Trouvé le 24 août 2026 par une session de contrôle : le dépôt rangé dans un dossier nommé
 * « Mes Rapports 2026 », le vérificateur de rapport rend 0 et n'imprime rien — donc tout
 * `… && echo VÉRIFIÉ` imprime VÉRIFIÉ. Un outil de sécurité muet est pire qu'un outil absent.
 */
function estLancéDirectement() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
}

if (estLancéDirectement()) principal();
