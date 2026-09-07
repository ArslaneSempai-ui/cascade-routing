/* PARTAGÉ DANS LA FAMILLE CASCADE — source : cascade
   Les dépôts de la famille (cascade, -screening, -monitoring, -scoring, -dossier) en portent
   une copie identique AU BYTE. Corrigez-le dans la source, puis recopiez : la famille est
   EXCLUE de la diffusion d'identite (depots.json), aucune diffusion ne viendra le faire à
   votre place. `couche-famille.test.ts` compare les octets, nomme la direction du retard, et
   refuse aussi un fichier identique dans deux dépôts qui ne porte PAS cet en-tête — c'est
   ainsi qu'une copie neuve se déclare au lieu de dériver en silence. */
/*
 * LE GARDIEN DE LA COUCHE DE FAMILLE.
 *
 * Le trou, nommé par `couche-identite.test.ts` le 12/09/2026 et refermé le 13 : les cinq
 * outils cascade se partagent des fichiers qui ne passent PAS par identite — le calcul de
 * l'empreinte, le vérificateur public de rapport, deux harnais, le lecteur de CSV. Ils
 * étaient recopiés à la main, sans source déclarée et sans comparaison. Une correction faite
 * dans l'un restait dans l'un, et `npm test` était vert dans les cinq.
 *
 * Ce que ça coûtait précisément : `empreinteDuReleve` existait en DEUX exemplaires, une
 * fonction dans le measure.ts de cascade-routing et un fichier dans les quatre autres. Deux
 * fonctions de scellé, c'est deux comportements le jour où l'une bouge — et un relevé scellé
 * par un outil que l'autre déclarerait intact à tort. Elles ont été réunies dans
 * `empreinte.ts` ; ce fichier-ci prouve qu'elles le restent.
 *
 * LA FORME, reprise de `couche-identite.test.ts` et de `registre.test.ts` :
 *   - la liste des fichiers gardés se DÉDUIT du disque : tout fichier de src/ qui porte
 *     l'en-tête « PARTAGÉ DANS LA FAMILLE CASCADE — source : <dépôt> ». Jamais codée en dur,
 *     donc un fichier neuf entre dans la garde en portant son en-tête, pas en modifiant
 *     celle-ci ;
 *   - la comparaison est EXACTE (octet pour octet), aucune normalisation ;
 *   - un dépôt cloné seul obtient un SKIP NOMMÉ — un saut muet serait un mensonge poli ;
 *   - le diagnostic distingue par les dates de modification quel exemplaire a bougé, et
 *     rappelle DANS QUEL dépôt corriger, puisque la correction ne voyagera pas toute seule.
 *
 * LE PIÈGE QUE CETTE GARDE FERME EN PLUS : une copie identique qui ne se déclare pas. Sans
 * ça, il suffirait de recopier un fichier de plus sans en-tête pour retrouver exactement la
 * situation d'avant — une couche partagée que rien ne regarde. Deux exemplaires identiques
 * dans deux dépôts de la famille sont donc une faute tant qu'ils ne portent pas leur source.
 *
 * Le détecteur porte son témoin, joué sur des dossiers fabriqués, et il doit rougir dans les
 * quatre directions : source en avance, copie en avance, déclaration absente, copie non
 * déclarée. Un contrôle qui n'a jamais dit non ne vaut rien.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const racine = fileURLToPath(new URL("..", import.meta.url));
/** Le dossier qui contient les dépôts de la famille — ~/Documents chez nous. */
const voisinage = fileURLToPath(new URL("../../", import.meta.url));
const FAMILLE = ["cascade", "cascade-screening", "cascade-monitoring", "cascade-scoring", "cascade-dossier"];

/** Un fichier de code : la couche, pas les données ni les documents. Les harnais EN sont,
 *  eux : `sans-cadratin.test.ts` est partagé, et c'est justement lui qu'on ne veut pas voir
 *  diverger d'un dépôt à l'autre. */
const codePartage = (nom: string) => /\.(ts|mjs|js|css)$/.test(nom) && !nom.endsWith(".d.ts");

const MARQUE = /PARTAGÉ DANS LA FAMILLE CASCADE — source : ([a-z0-9-]+)/;
/** Le texte SANS son en-tête de famille. Il ne sert qu'à une chose : reconnaître une copie
 *  dont l'en-tête a été retiré. Une copie muette ne peut jamais être identique au byte à une
 *  copie déclarée — l'en-tête est dans les octets — et la première version de cette garde
 *  cherchait donc une égalité impossible : la règle « déclaration absente » était morte, et
 *  seul son témoin l'a dit. */
const corps = (texte: string) => texte.replace(/\/\* PARTAGÉ DANS LA FAMILLE CASCADE[\s\S]*?\*\/\n/, "");
/** L'autre en-tête de partage, celui d'identite : ces fichiers-là ont leur propre gardien
 *  (`couche-identite.test.ts`), et les deux périmètres doivent rester disjoints. */
const MARQUE_IDENTITE = /PARTAGÉ — la source de ce fichier est ~\/Documents\/identite/;
/** L'en-tête se cherche dans la TÊTE du fichier, jamais dans son corps.
 *  Les deux gardiens de couche CITENT le motif dans leur propre code : cherché partout, il
 *  se trouvait lui-même, et chacun se déclarait membre de la couche de l'autre. Un gardien
 *  qui se prend pour ce qu'il garde rend un rouge faux ou un vert vide, selon le sens. */
const tete = (texte: string) => texte.split("\n", 12).join("\n");


export type Exemplaire = { depot: string; texte: string; date: number };

/** Ce que chaque dépôt présent porte, par nom de fichier. */
export function releverLesCopies(depots: { nom: string; src: string }[]): Map<string, Exemplaire[]> {
  const par_nom = new Map<string, Exemplaire[]>();
  for (const d of depots) {
    if (!existsSync(d.src)) continue;
    /* EN DESCENDANT : src/ a des sous-dossiers (ocr, matchers, fixtures, scenarios, facteurs,
       controles). Aucun ne porte de copie partagée aujourd'hui — mesuré le 13/09 — et c'est
       précisément pourquoi le balayage doit y aller : la première qu'on y posera sera vue le
       jour où on la pose, pas le jour où quelqu'un y pense. Un gardien qui lit moins que ce
       que son titre annonce est la faute payée le 21/08. */
    for (const e of readdirSync(d.src, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !codePartage(e.name)) continue;
      const p = join(e.parentPath ?? d.src, e.name);
      const cle = p.slice(d.src.replace(/\/?$/, "/").length);
      const liste = par_nom.get(cle) ?? [];
      liste.push({ depot: d.nom, texte: readFileSync(p, "utf8"), date: statSync(p).mtimeMs });
      par_nom.set(cle, liste);
    }
  }
  return par_nom;
}

/** Les fautes de la couche de famille : divergences, déclarations manquantes ou discordantes,
 *  et copies identiques qui ne se déclarent pas. `fichiers` compte les noms réellement
 *  comparés — un balayage qui n'en lit aucun ne prouve rien, et l'appelant doit le refuser. */
export function fautesDeFamille(par_nom: Map<string, Exemplaire[]>): { fichiers: number; fautes: string[] } {
  const fautes: string[] = [];
  let fichiers = 0;
  for (const [nom, copies] of [...par_nom].sort()) {
    if (copies.length < 2) continue;
    if (copies.some((c) => MARQUE_IDENTITE.test(tete(c.texte)))) continue;
    const tous = copies.map((c) => ({ ...c, source: tete(c.texte).match(MARQUE)?.[1] ?? null }));
    const declarees = tous.filter((c) => c.source !== null);

    /* L'EN-TÊTE DÉFINIT UN GROUPE, PAS UN NOM DE FICHIER. Un même nom peut porter un fichier
       PROPRE à un outil : frontiere.test.ts nomme les téléchargeurs autorisés, et screening en
       a deux quand les trois autres n'en ont aucun. Une copie sans en-tête n'est donc pas en
       faute par principe — elle l'est si elle est identique à un membre du groupe (l'en-tête
       s'est perdu en route) ou à une autre copie muette (une recopie que rien ne regarde). */
    if (declarees.length > 0) {
      fichiers++;
      const sources = new Set(declarees.map((c) => c.source));
      if (sources.size > 1) {
        fautes.push(`${nom} : sources déclarées CONTRADICTOIRES — `
          + declarees.map((c) => `${c.depot} dit « ${c.source} »`).join(", "));
        continue;
      }
      const source = [...sources][0]!;
      const groupes = new Map<string, string[]>();
      for (const c of declarees) groupes.set(c.texte, [...(groupes.get(c.texte) ?? []), c.depot]);
      if (groupes.size > 1) {
        const recent = declarees.reduce((a, b) => (b.date > a.date ? b : a));
        const geste = recent.depot === source
          ? `${source} (la source) a avancé : recopier À LA MAIN dans les autres — la famille `
            + "est exclue de la diffusion, elle ne viendra pas le faire"
          : `${recent.depot} a dérivé le dernier : corriger DANS ${source}, puis recopier partout `
            + "— une correction faite ailleurs ne voyagera pas";
        fautes.push(`${nom} : ${groupes.size} versions (`
          + [...groupes.values()].map((g) => g.join("+")).join(" ≠ ") + `) ; ${geste}. Si la `
          + "divergence est VOULUE, retirez l'en-tête de la copie qui part : elle quitte le "
          + "groupe, et le dépôt en devient responsable seul");
      }
      const corpsDeclares = new Set([...groupes.keys()].map(corps));
      const perdus = tous.filter((c) => c.source === null && corpsDeclares.has(c.texte));
      if (perdus.length > 0) {
        fautes.push(`${nom} : déclaration absente dans ${perdus.map((c) => c.depot).join(", ")} `
          + `— la copie est identique au groupe de ${source} mais ne porte plus son en-tête`);
      }
    }

    const muettes = tous.filter((c) => c.source === null
      && !declarees.some((d) => corps(d.texte) === c.texte));
    const memes = new Map<string, string[]>();
    for (const c of muettes) memes.set(c.texte, [...(memes.get(c.texte) ?? []), c.depot]);
    /* DEUX exemplaires identiques suffisent, pas tous. La première version exigeait que TOUTES
       les copies le soient : recopier screening/synthetic.ts dans dossier passait alors au vert,
       puisque monitoring et scoring en portent une version différente — la situation d'avant,
       exactement. Trouvé en jouant la garde contre une vraie copie, et la règle corrigée a
       aussitôt sorti cinq fichiers de plus que l'inventaire fait à la main. */
    for (const [, groupe] of memes) {
      if (groupe.length < 2) continue;
      if (declarees.length === 0) fichiers++;
      fautes.push(`${nom} : identique dans ${groupe.join(", ")} sans en-tête de partage — `
        + "déclarez-le (« PARTAGÉ DANS LA FAMILLE CASCADE — source : <dépôt> ») ou laissez-le "
        + "diverger, mais pas une copie que rien ne regarde");
    }
  }
  return { fichiers, fautes };
}

test("le détecteur rougit dans les quatre directions : témoin", () => {
  const d = mkdtempSync(join(tmpdir(), "famille-temoin-"));
  const enTete = (s: string) => `/* PARTAGÉ DANS LA FAMILLE CASCADE — source : ${s} */\n`;
  try {
    const depots = ["source", "copie"].map((nom) => {
      const src = join(d, nom, "src");
      mkdirSync(src, { recursive: true });
      return { nom: nom === "source" ? "cascade" : "cascade-copie", src };
    });
    const ecrire = (i: number, nom: string, t: string) => writeFileSync(join(depots[i]!.src, nom), t);
    const jouer = () => fautesDeFamille(releverLesCopies(depots));

    for (const i of [0, 1]) ecrire(i, "empreinte.ts", enTete("cascade") + "export const a = 1;\n");
    assert.deepEqual(jouer().fautes, [], "deux copies identiques et déclarées : rien à dire");
    assert.equal(jouer().fichiers, 1, "le témoin doit avoir comparé un fichier");

    ecrire(0, "empreinte.ts", enTete("cascade") + "export const a = 2;\n");
    utimesSync(join(depots[1]!.src, "empreinte.ts"), new Date(0), new Date(0));
    const avance = jouer().fautes;
    assert.equal(avance.length, 1);
    assert.match(avance[0]!, /la source\) a avancé/, "la source plus récente doit se nommer");

    ecrire(1, "empreinte.ts", enTete("cascade") + "export const a = 3;\n");
    utimesSync(join(depots[0]!.src, "empreinte.ts"), new Date(0), new Date(0));
    assert.match(jouer().fautes[0]!, /cascade-copie a dérivé le dernier/, "la dérive locale doit se nommer");

    ecrire(1, "empreinte.ts", "export const a = 2;\n");
    assert.match(jouer().fautes[0]!, /déclaration absente dans cascade-copie/, "l'en-tête retiré doit se voir");

    ecrire(0, "empreinte.ts", enTete("cascade-copie") + "export const a = 2;\n");
    ecrire(1, "empreinte.ts", enTete("cascade") + "export const a = 2;\n");
    assert.match(jouer().fautes[0]!, /sources déclarées CONTRADICTOIRES/, "deux sources doivent se voir");

    rmSync(join(depots[0]!.src, "empreinte.ts")); rmSync(join(depots[1]!.src, "empreinte.ts"));
    for (const i of [0, 1]) ecrire(i, "neuf.ts", "export const b = 1;\n");
    const muet = jouer();
    assert.equal(muet.fautes.length, 1, "une copie identique non déclarée est une faute");
    assert.match(muet.fautes[0]!, /sans en-tête de partage/);

    ecrire(1, "neuf.ts", "export const b = 2;\n");
    assert.deepEqual(jouer().fautes, [], "deux fichiers DIFFÉRENTS de même nom ne sont pas une copie");

    /* Le cas qui a échappé à la première version : parmi trois exemplaires, DEUX identiques.
       C'est la forme réelle d'une copie neuve — on recopie depuis un dépôt, les autres gardent
       la leur — et exiger l'unanimité laissait passer exactement ça. */
    const tiers = { nom: "cascade-tiers", src: join(d, "tiers", "src") };
    mkdirSync(tiers.src, { recursive: true });
    depots.push(tiers);
    writeFileSync(join(tiers.src, "neuf.ts"), "export const b = 1;\n");
    const deux = jouer().fautes;
    assert.equal(deux.length, 1, "deux exemplaires identiques sur trois sont une copie non déclarée");
    assert.match(deux[0]!, /identique dans cascade, cascade-tiers sans en-tête/);
    depots.pop();
    rmSync(join(d, "tiers"), { recursive: true, force: true });

    /* Et le balayage descend : une copie posée dans un sous-dossier se voit comme les autres. */
    for (const i of [0, 1]) {
      mkdirSync(join(depots[i]!.src, "matchers"), { recursive: true });
      writeFileSync(join(depots[i]!.src, "matchers", "profond.ts"), "export const d = 1;\n");
    }
    assert.ok(jouer().fautes.some((f) => f.startsWith("matchers/profond.ts")),
      "un fichier de sous-dossier doit être lu : sinon le titre promet plus que le corps");
    for (const i of [0, 1]) rmSync(join(depots[i]!.src, "matchers"), { recursive: true, force: true });

    for (const i of [0, 1]) ecrire(i, "interval.ts",
      "/* PARTAGÉ — la source de ce fichier est ~/Documents/identite */\nexport const c = 1;\n");
    assert.deepEqual(jouer().fautes, [], "la couche identite a son propre gardien : hors périmètre ici");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("la couche de famille est identique dans les dépôts présents", (t) => {
  const moi = basename(racine.replace(/\/$/, ""));
  const depots = [
    { nom: moi, src: racine + "src/" },
    ...FAMILLE.filter((n) => n !== moi)
      .map((n) => ({ nom: n, src: join(voisinage, n, "src/") }))
      .filter((d) => existsSync(d.src)),
  ];
  if (depots.length < 2) {
    return t.skip("dépôt cloné seul : aucun autre dépôt de la famille n'est à côté, aucune "
      + "couche n'a été comparée.\n  Pour le faire tourner : cloner les dépôts de la famille "
      + "côte à côte, puis npm test");
  }
  const r = fautesDeFamille(releverLesCopies(depots));
  assert.ok(r.fichiers >= 5,
    `${r.fichiers} fichier(s) comparé(s) avec ${depots.length - 1} dépôt(s) voisin(s) : la couche `
    + "en porte au moins cinq (empreinte, verifier-rapport, et les harnais partagés) — un "
    + "balayage qui en lit moins ne regarde pas ce qu'il annonce");
  assert.deepEqual(r.fautes, [],
    "la couche de famille a divergé ; chaque ligne porte le geste et le dépôt où corriger");
});
