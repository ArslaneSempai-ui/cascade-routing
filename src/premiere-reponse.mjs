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
 *     git clone … && cd cascade && node src/premiere-reponse.mjs
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

const RACINE = fileURLToPath(new URL("..", import.meta.url));

function lire(nom) {
  const p = join(RACINE, nom);
  if (!existsSync(p)) {
    throw new Error(
      `${nom} is missing.\n\n`
      + "  This relevé ships with the repository. If it is gone, the clone is incomplete —\n"
      + `  restore it with \`git checkout ${nom}\`. Nothing here is typed by hand, so\n`
      + "  without it there is nothing to say.");
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

/* Groupage et pourcentages écrits à la main : `toLocaleString` dépend de la locale de la
   machine, et cette sortie doit être la même partout. */
const nombre = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x) => (x * 100).toFixed(1);

/**
 * La sortie est en ANGLAIS, comme le reste de la façade publique — README, écran, rapport.
 * Les commentaires du dépôt sont en français, les documents que lit un acheteur ne le sont
 * pas. Un dépôt qui change de langue à mi-parcours se lit comme un dépôt abandonné.
 */
export function reponse(exposition, doc) {
  const publie = exposition.points?.find((p) => p.identiqueAuPublie);
  if (!publie) {
    throw new Error("no exposure point matches the published routing: the relevé and the code have diverged.");
  }
  const t = doc.publie?.taux;
  if (!t || !(t.n > 0)) throw new Error("the per-record relevé carries no sample size: there is nothing to report.");

  const rapport = publie.exposition / publie.traitement;
  const b = exposition.seuil;

  const lignes = [
    "",
    "  CASCADE — the question is not which model. It is what being wrong costs.",
    "",
    `  On our corpus of ${t.n} records, the routing we publish returns`,
    `  ${t.successes} COMPLETE records out of ${t.n} — ${pct(t.rate)} %, 95 % CI ${pct(t.low)}–${pct(t.high)} %.`,
    "",
    "  That is the per-RECORD rate, not the per-field average. A record is complete",
    "  or it is not. Averaging across fields flatters: a record missing one field",
    "  still counts as nearly good.",
    "",
    `  That routing costs ${nombre(publie.traitement)} EUR a year to run.`,
    `  What it lets through costs ${nombre(publie.exposition)}.`,
    "",
    `  ${nombre(rapport)} times more. That is where the money is, and it is almost`,
    "  always the variable nobody is measuring.",
    "",
    b ? "  The recommendation only flips if one wrong value costs more than"
      : null,
    b ? `  ${b.bas}–${b.haut}× one blank field. Below that, it holds.` : null,
    "",
    "  ───────────────────────────────────────────────────────────────────────",
    "",
    "  THESE ARE OUR NUMBERS, ON OUR CORPUS. Not yours.",
    "",
    "  You can reproduce them: everything is here, and `npm test` recomputes them.",
    "  That is stronger evidence than a number taken on your own data, which",
    "  nobody else could ever check.",
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
    console.log(reponse(lire("exposition.json"), lire("document.json")));
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
