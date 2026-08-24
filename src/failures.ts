/**
 * What this thing gets wrong, and why.
 *
 * Every tool in this set reports an aggregate accuracy. None of them showed a single
 * failure. That is the wrong way round: "83 % correct" is a claim a reader has to take on
 * trust, while six named inputs with the model's actual output beside the expected one is
 * something they can check.
 *
 * It is also the difference between having written a system and having run one. Anyone
 * who has put a model in front of real work can tell you its failure modes from memory;
 * anyone who has only measured it quotes a percentage.
 *
 * Nothing here is curated for flattery. The gallery takes the first failures it finds, in
 * order, and groups them by what actually went wrong.
 */

import { generateRecords, FIELDS } from "./corpus.ts";
import { loadavg } from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REVISIONS } from "./tiers.ts";
import { etatMachine, MEMOIRE_LIBRE_MINIMALE_MO } from "./contrainte.ts";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { ENCODEURS, GENERATIFS, TIERS, loadExtractors, extract, correct } from "./tiers.ts";
import type { TierName } from "./tiers.ts";
import type { Field } from "./corpus.ts";

export type Failure = {
  tier: TierName;
  field: Field;
  recordId: string;
  text: string;
  expected: string;
  got: string;
  /** What kind of wrong this is. The grouping is the useful part. */
  mode: "empty" | "fragment" | "wrong span" | "over-long" | "other";
};

/**
 * Naming the failure mode.
 *
 * A model that returns nothing has a different problem from one that returns half the
 * address, and the fix is different too. Counting them together as "errors" hides the
 * only thing worth knowing.
 */
export function classify(got: string, expected: string): Failure["mode"] {
  const g = got.trim().toLowerCase(), e = expected.trim().toLowerCase();
  if (g.length === 0) return "empty";
  if (e.includes(g) && g.length > 0) return "fragment";
  if (g.includes(e)) return "over-long";
  // Something was returned, from elsewhere in the text.
  return g.split(/\s+/).some((w) => w.length > 3 && !e.includes(w)) ? "wrong span" : "other";
}

/**
 * Les échecs, palier par palier.
 *
 * Par défaut l'échelle des encodeurs seulement, et c'est un choix de proportion : inclure
 * les paliers génératifs coûte dix-huit cents appels à un serveur local pour composer une
 * galerie de README. Un `npm run failures -- --llm` les ajoute quand on les veut vraiment.
 *
 * Ce n'est pas une optimisation cosmétique. La première version itérait tous les paliers
 * déclarés, et comme la liste est passée de quatre à sept elle s'est mise à taper sur Ollama
 * pendant qu'une mesure y tournait — deux travaux se disputant le même GPU, tous deux
 * ralentis, aucun des deux en erreur.
 */
/*
 * LA GALERIE SE CALCULE UNE FOIS, ET SON CACHE PORTE L'EMPREINTE DE SES ENTRÉES.
 *
 * `collect()` faisait 1 800 appels de modèle — 120 cas × 5 champs × 3 paliers — À CHAQUE
 * EXÉCUTION, y compris en mode `--check`, où l'on veut seulement savoir si le README
 * correspond au code. Trois conséquences, une seule visible :
 *   — `npm run test`, la première commande recommandée, téléchargeait 722 Mo de poids et
 *     mourait en douze secondes derrière un proxy d'entreprise ;
 *   — 59 des 103 secondes de la suite y passaient ;
 *   — chaque passe écrivait un journal de 400 Kio que rien ne purge.
 *
 * Le calcul est pourtant DÉTERMINISTE : le corpus est engendré d'une graine fixe, les
 * modèles sont épinglés par révision, le correcteur est du code. Le mettre en cache est
 * donc légitime — et c'est justement ce qui le rend dangereux. Un cache qui ne porte pas
 * l'empreinte de son entrée est un générateur de faux résultats REPRODUCTIBLES : il rend
 * toujours la même chose, donc il inspire confiance, et il peut être périmé depuis des
 * semaines sans que rien ne le dise.
 *
 * La clé couvre donc tout ce qui décide du résultat, y compris LE CODE. Les révisions de
 * modèles et la graine du corpus ne suffisent pas : changer une règle dans `tiers.ts` change
 * la galerie sans changer aucun paramètre. On hache donc aussi le texte des trois modules
 * qui produisent le résultat. C'est grossier et c'est exact — un faux positif fait
 * recalculer, un faux négatif publierait une galerie qui ne correspond plus au code.
 *
 * Et si la clé diffère, on RECALCULE. Jamais servir un cache dont on sait qu'il ne
 * correspond pas : ce serait remplacer une lenteur par un mensonge.
 */
const GALERIE = fileURLToPath(new URL("../failures-reference.json", import.meta.url));

/*
 * `fileURLToPath`, PAS `.pathname` — ET PAS DE `catch`. Deux fautes dans quatre lignes,
 * trouvées par une relecture croisée le jour même.
 *
 * `.pathname` conserve le pourcent-encodage : sur un chemin qui porte une espace ou un
 * caractère non-ASCII, il rend « /tmp/dossier%20avec%20espace/x.ts » et la lecture échoue.
 * Mesuré. Avec le `catch { return "" }` d'origine, les trois lectures rendaient la chaîne
 * vide, et la composante « code » de la clé devenait une CONSTANTE STABLE : changer une
 * règle d'extraction ne changeait plus la clé, donc le cache n'était plus jamais invalidé.
 * Le générateur de faux résultats reproductibles que cette clé existe pour empêcher, obtenu
 * par la garde elle-même — une garde qui DÉGRADE EN CONSTANTE au lieu d'échouer.
 *
 * Et ce n'est pas théorique : `clone-neuf.mjs` clone dans un dossier temporaire, et le jour
 * où ce chemin porte une espace, la garantie vendable mesure avec une clé aveugle.
 *
 * Le `catch` part avec. Un scellé qui se calcule quand même sur une entrée manquante ne
 * scelle rien — c'est le relevé sans somme de contrôle, déplacé d'un cran. Si une source est
 * illisible, l'empreinte ne doit pas exister.
 */
/*
 * LA FERMETURE TRANSITIVE DES IMPORTS, ET NON UNE LISTE ÉCRITE À LA MAIN.
 *
 * Première version : `["tiers.ts", "corpus.ts", "failures.ts"]`. Une relecture croisée a
 * montré le trou en le mesurant — `paliers.ts` décide du chemin d'extraction
 * (`estGeneratif`, `GENERATIFS`, `ENCODEURS` y vivent, et `tiers.ts:291` s'y branche), et
 * n'était pas hachée. Déplacer `large` de `ENCODEURS` vers `GENERATIFS` change le résultat
 * de tous les cas, et la clé ne bougeait pas : la galerie périmée était servie comme
 * fraîche.
 *
 * On n'ajoute donc pas `paliers.ts` à la liste : UNE LISTE ÉCRITE À LA MAIN AURA TOUJOURS UN
 * FICHIER DE RETARD, et la prochaine extraction d'un module vers un fichier tiers rouvrirait
 * le trou en silence — sans que rien ne casse, ce qui est le pire des cas. On suit les
 * imports depuis ce fichier, en profondeur, et tout module atteint entre dans l'empreinte.
 *
 * Pas de `catch` : un module illisible doit empêcher l'empreinte d'exister, jamais la
 * laisser se calculer sur une entrée manquante. C'est la même règle que le scellé du relevé.
 */
export function modulesAtteints(entree: string): string[] {
  const vus = new Set<string>();
  const aVoir = [fileURLToPath(new URL(entree, import.meta.url))];
  const RELATIF = /\bfrom\s+["'](\.[^"']+)["']/g;
  while (aVoir.length) {
    const chemin = aVoir.pop()!;
    if (vus.has(chemin)) continue;
    vus.add(chemin);
    for (const m of readFileSync(chemin, "utf8").matchAll(RELATIF)) {
      const cible = fileURLToPath(new URL(m[1]!, pathToFileURL(chemin)));
      if (!vus.has(cible)) aVoir.push(cible);
    }
  }
  return [...vus].sort();
}

export function fermetureDesSources(entree: string): string[] {
  const vus = new Map<string, string>();
  const aVoir = [fileURLToPath(new URL(entree, import.meta.url))];
  const RELATIF = /\bfrom\s+["'](\.[^"']+)["']/g;
  while (aVoir.length) {
    const chemin = aVoir.pop()!;
    if (vus.has(chemin)) continue;
    const texte = readFileSync(chemin, "utf8");
    vus.set(chemin, texte);
    for (const m of texte.matchAll(RELATIF)) {
      /* `new URL` résout le relatif contre le module courant, comme le fait le moteur. */
      const cible = fileURLToPath(new URL(m[1]!, pathToFileURL(chemin)));
      if (!vus.has(cible)) aVoir.push(cible);
    }
  }
  return [...vus.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => t);
}

function empreinteDesEntrees(howMany: number, paliers: TierName[]): string {
  const sources = fermetureDesSources("./failures.ts").join("\u0000");
  return createHash("sha256").update(JSON.stringify({
    howMany, paliers: [...paliers].sort(), revisions: REVISIONS, split: "heldout",
    code: createHash("sha256").update(sources).digest("hex"),
  })).digest("hex").slice(0, 16);
}

export { empreinteDesEntrees };

/*
 * LES ARGUMENTS DE LA GALERIE LIVRÉE, NOMMÉS UNE FOIS.
 *
 * `readme.ts` appelle `collect()` sans arguments : ce sont donc ces valeurs-là qui produisent
 * le fichier versionné. Elles étaient écrites en clair dans la signature, et un contrôle qui
 * veut vérifier que le cache livré est encore chaud devait les recopier — c'est-à-dire tenir
 * une deuxième liste, qui a un jour de retard sur la première le jour où l'une bouge.
 */
export const GALERIE_LIVREE = { howMany: 120, paliers: ENCODEURS };

/**
 * La clé que le fichier versionné DEVRAIT porter. Si elle diffère de ce qu'il porte, le cache
 * est froid : l'outil le dit, recalcule, et charge les modèles — à chaque `npm test`, à chaque
 * `npm run figures`. C'est correct et c'est cher, et un avertissement au milieu de quatre-vingts
 * secondes de sortie n'est lu par personne.
 */
export function cleDeLaGalerieLivree(): string {
  return empreinteDesEntrees(GALERIE_LIVREE.howMany, GALERIE_LIVREE.paliers);
}

/** Ce que porte le fichier versionné, ou `null` s'il est absent ou illisible. */
export function cleDuFichierLivre(): string | null {
  if (!existsSync(GALERIE)) return null;
  try {
    return (JSON.parse(readFileSync(GALERIE, "utf8")) as { entrees?: string }).entrees ?? null;
  } catch { return null; }
}

export async function collect(
  howMany = GALERIE_LIVREE.howMany, paliers: TierName[] = GALERIE_LIVREE.paliers, refaire = false,
): Promise<Failure[]> {
  const cle = empreinteDesEntrees(howMany, paliers);
  if (!refaire && existsSync(GALERIE)) {
    try {
      const c = JSON.parse(readFileSync(GALERIE, "utf8")) as { entrees?: string; echecs?: Failure[] };
      if (c.entrees === cle && Array.isArray(c.echecs)) return c.echecs;
      console.warn(`\n⚠ The cached gallery no longer matches its inputs (${c.entrees ?? "no key"} ≠ ${cle}).`);
      console.warn(`  Recomputing — the models are about to be loaded.\n`);
    } catch {
      console.warn(`\n⚠ ${GALERIE} unreadable: recomputing.\n`);
    }
  }
  return await calculerGalerie(howMany, paliers, cle);
}

async function calculerGalerie(howMany: number, paliers: TierName[], cle: string): Promise<Failure[]> {
  /*
   * DIRE COMBIEN DE MÉMOIRE IL FAUT, AVANT DE MOURIR SANS UN MOT.
   *
   * `npm run failures` est mort d'un signal 137 pendant le relevé — tué par le système, sans
   * une ligne, et le dépôt ne dit nulle part combien de mémoire il demande. Un outil qui
   * meurt en silence apprend à son utilisateur que l'outil est instable ; un outil qui refuse
   * en disant pourquoi lui apprend ce qu'il lui faut.
   *
   * `MEMOIRE_LIBRE_MINIMALE_MO` existait, documenté, et n'était importé par PERSONNE : une
   * garde écrite, jamais appelée. C'était le vert vide dans sa forme la plus pure — elle
   * rassurait à la lecture du code et ne protégeait rien. Elle sert ici.
   *
   * Ce n'est pas un refus dur : on prévient et on continue. La mémoire libre au moment du
   * relevé n'est pas celle du moment où le tas se remplit, et refuser sur cette base
   * bloquerait des passes qui aboutissent. Ce qu'on garantit, c'est qu'une mort par OOM aura
   * été ANNONCÉE — la différence entre un outil instable et un outil exigeant.
   */
  try {
    const m = etatMachine();
    if (m.memoireLibreMo < MEMOIRE_LIBRE_MINIMALE_MO) {
      console.warn(`\n⚠ ${m.memoireLibreMo} MB free, ${MEMOIRE_LIBRE_MINIMALE_MO} recommended for this pass.`);
      console.warn(`  ${howMany} cases × ${FIELDS.length} fields × ${paliers.filter((t) => t !== "human").length} tiers,`);
      console.warn(`  with two models resident. If the process dies on signal 137, this is why.\n`);
    }
    if (m.chargeParCoeur > 1) {
      console.warn(`\n⚠ load ${m.charge} on ${m.coeurs} cores: this pass has been measured between`);
      console.warn(`  41 s and 224 s depending on load, for identical input. The COUNTS do not`);
      console.warn(`  move — they are facts about the output — but the duration does.\n`);
    }
  } catch {
    /* `vm_stat` n'existe pas ailleurs que sur macOS. Une garde qui ne peut pas mesurer se
       tait ; elle ne prétend pas que tout va bien. */
  }

  const records = generateRecords(howMany, "heldout");
  await loadExtractors();
  const failures: Failure[] = [];

  /*
   * La galerie ne garde que les échecs, et jette les réussites qu'elle vient de calculer.
   *
   * C'est la cinquième passe du dépôt à mesurer puis à ne rien garder — trouvée par le test
   * qui exige un journal de toute boucle d'extraction, pas par relecture. Les réussites de
   * cette passe valent celles d'une autre : ce sont les mêmes cas, le même correcteur.
   */
  const journal = ouvrirJournal("failures", {
    quoi: "Galerie des échecs : chaque tentative, retenue ou non.",
    split: "heldout", cases: records.length,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
  });

  for (const tier of paliers) {
    if (tier === "human") continue;   // the human tier is an assumption, not a measurement
    for (const field of FIELDS) {
      for (const r of records) {
        const t0 = performance.now();
        const got = await extract(tier, r, field);
        journal.ligne({
          tier, field, caseId: r.id, phrasing: "reference", split: "heldout",
          outcome: issue(got, r.truth[field]), ms: Number((performance.now() - t0).toFixed(3)),
          value: got, expected: r.truth[field],
        });
        if (!correct(got, r.truth[field])) {
          failures.push({
            tier, field, recordId: r.id,
            text: r.text.replace(/\n/g, " ⏎ ").slice(0, 120),
            expected: r.truth[field], got,
            mode: classify(got, r.truth[field]),
          });
        }
      }
    }
  }
  journal.fermer();
  /* on écrit le cache AVEC sa clé : sans elle il n'aurait aucune valeur, et il en aurait
     l'apparence — ce qui est pire que pas de cache du tout. */
  writeFileSync(GALERIE, JSON.stringify({
    entrees: cle,
    quoi: "Galerie des échecs, mise en cache. La clé « entrees » couvre le corpus, les "
      + "révisions de modèles et le texte des modules qui produisent ce résultat. Si elle "
      + "ne correspond pas, l'outil recalcule au lieu de servir ceci.",
    calculeeLe: new Date().toISOString(),
    echecs: failures,
  }, null, 2));
  return failures;
}

/** Failures per tier and mode — the shape of the problem before any example. */
export function shape(failures: Failure[]) {
  const counts: Record<string, number> = {};
  for (const f of failures) {
    const key = `${f.tier} · ${f.field} · ${f.mode}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

if (isMain(import.meta)) {
  const avecLlm = process.argv.includes("--llm");
  const paliers = avecLlm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS;
  const failures = await collect(120, paliers);
  console.log(`\n${failures.length} failures across ${paliers.filter((x) => x !== "human").length} tiers`
    + `${avecLlm ? "" : " — add --llm for the generative ladder (needs Ollama)"}\n`);

  console.log("WHAT KIND OF WRONG\n");
  for (const [key, n] of shape(failures).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  }

  console.log("\n\nSIX OF THEM, IN FULL\n");
  // One per tier-and-field pair, so the gallery is not six copies of one problem.
  const seen = new Set<string>();
  const gallery = failures.filter((f) => {
    const k = `${f.tier}:${f.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);

  for (const f of gallery) {
    console.log(`  ${f.tier} · ${f.field} · ${f.mode}   [${f.recordId}]`);
    console.log(`    text      ${f.text}`);
    console.log(`    expected  ${JSON.stringify(f.expected)}`);
    console.log(`    got       ${JSON.stringify(f.got)}\n`);
  }
}
