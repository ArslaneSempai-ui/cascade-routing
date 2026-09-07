/* PARTAGÉ DANS LA FAMILLE CASCADE — source : cascade
   Les dépôts de la famille (cascade, -screening, -monitoring, -scoring, -dossier) en portent
   une copie identique AU BYTE. Corrigez-le dans la source, puis recopiez : la famille est
   EXCLUE de la diffusion d'identite (depots.json), aucune diffusion ne viendra le faire à
   votre place. `couche-famille.test.ts` compare les octets, nomme la direction du retard, et
   refuse aussi un fichier identique dans deux dépôts qui ne porte PAS cet en-tête — c'est
   ainsi qu'une copie neuve se déclare au lieu de dériver en silence. */
/*
 * LE GARDIEN DE LA COUCHE IDENTITE, pour un dépôt EXCLU de la diffusion.
 *
 * Le trou, mesuré le 12/09/2026 : ce dépôt porte cli.ts, figures.ts et interval.ts avec
 * l'en-tête « PARTAGÉ — la source est ~/Documents/identite », il est EXCLU de la diffusion
 * (depots.json d'identite, comme toute la famille cascade), et AUCUN test ne comparait sa
 * copie à la source. Une dérive y restait invisible : npm test vert sur une couche que
 * personne ne regardait — le périmètre du gardien, la faute déjà payée le 21/08 (« le titre
 * promettait la couche, le corps regardait deux fichiers »).
 *
 * La forme suit registre.test.ts des dépôts du portfolio :
 *   - la liste des fichiers gardés se DÉDUIT du disque (tout fichier de code de src/
 *     présent aussi à la racine d'identite, tests exclus), jamais codée en dur ;
 *   - le contenu se compare EXACT (readFileSync ===), aucune normalisation ;
 *   - la source se trouve par IDENTITE= ou ../../identite, et un clone seul obtient un
 *     SKIP NOMMÉ — un saut muet serait un mensonge poli ;
 *   - le diagnostic distingue par les dates de modification : « source en avance »
 *     (recopier À LA MAIN depuis identite : ce dépôt est exclu de la diffusion, elle ne
 *     viendra pas le faire) et « dérive locale » (corriger DANS identite, puis recopier —
 *     une correction locale ne voyagera pas).
 *
 * Le détecteur porte son témoin, joué sur des dossiers fabriqués : s'il ne voyait plus une
 * copie divergente dans les deux directions, son zéro ne prouverait rien.
 *
 * NOTE de périmètre, refermée le 13/09 : la couche de FAMILLE — les fichiers partagés entre
 * les cinq dépôts cascade SANS passer par identite — n'était pas gardée ici, faute de source
 * déclarée. Elle en a une depuis : chaque fichier porte « PARTAGÉ DANS LA FAMILLE CASCADE —
 * source : <dépôt> », et `couche-famille.test.ts` la tient. Ce fichier-ci ne regarde que la
 * couche venue d'identite ; les deux périmètres sont disjoints et chacun le dit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, utimesSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** Un fichier de code — harnais et déclarations compris : `registre.test.ts`, `capturer.test.mjs`
 *  et `graphes.d.ts` viennent d'identite comme les autres, et une divergence y ferait le même
 *  mal. La première version les écartait, et écartait donc six des seize fichiers gardés. */
const codePartage = (nom: string) => /\.(ts|mjs|js|css)$/.test(nom);

/** L'en-tête qu'identite pose sur la première ligne de tout ce qu'elle diffuse. */
const MARQUE_IDENTITE = /PARTAGÉ — la source de ce fichier est ~\/Documents\/identite/;
/** L'en-tête se cherche dans la TÊTE du fichier, jamais dans son corps.
 *  Les deux gardiens de couche CITENT le motif dans leur propre code : cherché partout, il
 *  se trouvait lui-même, et chacun se déclarait membre de la couche de l'autre. Un gardien
 *  qui se prend pour ce qu'il garde rend un rouge faux ou un vert vide, selon le sens. */
const tete = (texte: string) => texte.split("\n", 12).join("\n");


/** Les retards entre la source (racine d'identite) et les copies (src/ d'ici).
 *
 *  L'APPARTENANCE SE LIT DANS LE FICHIER, PAS DANS SON NOM. La première version comparait
 *  tout fichier de même nom, et elle a rougi sur `clone-neuf.mjs` : identite en a un, cascade
 *  en a un autre, et identite le DIT elle-même sur sa première ligne (« cascade porte sa
 *  PROPRE copie ; celle-ci ne voyage pas »). Un gardien qui accuse une exception déclarée
 *  apprend à son lecteur à le contourner. Une copie est donc gardée si elle porte l'en-tête —
 *  ou si elle est identique à la source sans le porter, car alors l'en-tête s'est perdu et
 *  c'est exactement ce qu'il faut voir.
 */
export function retards(sourceDir: string, copieDir: string): { compares: number; fautes: string[] } {
  let compares = 0;
  const fautes: string[] = [];
  for (const nom of readdirSync(copieDir).filter(codePartage)) {
    const ici = join(copieDir, nom);
    if (!statSync(ici).isFile()) continue;
    const texte = readFileSync(ici, "utf8");
    const declare = MARQUE_IDENTITE.test(tete(texte));
    const la = join(sourceDir, nom);
    if (!existsSync(la)) {
      if (declare) fautes.push(`${nom} (l'en-tête déclare identite, mais identite ne porte pas `
        + "ce fichier : la source a été renommée ou retirée sans que la copie le sache)");
      continue;
    }
    const source = readFileSync(la, "utf8");
    if (!declare && texte !== source) continue;   /* un fichier PROPRE à ce dépôt, de même nom */
    compares++;
    if (texte === source) {
      if (!declare) fautes.push(`${nom} (identique à identite mais SANS son en-tête : la copie `
        + "est sortie de la garde en silence ; remettez la première ligne)");
      continue;
    }
    const cause = statSync(la).mtimeMs > statSync(ici).mtimeMs
      ? "source en avance : recopier À LA MAIN depuis identite — ce dépôt est EXCLU de la "
        + "diffusion (depots.json), elle ne viendra pas le faire"
      : "dérive locale : corriger DANS identite puis recopier — une correction faite ici "
        + "ne voyagera pas";
    fautes.push(`${nom} (${cause})`);
  }
  return { compares, fautes };
}

test("le détecteur voit une copie divergente, et sait ce qui ne lui appartient pas : témoin", () => {
  const d = mkdtempSync(join(tmpdir(), "couche-temoin-"));
  const enTete = "/* PARTAGÉ — la source de ce fichier est ~/Documents/identite */\n";
  try {
    const source = join(d, "source"), copie = join(d, "copie");
    for (const dir of [source, copie]) {
      mkdirSync(dir);
      writeFileSync(join(dir, "interval.ts"), enTete + "export const wilson = 1;\n");
    }
    assert.deepEqual(retards(source, copie).fautes, [], "identiques : aucun retard attendu");
    assert.equal(retards(source, copie).compares, 1, "le témoin doit avoir comparé");

    writeFileSync(join(source, "interval.ts"), enTete + "export const wilson = 2;\n");
    utimesSync(join(copie, "interval.ts"), new Date(0), new Date(0));
    const avance = retards(source, copie).fautes;
    assert.equal(avance.length, 1);
    assert.match(avance[0]!, /source en avance/, "la source plus récente doit se nommer");

    writeFileSync(join(copie, "interval.ts"), enTete + "export const wilson = 3;\n");
    utimesSync(join(source, "interval.ts"), new Date(0), new Date(0));
    const derive = retards(source, copie).fautes;
    assert.equal(derive.length, 1);
    assert.match(derive[0]!, /dérive locale/, "la copie plus récente doit se nommer");

    /* LE CAS QUI A FAIT ROUGIR À TORT, joué ici pour qu'il ne revienne pas : un fichier de
       même nom, propre au dépôt, qu'identite déclare elle-même ne pas diffuser. */
    writeFileSync(join(source, "clone-neuf.mjs"), enTete + "// la sonde locale d'identite\n");
    writeFileSync(join(copie, "clone-neuf.mjs"), "#!/usr/bin/env node\n// la version du dépôt\n");
    assert.deepEqual(retards(source, copie).fautes.filter((f) => f.startsWith("clone-neuf")), [],
      "un fichier propre au dépôt, sans en-tête et différent, n'appartient pas à la couche");

    /* Mais une copie identique QUI A PERDU son en-tête est sortie de la garde en silence. */
    writeFileSync(join(copie, "clone-neuf.mjs"), enTete + "// la sonde locale d'identite\n");
    writeFileSync(join(copie, "clone-neuf.mjs"), "// la sonde locale d'identite\n");
    writeFileSync(join(source, "clone-neuf.mjs"), "// la sonde locale d'identite\n");
    writeFileSync(join(source, "clone-neuf.mjs"), enTete + "// la sonde locale d'identite\n");
    writeFileSync(join(copie, "clone-neuf.mjs"), enTete + "// la sonde locale d'identite\n");
    writeFileSync(join(copie, "perdu.ts"), "export const x = 1;\n");
    writeFileSync(join(source, "perdu.ts"), "export const x = 1;\n");
    const perdu = retards(source, copie).fautes.filter((f) => f.startsWith("perdu"));
    assert.equal(perdu.length, 1, "identique à identite sans en-tête : la garde doit le dire");
    assert.match(perdu[0]!, /SANS son en-tête/);

    /* Et une copie qui se réclame d'identite alors que la source a disparu. */
    writeFileSync(join(copie, "orphelin.ts"), enTete + "export const y = 1;\n");
    const orphelin = retards(source, copie).fautes.filter((f) => f.startsWith("orphelin"));
    assert.equal(orphelin.length, 1);
    assert.match(orphelin[0]!, /identite ne porte pas ce fichier/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("les couches partagées sont bien celles d'identite (dépôt exclu : recopie à la main)", (t) => {
  const source = [
    process.env["IDENTITE"],
    fileURLToPath(new URL("../../identite/", import.meta.url)),
  ].filter((x): x is string => typeof x === "string" && x.length > 0)
    .map((x) => (x.endsWith("/") ? x : x + "/"))
    .find((x) => existsSync(x + "interval.ts"));
  if (!source) {
    return t.skip("dépôt cloné seul : identite n'est pas là, aucune couche n'a été comparée.\n"
      + "  Pour le faire tourner ici : IDENTITE=<chemin vers identite> npm test");
  }
  const r = retards(source, racine + "src/");
  assert.ok(r.compares >= 3,
    `${r.compares} fichier(s) comparé(s) : la couche en porte au moins trois (cli, figures, `
    + "interval) — un balayage qui en lit moins ne regarde pas");
  assert.deepEqual(r.fautes, [],
    "des copies de la couche identite ont divergé ; la cause et le geste sont dans chaque ligne");
});
