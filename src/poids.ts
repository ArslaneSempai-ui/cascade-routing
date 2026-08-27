/**
 * APPORTER LES POIDS SANS RÉSEAU.
 *
 * LE TROU QUE CE FICHIER FERME, ET POURQUOI IL EST PIRE QU'UNE PANNE ORDINAIRE.
 *
 * Cet outil se vend sur une phrase : rien ne sort de la machine du client. Elle est vraie
 * pour les données — elle ne l'était pas pour les poids. Au premier lancement,
 * `pipeline(...)` va chercher 1,3 Go sur `huggingface.co`. Dans une banque, ce domaine est
 * bloqué par défaut, comme la quasi-totalité de ce qui n'a pas été explicitement ouvert.
 *
 * Ce qui se passait alors : un échec réseau brut, sans nommer ce qu'il manquait, sans dire
 * quoi faire. **Le premier écran que voit l'acheteur est une erreur de connexion, sur un
 * produit dont l'argument est qu'il ne dépend de personne.** L'ironie fait plus de dégâts
 * que la panne.
 *
 * LES DEUX MOITIÉS, ET POURQUOI IL EN FAUT DEUX.
 *
 * Un mode « hors ligne » qui se contente de refuser le réseau ne sert à rien : il transforme
 * un échec tardif en échec précoce, et le client reste sans poids. Il faut aussi le chemin
 * par lequel les poids ARRIVENT — un poste qui a le réseau les exporte, une clé ou un partage
 * les transporte, la machine isolée les importe. C'est le geste que ces organisations font
 * déjà tous les jours ; ce qui manquait était de le leur permettre.
 *
 * CE QUE L'IMPORT VÉRIFIE, ET POURQUOI CE N'EST PAS DE LA CÉRÉMONIE.
 *
 * Un poids est un binaire tiers qu'on exécute sur la machine d'une banque, et il vient
 * d'arriver par une clé USB. Trois contrôles, chacun payé par un défaut réel :
 *
 *   1. **L'empreinte de chaque fichier**, pas seulement sa taille. La taille attrape le
 *      téléchargement coupé ; elle n'attrape pas le fichier remplacé.
 *   2. **La révision épinglée.** Des poids exportés depuis une autre version du dépôt se
 *      chargeraient sans un mot et rendraient des chiffres qui ne sont pas ceux qu'on publie.
 *   3. **Tout est vérifié AVANT que quoi que ce soit soit écrit.** Un import qui copie au fur
 *      et à mesure et s'arrête au milieu laisse exactement l'état tronqué qui abat le
 *      processus nativement, sans nommer le fichier — le défaut que `modelesTronques` existe
 *      déjà pour diagnostiquer. Réparer un trou en creusant l'autre n'est pas une réparation.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { isMain } from "./cli.ts";
import { exigerModelesEntiers, POIDS_MODELES, racineDesPoids, type CleModele } from "./tiers.ts";

/** Le nom du manifeste dans le dossier d'export. Un dossier sans lui n'est pas un export. */
export const NOM_MANIFESTE = "cascade-weights.json";

export type EntreeManifeste = {
  cle: CleModele; depot: string; revision: string;
  /** Chemin RELATIF à la racine du cache, avec des barres obliques — un manifeste voyage. */
  chemin: string;
  octets: number; sha256: string;
};
export type Manifeste = { version: 1; entrees: EntreeManifeste[] };

/** Un problème trouvé par la vérification, en anglais parce qu'il s'affiche chez le client. */
export type Grief = { chemin: string; cause: string };

const enMo = (n: number): string => (n / 1_000_000).toFixed(1) + " MB";

/** Toutes les barres deviennent obliques : un manifeste écrit ici s'importe ailleurs. */
const enPosix = (p: string): string => (sep === "/" ? p : p.split(sep).join("/"));

export function empreinte(chemin: string): string {
  return createHash("sha256").update(readFileSync(chemin)).digest("hex");
}

/** Tous les fichiers sous un dossier, chemins relatifs à `base`, triés pour être reproductibles. */
export function fichiersSous(base: string, dossier: string): string[] {
  const abs = join(base, dossier);
  if (!existsSync(abs)) return [];
  const sortie: string[] = [];
  const descendre = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) descendre(p);
      else if (e.isFile()) sortie.push(enPosix(relative(base, p)));
    }
  };
  descendre(abs);
  return sortie;
}

/**
 * Le manifeste de ce qui est réellement sur ce disque, pour les modèles demandés.
 *
 * Il est CONSTRUIT depuis `POIDS_MODELES` et le disque, jamais écrit à la main : une liste de
 * fichiers tapée regarde une collection figée, et rate le fichier que la bibliothèque ajoute
 * à la version suivante.
 */
export function construireManifeste(cles: readonly CleModele[], racine?: string): Manifeste {
  const base = racineDesPoids(racine);
  const entrees: EntreeManifeste[] = [];
  for (const cle of cles) {
    const m = POIDS_MODELES[cle];
    for (const chemin of fichiersSous(base, join(m.depot, m.revision))) {
      const abs = join(base, chemin);
      entrees.push({
        cle, depot: m.depot, revision: m.revision, chemin,
        octets: statSync(abs).size, sha256: empreinte(abs),
      });
    }
  }
  return { version: 1, entrees };
}

/**
 * Ce qui, dans un manifeste, ne correspond pas à ce que ce dépôt attend ou à ce que ce dossier
 * contient. Rend la liste COMPLÈTE : s'arrêter au premier grief oblige le client à refaire le
 * transfert autant de fois qu'il y a de fichiers abîmés.
 */
export function verifierExport(m: Manifeste, dossier: string): Grief[] {
  const griefs: Grief[] = [];
  if (m.version !== 1) griefs.push({ chemin: NOM_MANIFESTE, cause: `manifest version ${m.version} is not 1` });
  if (!Array.isArray(m.entrees) || m.entrees.length === 0) {
    griefs.push({ chemin: NOM_MANIFESTE, cause: "the manifest lists no file" });
    return griefs;
  }
  for (const e of m.entrees) {
    const attendu = POIDS_MODELES[e.cle];
    /* La révision d'abord : des poids justes pour une AUTRE version de ce dépôt se
       chargeraient sans un mot et rendraient des chiffres qui ne sont pas les nôtres. */
    if (!attendu) { griefs.push({ chemin: e.chemin, cause: `unknown model key "${e.cle}"` }); continue; }
    if (e.revision !== attendu.revision) {
      griefs.push({ chemin: e.chemin, cause: `pinned revision is ${attendu.revision}, this file carries ${e.revision}` });
      continue;
    }
    const abs = join(dossier, e.chemin);
    if (!existsSync(abs)) { griefs.push({ chemin: e.chemin, cause: "listed in the manifest, absent from the directory" }); continue; }
    const taille = statSync(abs).size;
    if (taille !== e.octets) {
      griefs.push({ chemin: e.chemin, cause: `is ${enMo(taille)}, manifest says ${enMo(e.octets)} — an interrupted copy` });
      continue;
    }
    const vu = empreinte(abs);
    if (vu !== e.sha256) griefs.push({ chemin: e.chemin, cause: `sha256 is ${vu.slice(0, 16)}…, manifest says ${e.sha256.slice(0, 16)}…` });
  }
  return griefs;
}

export function lireManifeste(dossier: string): Manifeste {
  const chemin = join(dossier, NOM_MANIFESTE);
  if (!existsSync(chemin)) {
    throw new Error(
      `No ${NOM_MANIFESTE} in ${dossier}.\n\n`
      + `  That directory is not a weights export. On a machine that can reach the network,\n`
      + `  run:  npm run poids -- --export <directory>\n`);
  }
  return JSON.parse(readFileSync(chemin, "utf8")) as Manifeste;
}

export function exporter(
  dossier: string, cles: readonly CleModele[], racine?: string,
  /*
   * LE CONTRÔLE D'INTÉGRITÉ EST INJECTABLE POUR ÊTRE ÉPROUVABLE, ET SA VALEUR PAR DÉFAUT EST
   * LA VRAIE. L'export ne charge aucun modèle, donc `exigerModelesEntiers` ne tournait jamais
   * sur ce chemin : un model.onnx tronqué — téléchargement coupé — s'exportait « avec succès »,
   * le manifeste portait la taille tronquée et son sha256 parfaitement cohérent, et l'import
   * sur la machine isolée validait un poids inutilisable. Le sha256 authentifie le transport ;
   * il ne dit RIEN de la source. Audit du 27 août 2026.
   */
  controlerEntiers: (c: readonly CleModele[], r?: string) => void = exigerModelesEntiers,
): Manifeste {
  const base = racineDesPoids(racine);
  controlerEntiers(cles, racine);
  const m = construireManifeste(cles, racine);
  if (m.entrees.length === 0) {
    throw new Error(
      `Nothing to export: no weight file is present for ${cles.join(", ")}.\n\n`
      + `  Run a command that loads the models first, so they land in the cache.\n`);
  }
  for (const e of m.entrees) {
    const cible = join(dossier, e.chemin);
    mkdirSync(dirname(cible), { recursive: true });
    copyFileSync(join(base, e.chemin), cible);
  }
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, NOM_MANIFESTE), JSON.stringify(m, null, 2) + "\n");
  return m;
}

/**
 * Importer, et ne rien écrire tant que TOUT n'est pas vérifié.
 *
 * L'ordre est la seule chose qui compte ici. Copier au fur et à mesure et s'arrêter au
 * premier grief laisse le cache dans l'état exact — des fichiers présents mais incomplets —
 * qui fait s'abattre le processus nativement sans nommer le coupable.
 */
export function importer(dossier: string, racine?: string): { ecrits: number; octets: number } {
  const m = lireManifeste(dossier);
  const griefs = verifierExport(m, dossier);
  if (griefs.length > 0) {
    throw new Error(
      `${griefs.length} problem(s) with the export in ${dossier} — nothing was written.\n\n`
      + griefs.map((g) => `  ${g.chemin}\n    ${g.cause}`).join("\n") + `\n\n`
      + `  Nothing was copied into the cache: a half-written cache crashes the process\n`
      + `  natively, without naming the file. Re-export or re-copy, then run this again.\n`);
  }
  const base = racineDesPoids(racine);
  let octets = 0;
  for (const e of m.entrees) {
    const cible = join(base, e.chemin);
    mkdirSync(dirname(cible), { recursive: true });
    copyFileSync(join(dossier, e.chemin), cible);
    octets += e.octets;
  }
  return { ecrits: m.entrees.length, octets };
}

/**
 * REFUSER AVANT `pipeline(...)` QUAND LE RÉSEAU N'EST PAS UNE OPTION.
 *
 * Sans ce refus, la bibliothèque part chercher 1,3 Go et échoue avec un message de fetch qui
 * ne nomme ni le modèle ni le remède. Le message ci-dessous nomme les deux, et il tient sans
 * nous : le client se débrouille avec, ce qui est le seul genre de message qui serve à
 * quelqu'un qui ne peut pas nous appeler.
 */
export function exigerPoidsSurPlace(cles: readonly CleModele[], racine?: string): void {
  const base = racineDesPoids(racine);
  const manquants = cles.filter((cle) => {
    const m = POIDS_MODELES[cle];
    return !existsSync(join(base, m.depot, m.revision, "onnx", "model.onnx"))
      && !existsSync(join(base, m.depot, "onnx", "model.onnx"));
  });
  if (manquants.length === 0) return;
  const total = manquants.reduce((s, c) => s + POIDS_MODELES[c]!.octets, 0);
  throw new Error(
    `CASCADE_OFFLINE=1 is set and ${manquants.length} model(s) are not on this machine.\n\n`
    + manquants.map((c) => `  ${POIDS_MODELES[c]!.depot}  ${enMo(POIDS_MODELES[c]!.octets)}`).join("\n")
    + `\n\n  ${enMo(total)} in total. Nothing will be downloaded, which is what you asked for.\n\n`
    + `  On a machine that can reach the network, from a clone of this repository:\n`
    + `    npm run poids -- --export /media/usb/cascade-weights\n\n`
    + `  Carry that directory here, then:\n`
    + `    npm run poids -- --import /media/usb/cascade-weights\n\n`
    + `  Every file is checked against its sha256 and against the revision this repository\n`
    + `  pins before anything is written.\n`);
}

/**
 * Cet échec ressemble-t-il à un réseau coupé ?
 *
 * Il est ici, exporté et éprouvé, plutôt qu'en ligne dans le bloc `catch` qui l'utilise :
 * un prédicat enfermé dans un `catch` ne peut pas porter de contre-épreuve, et celle qui
 * compte est la NÉGATIVE — une erreur de modèle réhabillée en problème de proxy enverrait
 * le client fouiller son pare-feu pendant qu'un fichier est corrompu chez lui.
 */
export function ressembleAUnEchecReseau(message: string): boolean {
  /* Les codes d'état sont exigés EN CONTEXTE. Un `\b403\b` nu se déclenche sur « Unexpected
     token in JSON at position 403 » — un fichier corrompu annoncé comme un pare-feu, et le
     client cherche des semaines du mauvais côté. Un chiffre n'est un code d'état que si
     quelque chose à côté dit qu'il en est un. */
  return /fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|network|proxy|tunnel|certificate|Unauthorized|Forbidden|(?:HTTP|status(?:\s*code)?)\D{0,4}\b[45]\d\d\b/i.test(message);
}

/** Ce que le client voit quand la bibliothèque n'a pas pu joindre le réseau. */
export function messageDeTelechargement(cause: unknown, cles: readonly CleModele[]): string {
  const brut = cause instanceof Error ? cause.message : String(cause);
  const total = cles.reduce((s, c) => s + POIDS_MODELES[c]!.octets, 0);
  return `Could not download the model weights.\n\n`
    + `  ${brut}\n\n`
    + `  This tool never sends your data anywhere, but on FIRST RUN it fetches ${enMo(total)}\n`
    + `  of model weights from huggingface.co. On a corporate network that host is usually\n`
    + `  blocked, and that is the likeliest cause of the line above.\n\n`
    + `  Two ways out. Either open huggingface.co and cdn-lfs.huggingface.co through your\n`
    + `  proxy, or bring the weights in by hand and never touch the network again:\n\n`
    + `    elsewhere:  npm run poids -- --export /media/usb/cascade-weights\n`
    + `    here:       npm run poids -- --import /media/usb/cascade-weights\n`
    + `    then:       CASCADE_OFFLINE=1 npm run <your command>\n`;
}

/** L'état des poids sur cette machine, une ligne par modèle. */
export function rapport(racine?: string): string {
  const base = racineDesPoids(racine);
  const lignes: string[] = [];
  for (const cle of Object.keys(POIDS_MODELES) as CleModele[]) {
    const m = POIDS_MODELES[cle];
    const avec = join(base, m.depot, m.revision, "onnx", "model.onnx");
    const sans = join(base, m.depot, "onnx", "model.onnx");
    const chemin = existsSync(avec) ? avec : existsSync(sans) ? sans : undefined;
    const etat = chemin === undefined ? "absent"
      : statSync(chemin).size === m.octets ? "present"
      : `TRUNCATED at ${enMo(statSync(chemin).size)}`;
    lignes.push(`  ${cle.padEnd(9)} ${enMo(m.octets).padStart(8)}  ${etat.padEnd(24)} ${m.depot}`);
  }
  return `Model weights under ${base}\n\n` + lignes.join("\n") + "\n";
}

/*
 * LA DÉTECTION DU POINT D'ENTRÉE VIENT DE `cli.ts`, ELLE NE SE RÉÉCRIT PAS ICI.
 *
 * Cinq modules portaient chacun leur copie de `import.meta.url === pathToFileURL(argv1).href`.
 * Cinq copies d'une comparaison subtile, c'est cinq endroits où se tromper demain — et elles
 * rendent toutes le même résultat le jour où on les écrit, ce qui est ce qui les rend
 * difficiles à voir.
 *
 * Ce que disait le commentaire d'ici et qui reste vrai : le point d'entrée n'agit QUE si ce
 * fichier est la commande lancée. Importé, il ne fait rien — un module qui agit à l'import tue
 * le fichier de test qui l'importe.
 */

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  const modeles = Object.keys(POIDS_MODELES) as CleModele[];
  const valeur = (nom: string): string | undefined => {
    const i = args.indexOf(nom);
    if (i === -1) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) {
      console.error(`${nom} needs a directory.\n`);
      process.exit(2);
    }
    return v;
  };
  const inconnu = args.find((a) => a.startsWith("--") && a !== "--export" && a !== "--import");
  if (inconnu !== undefined) {
    console.error(`Unknown option ${inconnu}. Use --export <dir>, --import <dir>, or no option to report.\n`);
    process.exit(2);
  }
  try {
    const aExporter = valeur("--export");
    const aImporter = valeur("--import");
    if (aExporter !== undefined && aImporter !== undefined) {
      console.error("--export and --import are two different machines. Run one, carry the directory, run the other.\n");
      process.exit(2);
    } else if (aExporter !== undefined) {
      const m = exporter(aExporter, modeles);
      const octets = m.entrees.reduce((s, e) => s + e.octets, 0);
      console.log(`\n${m.entrees.length} file(s), ${enMo(octets)}, written to ${aExporter}`);
      console.log(`Carry that whole directory, then run there:\n  npm run poids -- --import <directory>\n`);
    } else if (aImporter !== undefined) {
      const { ecrits, octets } = importer(aImporter);
      console.log(`\n${ecrits} file(s), ${enMo(octets)}, verified and placed in the cache.`);
      console.log(`Nothing needs the network now. Run your commands with CASCADE_OFFLINE=1.\n`);
    } else {
      console.log("\n" + rapport());
      console.log(`  --export <dir>   copy these weights out, with a sha256 for each file`);
      console.log(`  --import <dir>   verify such a directory and place it in the cache\n`);
    }
  } catch (e) {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
}
