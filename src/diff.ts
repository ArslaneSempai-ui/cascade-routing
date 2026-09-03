/**
 * Ce qui a CHANGÉ entre deux passes, et non ce qu'on a marqué.
 *
 *   npm run diff                      les deux relevés les plus récents
 *   npm run diff -- <avant> <apres>
 *
 * `VALIDATION.md` §6 point 2 ne recommande pas, il oblige :
 *
 *   « Compare runs rather than reading the latest one. A rising aggregate can hide cases
 *     that used to pass and no longer do; only a run-to-run diff surfaces those. »
 *
 * Ce fichier est ce que cette phrase demande, et il n'existait pas. Le dépôt livrait
 * pourtant déjà cinq relevés scellés, dont quatre portent les réussites CAS PAR CAS — la
 * matière était là, personne ne la comparait.
 *
 * CE QUI REND CE DIFF INHABITUELLEMENT SÛR ICI, et c'est mesuré : deux passes du même code
 * sur le même corpus, prises sous des charges machine différentes, donnent **zéro** cas
 * gagné et **zéro** cas perdu sur 16 800. La charge déplace les durées de 16 à 60 % et ne
 * change aucun résultat. Sur ce harnais, tout écart que ce diff rapporte est donc du signal :
 * il n'y a pas de plancher de bruit à trier. Un banc générique ne peut pas promettre ça.
 *
 * IL REFUSE PLUTÔT QUE D'APPROXIMER. Deux relevés dont les tailles d'échantillon diffèrent ne
 * se comparent pas cas par cas — apparier le cas i de mille avec le cas i de cent vingt
 * produirait un chiffre lisible et faux. Et un relevé sans bits ne se compare pas du tout :
 * le dire vaut mieux que rendre zéro, parce qu'un zéro par absence ressemble trait pour trait
 * à un zéro par succès.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";
import { pairedVerdict } from "./interval.ts";

type Cellule = { reussites?: string; accuracy: number; items: number };
/** Un relevé du banc, ou un relevé CLIENT (`<file>-measured.json`) : la même forme, plus la
    source dont il vient — deux relevés client ne se comparent cas par cas que sur le même fichier. */
type Releve = {
  measuredAt: string;
  extraction: Record<string, Record<string, Cellule>>;
  source?: { file?: string; sha256?: string; cases?: number };
};

const RACINE = fileURLToPath(new URL("..", import.meta.url));

/**
 * LES RELEVÉS, DANS L'ORDRE OÙ ILS ONT ÉTÉ MESURÉS — PAS DANS CELUI DE LEURS NOMS.
 *
 * Ils étaient triés par NOM de fichier, et « les deux plus récents » étaient les deux
 * derniers de ce tri. Mesuré le 27 août 2026 sur les cinq relevés livrés :
 *
 *   par nom    coeur-rendu (10:40)  ->  un-coeur-pris (09:52)     l'après précède l'avant
 *   par date   coeur-rendu (10:40)  ->  charge-8 (18:38)          la vraie paire
 *
 * Deux défauts, pas un. La paire par défaut est INVERSÉE — un outil vendu comme garde de
 * régression rendait donc les gains pour des pertes — et le relevé réellement le plus récent,
 * `charge-8`, n'était jamais comparé : son nom le place au milieu. Même inversion sur la
 * paire du 19, où `-remesure` précède son propre original tout en le suivant de neuf heures.
 *
 * L'outil imprimait « 10:40 -> 09:52 » dans sa propre sortie. Les deux dates étaient là,
 * dans le bon ordre pour être lues à l'envers, et rien ne s'y opposait.
 *
 * Un relevé sans `measuredAt` ne se trie pas : il se REFUSE. Sans date, il atterrirait à une
 * extrémité de l'ordre et déciderait de la paire par défaut sans que personne ne l'ait voulu.
 */
/**
 * L'ordre lui-même, séparé de la lecture du disque : un témoin peut alors lui présenter la
 * date manquante, que le vrai dossier ne porte pas aujourd'hui — et qu'on ne va pas y écrire
 * pour l'éprouver.
 */
export function ordonnerParMesure(entrees: { nom: string; measuredAt?: unknown }[]): string[] {
  for (const e of entrees) {
    if (typeof e.measuredAt !== "string" || !e.measuredAt) {
      throw new Error(
        `${e.nom} carries no measuredAt, so there is no telling when it was measured.\n`
        + "  These records are ordered by measurement time, not by file name: an undated one\n"
        + "  would land at one end of that order and silently decide which pair gets compared.\n"
        + "  Re-seal it with \u201cnpm run sceller\u201d, or move it out of this directory.");
    }
  }
  return [...entrees]
    .sort((x, y) => (String(x.measuredAt) < String(y.measuredAt) ? -1
      : String(x.measuredAt) > String(y.measuredAt) ? 1 : 0))
    .map((e) => e.nom);
}

export function relevesDisponibles(): string[] {
  return ordonnerParMesure(readdirSync(RACINE)
    .filter((f) => /^profiles-.*\.json$/.test(f))
    .map((nom) => {
      try { return { nom, measuredAt: (JSON.parse(readFileSync(join(RACINE, nom), "utf8")) as { measuredAt?: unknown }).measuredAt }; }
      catch { return { nom }; }
    }));
}

export type Ecart = {
  palier: string; champ: string;
  tauxAvant: number; tauxApres: number;
  gagnes: number; perdus: number; cas: number;
};

export type Comparaison = {
  avant: string; apres: string;
  cellulesComparees: number; cellulesEcartees: { cellule: string; pourquoi: string }[];
  casCompares: number; gagnes: number; perdus: number;
  ecarts: Ecart[];
};

export function comparer(a: Releve, b: Releve): Comparaison {
  const ecarts: Ecart[] = [];
  const ecartees: { cellule: string; pourquoi: string }[] = [];
  let cellules = 0, cas = 0, gTot = 0, pTot = 0;

  for (const palier of Object.keys(a.extraction).sort()) {
    for (const champ of Object.keys(a.extraction[palier] ?? {}).sort()) {
      const ca = a.extraction[palier]?.[champ], cb = b.extraction[palier]?.[champ];
      const nom = `${palier}/${champ}`;
      if (!cb) { ecartees.push({ cellule: nom, pourquoi: "absente du second relevé" }); continue; }
      const ba = ca?.reussites, bb = cb.reussites;
      /* UNE ABSENCE SE DIT. Le palier humain n'a plus de bits parce qu'il n'est pas mesuré,
         et un relevé d'avant août n'en portait aucun. Les traiter comme « rien à signaler »
         serait rendre un zéro par absence. */
      if (!ba || !bb) {
        /* LE MESSAGE DISAIT L'INVERSE. Écrit `!ba ? "d'avant" : "d'après"`, il nommait comme
           PORTEUR celui qui manquait. Un diagnostic inversé envoie chercher dans le bon
           fichier la chose qui est dans l'autre — et il a l'air juste, ce qui coûte plus cher
           qu'un silence. Attrapé en lisant la sortie, pas en relisant le code. */
        ecartees.push({ cellule: nom, pourquoi: !ba && !bb ? "aucun des deux ne porte de réussites par cas"
          : `seul le relevé ${ba ? "d'avant" : "d'après"} porte ses réussites par cas` });
        continue;
      }
      if (ba.length !== bb.length) {
        ecartees.push({ cellule: nom, pourquoi: `échantillons différents — ${ba.length} contre ${bb.length} cas` });
        continue;
      }
      cellules++; cas += ba.length;
      let g = 0, p = 0;
      for (let i = 0; i < ba.length; i++) {
        if (ba[i] === "0" && bb[i] === "1") g++;
        else if (ba[i] === "1" && bb[i] === "0") p++;
      }
      gTot += g; pTot += p;
      if (g || p) {
        ecarts.push({ palier, champ, tauxAvant: ca!.accuracy, tauxApres: cb.accuracy, gagnes: g, perdus: p, cas: ba.length });
      }
    }
  }
  /*
   * CE QUI N'EXISTE QUE DANS LE SECOND RELEVÉ DISPARAISSAIT SANS UN MOT.
   *
   * La boucle ci-dessus parcourt les clés du PREMIER relevé. Une cellule absente du premier
   * — un palier ajouté, un champ nouveau — n'est donc jamais visitée : elle n'est ni comparée
   * ni écartée, elle n'existe pas. L'outil rend « n cellules comparées » sans dire qu'il en a
   * ignoré une, et c'est précisément la cellule neuve qu'on voulait regarder.
   *
   * Le sens inverse, lui, était déjà dit : « absente du second relevé ». Une garde qui ne
   * couvre qu'une direction se lit comme si elle couvrait les deux, parce que son nom parle
   * des deux.
   */
  for (const palier of Object.keys(b.extraction).sort()) {
    for (const champ of Object.keys(b.extraction[palier] ?? {}).sort()) {
      if (a.extraction[palier]?.[champ]) continue;
      ecartees.push({ cellule: `${palier}/${champ}`, pourquoi: "absente du premier relevé" });
    }
  }

  return { avant: a.measuredAt, apres: b.measuredAt, cellulesComparees: cellules,
    cellulesEcartees: ecartees, casCompares: cas, gagnes: gTot, perdus: pTot, ecarts };
}

/**
 * UN RELEVÉ CLIENT VIT À CÔTÉ DU FICHIER DU CLIENT, PAS À LA RACINE DU DÉPÔT.
 *
 * `join(RACINE, "/Users/…/cas-measured.json")` fabriquait un chemin sous le dépôt qui n'existe
 * pas, et le seul diff que le site promet à un acheteur — « run it twice, compare » — ne
 * pouvait pas lire ce que `measure:yours` venait d'écrire. Un chemin qui existe tel quel est
 * pris tel quel ; le repli sur la racine ne sert qu'aux relevés livrés.
 */
function lire(f: string): Releve {
  const c = existsSync(f) ? f : join(RACINE, f);
  if (!existsSync(c)) throw new Error(`${f} does not exist. Records available: ${relevesDisponibles().join(", ")}`);
  return JSON.parse(readFileSync(c, "utf8")) as Releve;
}

/**
 * DEUX RELEVÉS CLIENT NE SE COMPARENT QUE SUR LE MÊME FICHIER.
 *
 * Les réussites par cas sont dans l'ordre du CSV, sans identifiant : apparier le cas i d'un
 * fichier avec le cas i d'un autre produirait un chiffre lisible et faux — la faute exacte
 * que ce diff refuse déjà pour deux échantillons de tailles différentes, mais que deux
 * fichiers de même taille ne montreraient pas. L'empreinte de la source décide.
 */
export function sourcesIncompatibles(a: Releve, b: Releve): string | null {
  const sa = a.source?.sha256, sb = b.source?.sha256;
  if (!sa || !sb || sa === sb) return null;
  return `these two records were measured on DIFFERENT files — ${a.source?.file ?? "?"} (${sa.slice(0, 12)}…) `
    + `against ${b.source?.file ?? "?"} (${sb.slice(0, 12)}…). Case-by-case comparison pairs the i-th `
    + `case of one file with the i-th case of the other, which means nothing across two files. `
    + `Measure the same file twice, or compare the rates in each report by hand.`;
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2).filter((x) => !x.startsWith("-"));
  const dispo = relevesDisponibles();
  if (dispo.length < 2 && args.length < 2) {
    console.error(`  Comparing two records takes two records. ${dispo.length} found.`);
    process.exit(2);
  }
  const [fa, fb] = args.length >= 2 ? [args[0]!, args[1]!] : [dispo.at(-2)!, dispo.at(-1)!];
  const ra = lire(fa), rb = lire(fb);

  /*
   * UN « APRÈS » ANTÉRIEUR À SON « AVANT » RETOURNE TOUS LES SIGNES.
   *
   * L'ordre par défaut est réparé plus haut, mais deux fichiers peuvent aussi être nommés à
   * la main dans le mauvais sens. Le refus ne porte donc pas sur la SÉLECTION, il porte sur
   * la paire : chaque cas gagné devient un cas perdu, et l'outil dont tout l'argument est
   * « un agrégat qui monte peut cacher des cas perdus » rapporterait exactement l'inverse
   * de ce qui s'est passé.
   *
   * Il refuse au lieu de réordonner tout seul : deux relevés à comparer dans un ordre précis
   * est une intention, et la corriger en silence rendrait un verdict que personne n'a demandé.
   */
  if (rb.measuredAt < ra.measuredAt) {
    console.error(`\n  ${fb} was measured BEFORE ${fa}.`);
    console.error(`    ${fa}  ${ra.measuredAt}`);
    console.error(`    ${fb}  ${rb.measuredAt}`);
    console.error("\n  Comparing them in this order flips every sign: each case gained would be");
    console.error("  reported as a case lost. This tool exists to say what a rising aggregate hides,");
    console.error("  and in this order it would say the opposite of what happened.");
    console.error(`\n  → node src/diff.ts ${fb} ${fa}\n`);
    process.exit(2);
  }

  const incompatibles = sourcesIncompatibles(ra, rb);
  if (incompatibles) {
    console.error(`\n  ${incompatibles}\n`);
    process.exit(2);
  }

  const r = comparer(ra, rb);

  console.log(`\n  ${fa}  ->  ${fb}`);
  console.log(`  ${r.avant.slice(0, 16)}  ->  ${r.apres.slice(0, 16)}\n`);
  console.log(`  ${r.cellulesComparees} cell(s) compared, ${r.casCompares.toLocaleString("en-GB")} cases.`);
  if (r.cellulesEcartees.length) {
    console.log(`  ${r.cellulesEcartees.length} set aside:`);
    for (const e of r.cellulesEcartees.slice(0, 6)) console.log(`     ${e.cellule} — ${e.pourquoi}`);
    if (r.cellulesEcartees.length > 6) console.log(`     … and ${r.cellulesEcartees.length - 6} more`);
  }
  if (!r.cellulesComparees) {
    console.log(`\n  NOTHING WAS COMPARED. That is not the same as \u201cno change\u201d.\n`);
    process.exit(2);
  }
  console.log(`\n  cases gained: ${r.gagnes}   ·   CASES LOST: ${r.perdus}\n`);
  if (!r.ecarts.length) {
    console.log(`  No case changed outcome.\n`);
    process.exit(0);
  }
  for (const e of r.ecarts.sort((x, y) => y.perdus - x.perdus)) {
    const d = (e.tauxApres - e.tauxAvant) * 100;
    const sens = d > 0 ? "up" : d < 0 ? "down" : "level";
    const alerte = e.perdus && d >= 0 ? "  ← THE RATE DOES NOT FALL AND CASES ARE LOST" : "";
    console.log(`  ${e.palier}/${e.champ}  ${(e.tauxAvant * 100).toFixed(1)} % -> ${(e.tauxApres * 100).toFixed(1)} % (${sens})`
      + `   +${e.gagnes} / -${e.perdus} sur ${e.cas}${alerte}`);
  }
  /* McNemar apparié : deux passes sur les MÊMES cas ne se comparent pas par recouvrement
     d'intervalles, qui traiterait deux mesures appariées comme deux échantillons indépendants. */
  const v = pairedVerdict(r.gagnes, r.perdus);
  console.log(`\n  ${v.discordant} discordant case(s)`
    + (typeof (v as { p?: number }).p === "number" ? ` · p = ${(v as { p: number }).p.toFixed(4)}` : "")
    + `\n  ${v.note}\n`);
  process.exit(r.perdus ? 1 : 0);
}
