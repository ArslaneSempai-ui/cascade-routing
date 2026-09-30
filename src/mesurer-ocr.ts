/**
 * Ce que coûte l'étage de lecture, mesuré au lieu d'être supposé.
 *
 *     npm run ocr
 *
 * Le dépôt mesure l'extraction DEPUIS UN TEXTE. Un client reçoit des scans. La question qu'il
 * pose n'est donc pas « quel palier lit le mieux un texte » mais « que reste-t-il de votre
 * exactitude quand le texte vient d'une image ». Personne ici n'y avait répondu.
 *
 * La mesure est une comparaison appariée : les MÊMES documents, les MÊMES paliers, une fois
 * depuis le texte et une fois depuis une image de ce texte. L'écart est le coût de l'étage, et
 * rien d'autre — pas un corpus différent, pas un autre jour, pas une autre machine.
 *
 * ─── CE QUE CETTE MESURE NE DIT PAS ───
 *
 * Les images sont RENDUES depuis le texte, pas photographiées. Une page nette, droite, sans
 * reflet ni pliure ni tampon en travers. C'est le PLANCHER du coût de l'étage : sur une vraie
 * photographie il ne peut qu'être plus élevé. Le dire est la moitié du chiffre — un plancher
 * publié comme une mesure serait le genre de figure que ce dépôt existe pour refuser.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isMain } from "./cli.ts";
import { ouvrirJournal, issue } from "./journal.ts";
import { loadavg } from "node:os";
import { generateRecords, FIELDS, type ClientFile } from "./corpus.ts";
import { loadExtractors, extract, correct, ENCODEURS } from "./tiers.ts";
import { lire, texte as texteDesBlocs, ceQuiManque, aDesBas } from "./ocr.ts";
import { rate, writeRate, distinguishable } from "./interval.ts";
import type { TierName } from "./paliers.ts";
import { casDemandes } from "./cas-demandes.ts";
import { raisonDArbreSale, etatDuDepot } from "./arbre-propre.ts";

const SORTIE = fileURLToPath(new URL("../ocr.json", import.meta.url));
/* EXPORTÉ POUR QU'IL N'Y AIT QU'UNE SEULE VÉRITÉ. Un cas qui doit se sauter faute de moteur de
   rendu a besoin de ce chemin ; recopié dans un test, il devient une seconde source qui vieillira
   sans que rien ne le signale. */
export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Rendre un document en image, comme un scanner l'aurait produit.
 *
 * Police à chasse fixe et fond blanc : c'est le cas le plus favorable, et c'est voulu — on
 * cherche le PLANCHER du coût de l'étage, pas sa valeur sur une photographie de téléphone.
 */
/*
 * F6 (2026-09-29): the page the text is rendered on, in numbers the ceiling below is derived
 * from. The body is LARGEUR_PX wide with MARGE_PX of padding each side, the text is set in
 * Courier New at CORPS_PX, and Courier New advances 1229 of 2048 units per character, so the
 * number of characters that fit on one rendered line follows; `white-space: pre-wrap` wraps a
 * longer line at a space. An expected line longer than that comes back on two OCR lines
 * whatever the reader does with it. Measured on the 120 held-out documents on 2026-09-29:
 * 97 of 235 lines are longer than the page (the longest is 219 characters), so whole lines
 * could not exceed 138 of 235 there, and a line fidelity of 54 % read as a reading failure
 * when most of it was the page. The record carries the ceiling, and the fidelity among the
 * lines that fit is the figure that speaks about the reader.
 */
const LARGEUR_PX = 820, MARGE_PX = 56, CORPS_PX = 16, AVANCE_COURIER = 1229 / 2048;
export const LARGEUR_RENDUE_EN_CARACTERES = Math.floor((LARGEUR_PX - 2 * MARGE_PX) / (CORPS_PX * AVANCE_COURIER));

function rendre(doc: ClientFile, dossier: string, chrome: string = CHROME): string {
  const html = join(dossier, `${doc.id}.html`);
  const png = join(dossier, `${doc.id}.png`);
  const jpg = join(dossier, `${doc.id}.jpg`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>`
    + `body{width:${LARGEUR_PX}px;margin:0;padding:48px ${MARGE_PX}px;font-family:"Courier New",monospace;`
    + `font-size:${CORPS_PX}px;line-height:1.7;background:#fff;color:#111;white-space:pre-wrap}</style>`
    + doc.text.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  execFileSync(chrome, ["--headless", "--disable-gpu", `--screenshot=${png}`,
    "--window-size=900,460", "--hide-scrollbars", html], { stdio: ["ignore", "ignore", "ignore"] });
  execFileSync("sips", ["-s", "format", "jpeg", png, "--out", jpg], { stdio: ["ignore", "ignore", "ignore"] });
  return jpg;
}

/**
 * Ce palier lit-il vraiment le texte qu'on lui donne ?
 *
 * `human` renvoie la vérité terrain sans jamais regarder le document. Sur une image dégradée il
 * rendrait encore 100 %, et publierait un coût de 0,0 point — un chiffre qui ne mesure rien.
 * C'est la forme la plus pure du vert vide : la mesure passe parce que l'instrument ne regarde pas.
 *
 * Le détecter par son NOM serait fragile — un palier ajouté demain avec le même défaut passerait.
 * On le détecte donc par son comportement : on brouille le texte et on regarde si la réponse bouge.
 * Un palier qui rend exactement la bonne valeur depuis un texte brouillé ne l'a pas lue dedans.
 */
export async function litLeTexte(t: TierName, temoins: ClientFile[]): Promise<boolean> {
  for (const d of temoins) {
    const brouille = { ...d, text: d.text.replace(/[A-Za-z0-9]/g, "x") };
    for (const f of FIELDS) {
      const depuisRien = await extract(t, brouille, f);
      if (correct(depuisRien, d.truth[f])) continue;  // encore juste : suspect
      return true;                                    // faux sans le texte : il le lisait
    }
  }
  return false;
}

/**
 * Le commit qui tourne, et si l'arbre a bougé depuis.
 *
 * Hors dépôt git — une archive décompressée, un conteneur sans `.git` — `execFileSync` lève et on
 * rend `undefined` : le relevé ne portera alors AUCUN nom de commit. C'est voulu : pas de nom est
 * honnête, un nom qui n'est pas celui qui a tourné ne l'est pas.
 */
/** Le relevé porte `sale` en booléen : c'est sa forme, et la lecture vient du module commun. */
function lireLArbre(): { commit: string; sale: boolean } | undefined {
  const e = etatDuDepot();
  return e ? { commit: e.commit, sale: e.sale.length > 0 } : undefined;
}

/**
 * Ce que la passe lit du monde avant de mesurer quoi que ce soit — et qu'un cas peut remplacer.
 *
 * TROIS REFUS SE TIENNENT AVANT LA PREMIÈRE IMAGE : l'étage de lecture absent, le moteur de rendu
 * absent, l'arbre modifié. Chacun interroge la machine — une sonde de plateforme, un chemin sur le
 * disque, l'état de git — et aucun ne pouvait donc être éprouvé : sur la machine qui mesure les
 * trois conditions sont fausses, et on ne désinstalle pas Chrome pour voir ce que dit le message.
 * C'étaient trois refus dont personne n'avait jamais lu un seul mot.
 *
 * Chaque entrée vaut par défaut ce qu'elle valait avant cette couture : un appelant qui ne passe
 * rien ne voit aucune différence, et la ligne de commande plus bas n'a pas changé.
 */
export type EntreesDeLaPasse = {
  /** Ce qui manque à l'étage de lecture, ou `null` s'il est là. Par défaut `ceQuiManque`. */
  sonde?: () => string | null;
  /** Le moteur qui rend les documents en images. Par défaut `CHROME`. */
  chrome?: string;
  /** Le commit et la propreté de l'arbre. Par défaut `lireLArbre`. */
  arbre?: () => { commit: string; sale: boolean } | undefined;
  /** Les arguments reçus, où se lit `--arbre-modifie`. Par défaut `process.argv`. */
  argv?: readonly string[];
};

/**
 * F5 (2026-09-29): the fidelity of the LINES, next to the fidelity of the words. The word
 * count cannot see a printed line broken in two or a page read out of order: every word is
 * still there. Of the expected lines (the document's text, one printed line each, blank
 * lines dropped, runs of white space folded to one space), `intactes` is how many appear
 * whole on ONE line of the OCR text, and `enOrdre` how many of those come after the
 * previous line found, the first line found counting as in order; a line printed twice is
 * looked for after the last one found first, so a repeated line matches in order. Counts,
 * not rates, so that documents add up and `rate` gives the interval once.
 *
 * F6: `largeur` is how many characters the page fits on one line (see
 * LARGEUR_RENDUE_EN_CARACTERES). An expected line longer than that, measured as written,
 * wraps when rendered and cannot come back whole; `tiennent` counts the lines that fit and
 * `intactesQuiTiennent` the whole ones among them. Without a width every line fits.
 */
export function fideliteDesLignes(attendu: string, lu: string, largeur = Infinity):
    { lignes: number; intactes: number; enOrdre: number; tiennent: number; intactesQuiTiennent: number } {
  const plier = (l: string) => l.replace(/\s+/g, " ").trim();
  const brutes = attendu.split("\n").filter((l) => plier(l).length > 0);
  const voulues = brutes.map(plier), lues = lu.split("\n").map(plier).filter((l) => l.length > 0);
  let intactes = 0, enOrdre = 0, tiennent = 0, intactesQuiTiennent = 0, derniere = -1;
  voulues.forEach((l, i) => {
    const tient = brutes[i]!.length <= largeur;
    if (tient) tiennent++;
    const apres = lues.findIndex((x, k) => k > derniere && x.includes(l));
    const ou = apres >= 0 ? apres : lues.findIndex((x) => x.includes(l));
    if (ou < 0) return;
    intactes++;
    if (tient) intactesQuiTiennent++;
    if (ou > derniere) { enOrdre++; derniere = ou; }
  });
  return { lignes: voulues.length, intactes, enOrdre, tiennent, intactesQuiTiennent };
}

export async function mesurer(
  combien = 120, paliers: TierName[] = [...ENCODEURS], env: EntreesDeLaPasse = {},
) {
  const manque = (env.sonde ?? ceQuiManque)();
  /* LA RAISON ARRIVE TELLE QUELLE. `ceQuiManque` dit QUOI installer et par quelle commande ;
     réécrite ici en « OCR unavailable », elle envoie chercher au mauvais endroit. */
  if (manque) throw new Error(manque);
  const chrome = env.chrome ?? CHROME;
  if (!existsSync(chrome)) {
    throw new Error(`Chrome is not there, and it is what RENDERS the documents as images here. `
      + `Without it there are no images to read, and this measurement has no object.`);
  }

  /* LE RELEVÉ NOMME LE CODE QUI L'A PRODUIT. Sans ça, un chiffre publié six semaines plus tard
     ne peut plus être refait : on ne sait pas quelle version l'a rendu. Et mesurer sur un arbre
     modifié nomme un commit qui n'est pas celui qui a tourné — pire qu'aucun nom. */
  const version = (env.arbre ?? lireLArbre)();
  /* L'ISSUE S'APPREND UNE FOIS. `--allow-dirty` est la forme de `measure`, `--arbre-modifie`
     celle d'ici : les deux sont acceptées, parce qu'un refus dont l'issue change d'une commande
     à l'autre se lit comme un refus sans issue. Voir `arbre-propre.ts`. */
  if (version?.sale && raisonDArbreSale(env.argv ?? process.argv) === undefined) {
    /* UN REFUS A BESOIN D'UNE ISSUE, sinon on commente la garde. L'issue existe, elle est
       explicite, et elle est désagréable à lire — c'est ce qui la garde exceptionnelle : le
       relevé produit portera « sale: true », et tout ce qui le relit le dira. */
    throw new Error("Modified tree: the record would name a commit that is not the one that "
      + "ran, and nobody could reproduce this figure.\n"
      + "  → Commit, then measure. That is the normal order.\n"
      + "  → To start anyway: --arbre-modifie. The record will carry \u201csale: true\u201d and "
      + "anything that reads it will say its code cannot be found again.");
  }
  if (version?.sale) {
    process.stderr.write("\n  TREE MODIFIED — this record will not be reproducible as it stands.\n\n");
  }

  const dossier = join(dirname(SORTIE), "data", "ocr");
  mkdirSync(dossier, { recursive: true });
  const docs = generateRecords(combien, "heldout");

  /* UN CORPUS VIDE N'EST PAS UN PALIER AVEUGLE. Sans document, la boucle de `litLeTexte` ne tourne
     pas et la fonction rend `false` pour TOUT LE MONDE : le refus d'en bas accuserait alors chaque
     palier d'une cécité qu'il n'a pas, et on irait corriger des paliers pour une faute qui est
     ici. Un diagnostic qui désigne le mauvais endroit coûte plus cher que pas de diagnostic. */
  if (docs.length === 0) {
    throw new Error(`No documents to measure on: ${combien} case(s) asked for leaves an empty `
      + `corpus. Nothing would be rendered and nothing read, and the blind-tier check below would `
      + `call every tier blind for want of anything to try it on.`);
  }

  await loadExtractors();

  /* Écarter les paliers qui ne lisent pas — et nommer ce qu'on écarte : un chiffre issu d'une
     sélection porte le compte de ce qu'il laisse dehors, ou il ne se publie pas. */
  const temoins = docs.slice(0, 3);
  const lisants: TierName[] = [], aveugles: TierName[] = [];
  for (const t of paliers) (await litLeTexte(t, temoins) ? lisants : aveugles).push(t);
  if (lisants.length === 0) {
    throw new Error(`None of the ${paliers.length} tiers asked for reads the text it is given. `
      + `There is nothing to degrade, so nothing to measure.`);
  }
  paliers = lisants;

  /* CHAQUE TENTATIVE EST GARDÉE. Une passe qui mesure 3 600 extractions et n'en publie que
     trois taux jette tout le reste : la question suivante — quel champ souffre le plus du
     scan, quel document a fait chuter `small` — coûterait une passe entière de plus. */
  const journal = ouvrirJournal("ocr", {
    quoi: "Le coût de l'étage de lecture : les mêmes documents, en texte puis en image.",
    split: "heldout", cases: docs.length,
    chargeAvant: Number(loadavg()[0]!.toFixed(2)),
    ...(version ? { commit: version.commit, sale: version.sale } : {}),
  });

  /* La fidélité de la transcription, avant toute extraction : elle explique les écarts
     d'exactitude qui suivent, et un écart inexpliqué est un écart qu'on ne peut pas défendre. */
  let motsAttendus = 0, motsLus = 0;
  let lignesVoulues = 0, lignesIntactes = 0, lignesEnOrdre = 0, lignesQuiTiennent = 0, lignesIntactesQuiTiennent = 0;
  let documentsSansBas = 0;
  let lignesTotal = 0, lignesMax = 0;
  const parPalier: Record<string, { texte: number; image: number; sur: number }> = {};
  for (const t of paliers) parPalier[t] = { texte: 0, image: 0, sur: 0 };

  for (const d of docs) {
    const blocs = lire(rendre(d, dossier, chrome));
    const luOCR = texteDesBlocs(blocs);
    const lignes = d.text.split("\n").length;
    lignesTotal += lignes; lignesMax = Math.max(lignesMax, lignes);
    const mots = d.text.split(/\s+/).filter((w) => w.length > 1);
    motsAttendus += mots.length;
    motsLus += mots.filter((w) => luOCR.includes(w)).length;
    const fl = fideliteDesLignes(d.text, luOCR, LARGEUR_RENDUE_EN_CARACTERES);
    lignesVoulues += fl.lignes; lignesIntactes += fl.intactes; lignesEnOrdre += fl.enOrdre;
    lignesQuiTiennent += fl.tiennent; lignesIntactesQuiTiennent += fl.intactesQuiTiennent;
    if (!blocs.every(aDesBas)) documentsSansBas++;

    for (const t of paliers) {
      for (const f of FIELDS) {
        const attendu = d.truth[f];
        for (const [voie, doc] of [["texte", d], ["image", { ...d, text: luOCR }]] as const) {
          const t0 = performance.now();
          const got = await extract(t, doc, f);
          journal.ligne({
            tier: t, field: f, caseId: d.id, chain: `extraction-${voie}`,
            phrasing: "reference", split: "heldout", outcome: issue(got, attendu),
            ms: Number((performance.now() - t0).toFixed(3)), value: got, expected: attendu,
          });
          if (correct(got, attendu)) parPalier[t]![voie]++;
        }
        parPalier[t]!.sur++;
      }
    }
  }

  const fidelite = rate(motsLus, motsAttendus);
  const intactes = rate(lignesIntactes, lignesVoulues), enOrdre = rate(lignesEnOrdre, lignesVoulues);
  const intactesQuiTiennent = rate(lignesIntactesQuiTiennent, lignesQuiTiennent);
  const paliersMesures = paliers.map((t) => {
    const p = parPalier[t]!;
    const surTexte = rate(p.texte, p.sur), surImage = rate(p.image, p.sur);
    return {
      palier: t,
      surTexte: { taux: surTexte.rate, bas: surTexte.low, haut: surTexte.high, n: surTexte.n },
      surImage: { taux: surImage.rate, bas: surImage.low, haut: surImage.high, n: surImage.n },
      ecartEnPoints: (surTexte.rate - surImage.rate) * 100,
      /* SÉPARABLE OU NON : un écart dont les intervalles se recouvrent n'est pas un coût,
         c'est du bruit — et le publier comme un coût serait inventer une dépense. */
      separable: distinguishable(surTexte, surImage),
    };
  });

  return {
    quoi: "Coût de l'étage de lecture : les mêmes documents, une fois en texte et une fois en image.",
    plancher: "Les images sont RENDUES, pas photographiées : page nette, droite, sans reflet ni "
      + "pliure, et les documents du corpus sont courts (voir lignesParDocument). Une photographie "
      + "de page pleine pose des problèmes que celle-ci ne pose pas — colonnes, ordre de lecture, "
      + "inclinaison. L'écart mesuré ici est donc un PLANCHER, pas un coût observé en production.",
    lignesParDocument: { moyenne: lignesTotal / docs.length, maximum: lignesMax },
    documents: docs.length,
    paliersEcartes: aveugles.length === 0 ? [] : aveugles,
    pourquoiEcartes: aveugles.length === 0 ? null
      : `Ces paliers rendent la bonne valeur depuis un texte brouillé : ils ne lisent pas le `
        + `document. Dégrader l'image ne peut pas les faire baisser, donc leur coût serait 0,0 `
        + `point quel que soit l'état du scan. Ce n'est pas une mesure, c'est un instrument aveugle.`,
    fideliteDeLaTranscription: { taux: fidelite.rate, bas: fidelite.low, haut: fidelite.high, n: fidelite.n },
    /* F5: the lines, which the word count cannot see (see `fideliteDesLignes`); F6: their
       ceiling, the lines wider than the page, and the fidelity among the lines that fit. */
    fideliteDesLignes: {
      intactes: { taux: intactes.rate, bas: intactes.low, haut: intactes.high, n: intactes.n },
      enOrdre: { taux: enOrdre.rate, bas: enOrdre.low, haut: enOrdre.high, n: enOrdre.n },
      plafond: { largeurEnCaracteres: LARGEUR_RENDUE_EN_CARACTERES, lignesPlusLargesQueLaPage: lignesVoulues - lignesQuiTiennent, sur: lignesVoulues },
      intactesParmiCellesQuiTiennent: { taux: intactesQuiTiennent.rate, bas: intactesQuiTiennent.low, haut: intactesQuiTiennent.high, n: intactesQuiTiennent.n },
    },
    /* F6: which rule grouped the blocks into lines. "espacement" means the reader gave no
       bottom corners on at least one document, which a binary older than its source does. */
    lignesGroupeesPar: documentsSansBas === 0 ? "recouvrement" : "espacement",
    documentsSansBas,
    paliers: paliersMesures,
    mesureLe: new Date().toISOString(),
    ...(version ? { code: version } : {}),
    /* Le journal, nommé et compté — pas son chemin absolu : un relevé publié ne porte pas
       l'arborescence de la machine qui l'a produit. */
    journalDeLaPasse: (() => {
      const f = journal.fermer();
      return { fichier: f.chemin.split("/").pop()!, tentatives: f.lignes };
    })(),
  };
}

if (isMain(import.meta)) {
  const combien = casDemandes(120);
  try {
    const r = await mesurer(combien);
    console.log(`\n  Transcription fidelity: `
      + `${writeRate(rate(Math.round(r.fideliteDeLaTranscription.taux * r.fideliteDeLaTranscription.n), r.fideliteDeLaTranscription.n))}`);
    const li = r.fideliteDesLignes;
    const taux = (x: { taux: number; n: number }) => writeRate(rate(Math.round(x.taux * x.n), x.n));
    console.log(`  Line fidelity: ${taux(li.intactes)} of printed lines read whole on one line, `
      + `${taux(li.enOrdre)} in their printed order.`);
    console.log(`  ${li.plafond.lignesPlusLargesQueLaPage} of ${li.plafond.sur} expected lines are wider than the rendered page `
      + `(${li.plafond.largeurEnCaracteres} characters) and wrap, so whole lines cannot exceed `
      + `${li.plafond.sur - li.plafond.lignesPlusLargesQueLaPage} of ${li.plafond.sur}; among the lines that fit: `
      + `${taux(li.intactesParmiCellesQuiTiennent)} whole. Lines grouped by ${r.lignesGroupeesPar === "recouvrement" ? "vertical overlap" : "top edges (the reader gave no bottom corners)"}.`);
    console.log(`  Over ${r.documents} documents rendered as images, of `
      + `${r.lignesParDocument.moyenne.toFixed(1)} line(s) on average (at most ${r.lignesParDocument.maximum}).`);
    if (r.paliersEcartes.length) {
      console.log(`  ${r.paliersEcartes.length} tier(s) set aside — ${r.paliersEcartes.join(", ")} `
        + `— do not read the text: their cost would be zero by construction.`);
    }
    console.log("");
    console.log("  tier       from the text          from the image         gap");
    for (const p of r.paliers) {
      const T = rate(Math.round(p.surTexte.taux * p.surTexte.n), p.surTexte.n);
      const I = rate(Math.round(p.surImage.taux * p.surImage.n), p.surImage.n);
      console.log(`  ${p.palier.padEnd(10)} ${writeRate(T).padEnd(22)} ${writeRate(I).padEnd(22)} `
        + `${Math.abs(p.ecartEnPoints) < 0.05 ? "" : p.ecartEnPoints > 0 ? "-" : "+"}`
        + `${Math.abs(p.ecartEnPoints).toFixed(1)} pts`
        + `${p.separable ? "" : "  (indistinguishable from noise)"}`);
    }
    writeFileSync(SORTIE, JSON.stringify(r, null, 2) + "\n");
    console.log(`\n  Written to ${SORTIE.split("/").pop()}\n`);
  } catch (e) {
    process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  }
}
