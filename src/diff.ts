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
type Releve = { measuredAt: string; extraction: Record<string, Record<string, Cellule>> };

const RACINE = fileURLToPath(new URL("..", import.meta.url));

export function relevesDisponibles(): string[] {
  return readdirSync(RACINE)
    .filter((f) => /^profiles-.*\.json$/.test(f))
    .sort();
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
  return { avant: a.measuredAt, apres: b.measuredAt, cellulesComparees: cellules,
    cellulesEcartees: ecartees, casCompares: cas, gagnes: gTot, perdus: pTot, ecarts };
}

function lire(f: string): Releve {
  const c = join(RACINE, f);
  if (!existsSync(c)) throw new Error(`${f} does not exist. Records available: ${relevesDisponibles().join(", ")}`);
  return JSON.parse(readFileSync(c, "utf8")) as Releve;
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2).filter((x) => !x.startsWith("-"));
  const dispo = relevesDisponibles();
  if (dispo.length < 2 && args.length < 2) {
    console.error(`  Comparing two records takes two records. ${dispo.length} found.`);
    process.exit(2);
  }
  const [fa, fb] = args.length >= 2 ? [args[0]!, args[1]!] : [dispo.at(-2)!, dispo.at(-1)!];
  const r = comparer(lire(fa), lire(fb));

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
