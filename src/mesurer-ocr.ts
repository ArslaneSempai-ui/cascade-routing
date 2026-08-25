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
import { lire, texte as texteDesBlocs, ceQuiManque } from "./ocr.ts";
import { rate, writeRate, distinguishable } from "./interval.ts";
import type { TierName } from "./paliers.ts";

const SORTIE = fileURLToPath(new URL("../ocr.json", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Rendre un document en image, comme un scanner l'aurait produit.
 *
 * Police à chasse fixe et fond blanc : c'est le cas le plus favorable, et c'est voulu — on
 * cherche le PLANCHER du coût de l'étage, pas sa valeur sur une photographie de téléphone.
 */
function rendre(doc: ClientFile, dossier: string): string {
  const html = join(dossier, `${doc.id}.html`);
  const png = join(dossier, `${doc.id}.png`);
  const jpg = join(dossier, `${doc.id}.jpg`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>`
    + `body{width:820px;margin:0;padding:48px 56px;font-family:"Courier New",monospace;`
    + `font-size:16px;line-height:1.7;background:#fff;color:#111;white-space:pre-wrap}</style>`
    + doc.text.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  execFileSync(CHROME, ["--headless", "--disable-gpu", `--screenshot=${png}`,
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

export async function mesurer(combien = 120, paliers: TierName[] = [...ENCODEURS]) {
  const manque = ceQuiManque();
  if (manque) throw new Error(manque);
  if (!existsSync(CHROME)) {
    throw new Error(`Chrome is not there, and it is what RENDERS the documents as images here. `
      + `Without it there are no images to read, and this measurement has no object.`);
  }

  /* LE RELEVÉ NOMME LE CODE QUI L'A PRODUIT. Sans ça, un chiffre publié six semaines plus tard
     ne peut plus être refait : on ne sait pas quelle version l'a rendu. Et mesurer sur un arbre
     modifié nomme un commit qui n'est pas celui qui a tourné — pire qu'aucun nom. */
  const version = (() => {
    try {
      const cwd = fileURLToPath(new URL("..", import.meta.url));
      return {
        commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim(),
        sale: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim().length > 0,
      };
    } catch { return undefined; }
  })();
  if (version?.sale && !process.argv.includes("--arbre-modifie")) {
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
  let lignesTotal = 0, lignesMax = 0;
  const parPalier: Record<string, { texte: number; image: number; sur: number }> = {};
  for (const t of paliers) parPalier[t] = { texte: 0, image: 0, sur: 0 };

  for (const d of docs) {
    const blocs = lire(rendre(d, dossier));
    const luOCR = texteDesBlocs(blocs);
    const lignes = d.text.split("\n").length;
    lignesTotal += lignes; lignesMax = Math.max(lignesMax, lignes);
    const mots = d.text.split(/\s+/).filter((w) => w.length > 1);
    motsAttendus += mots.length;
    motsLus += mots.filter((w) => luOCR.includes(w)).length;

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
  const combien = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
  try {
    const r = await mesurer(combien);
    console.log(`\n  Transcription fidelity: `
      + `${writeRate(rate(Math.round(r.fideliteDeLaTranscription.taux * r.fideliteDeLaTranscription.n), r.fideliteDeLaTranscription.n))}`);
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
