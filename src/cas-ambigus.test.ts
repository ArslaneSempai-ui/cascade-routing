/*
 * LA CLÉ DES CAS AMBIGUS NE PEUT NI ÉLARGIR NI RÉTRÉCIR CE QUE LE CORPUS DÉCLARE.
 *
 * Le corpus énonce ses lectures défendables en prose, écrites et datées avant toute mesure. La
 * clé lisible par la machine est, elle, écrite à la main — et c'est le point faible : une liste
 * élargie après coup se choisit toute seule pour donner le résultat qu'on veut, et une liste
 * rétrécie punit un palier pour avoir eu raison autrement.
 *
 * Ces tests ferment les deux côtés. Toute lecture de la clé doit apparaître dans la prose du
 * cas correspondant, sauf si elle figure dans `additionsBeyondTheProse` avec sa date et sa
 * raison. Et tout cas déclaré par la prose doit être dans la clé, ramené aux cas difficiles ou
 * non — disparaître en silence est la même faute que s'élargir en silence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { normaliserReponse } from "./tiers.ts";
import { fileURLToPath } from "node:url";

type Cle = {
  additionsBeyondTheProse: { case: string; field: string; reading: string; addedOn: string; why: string }[];
  cases: { id: string; field: string; ambiguousHere: boolean; readings: string[];
    silenceAccepted: boolean; collapsesBecause?: string }[];
};

const CLE = fileURLToPath(new URL("../cas-ambigus.json", import.meta.url));
const PROSE = fileURLToPath(new URL("../corpus-dur/cas-ambigus.md", import.meta.url));

const charger = () => ({
  cle: JSON.parse(readFileSync(CLE, "utf8")) as Cle,
  prose: readFileSync(PROSE, "utf8"),
});

/** Le bloc de prose d'un cas, du titre au titre suivant. */
function bloc(prose: string, id: string): string {
  const i = prose.indexOf(`### ${id} — `);
  assert.notEqual(i, -1, `le corpus ne contient pas de cas ${id}.`);
  const j = prose.indexOf("\n### ", i + 1);
  return prose.slice(i, j === -1 ? prose.length : j);
}

test("la clé ne déclare aucune lecture que le corpus ne contient pas", (t) => {
  if (!existsSync(CLE) || !existsSync(PROSE)) return t.skip("!existsSync(CLE) || !existsSync(PROSE) — ce cas n'a rien regardé, et il le dit.");
  const { cle, prose } = charger();
  const ajoutees = new Set(cle.additionsBeyondTheProse.map((a) => `${a.case}|${normaliserReponse(a.reading)}`));

  let verifiees = 0;
  for (const c of cle.cases) {
    const b = normaliserReponse(bloc(prose, c.id));
    for (const l of c.readings) {
      verifiees++;
      if (ajoutees.has(`${c.id}|${normaliserReponse(l)}`)) continue;
      assert.ok(b.includes(normaliserReponse(l)),
        `${c.id} : la clé accepte « ${l} », que la prose du cas ne contient pas.\n`
        + `  → soit la lecture vient du corpus et il faut la citer telle qu'elle y figure,\n`
        + `    soit c'est un élargissement, et il va dans « additionsBeyondTheProse » avec sa date.`);
    }
  }
  assert.ok(verifiees >= 20, `${verifiees} lecture(s) vérifiée(s) : trop peu pour que ce test ait regardé.`);
});

test("aucun cas déclaré par le corpus ne disparaît de la clé", (t) => {
  if (!existsSync(CLE) || !existsSync(PROSE)) return t.skip("!existsSync(CLE) || !existsSync(PROSE) — ce cas n'a rien regardé, et il le dit.");
  const { cle, prose } = charger();

  /* Les cas ramenés en fin de fichier comme « pas assez ambigus » ne comptent pas : le corpus
     les nomme comme écartés à l'écriture, pas comme cas. On ne prend que les `### AMn`. */
  const declares = [...prose.matchAll(/^### (AM\d+) — /gm)].map((m) => m[1]!);
  assert.equal(declares.length, 14, `${declares.length} cas trouvés dans la prose, 14 attendus.`);

  const dansLaCle = new Set(cle.cases.map((c) => c.id));
  for (const id of declares) {
    assert.ok(dansLaCle.has(id),
      `${id} est déclaré par le corpus et absent de la clé — un cas qui disparaît est un corpus choisi.`);
  }
  assert.equal(cle.cases.length, declares.length,
    "la clé contient un cas que le corpus ne déclare pas.");
});

test("un cas rendu non ambigu par notre schéma dit pourquoi, et n'en garde qu'une lecture", (t) => {
  if (!existsSync(CLE)) return t.skip("!existsSync(CLE) — ce cas n'a rien regardé, et il le dit.");
  const { cle } = charger();
  const ramenes = cle.cases.filter((c) => !c.ambiguousHere);
  assert.ok(ramenes.length >= 1, "aucun cas ramené : le test ne vérifie rien.");
  for (const c of ramenes) {
    assert.ok(c.collapsesBecause && c.collapsesBecause.length > 20,
      `${c.id} est déclaré non ambigu sans dire ce qui l'aplatit.`);
    assert.equal(c.readings.length, 1,
      `${c.id} est déclaré non ambigu mais garde ${c.readings.length} lectures : l'un des deux est faux.`);
  }
  /* Et l'inverse : un cas ambigu ici doit vraiment porter plusieurs issues acceptables. */
  for (const c of cle.cases.filter((x) => x.ambiguousHere)) {
    assert.ok(c.readings.length + (c.silenceAccepted ? 1 : 0) >= 2,
      `${c.id} est déclaré ambigu avec une seule issue acceptable.`);
  }
});

test("toute lecture ajoutée porte sa date et sa raison", (t) => {
  if (!existsSync(CLE)) return t.skip("!existsSync(CLE) — ce cas n'a rien regardé, et il le dit.");
  const { cle } = charger();
  for (const a of cle.additionsBeyondTheProse) {
    assert.ok(/before any measurement/.test(a.addedOn),
      `l'ajout ${a.case}/« ${a.reading} » ne dit pas qu'il précède la mesure — s'il la suit, il est nul.`);
    assert.ok(a.why.length > 40, `l'ajout ${a.case}/« ${a.reading} » ne se justifie pas.`);
    const c = cle.cases.find((x) => x.id === a.case);
    assert.ok(c?.readings.includes(a.reading),
      `${a.case} déclare un ajout qui ne figure pas dans ses lectures.`);
  }
});

/*
 * Deux cas ne peuvent pas partager leur clé.
 *
 * `M1` désignait deux documents : un passeport allemand chez les malformés, un titre de voyage
 * onusien en quatre écritures chez les non-latins — deux fichiers écrits la même nuit sans se
 * relire. Le journal indexait sur l'identifiant seul, donc toute requête appariée y comparait
 * un passeport allemand à un document de l'ONU en croyant comparer deux paliers. Elle ne
 * rendait pas d'erreur : elle rendait un chiffre, et cinq champs sur cent soixante-quatre
 * disparaissaient de chaque appariement sans que rien ne le dise.
 */
test("aucune clé de cas dur n'en désigne deux", async () => {
  const { corpusDur } = await import("./corpus-dur.ts");
  const cas = corpusDur();
  const vues = new Map<string, string>();
  for (const c of cas) {
    const deja = vues.get(c.cle);
    assert.equal(deja, undefined,
      `la clé ${c.cle} désigne un cas de ${deja} et un cas de ${c.source}.`);
    vues.set(c.cle, c.source);
  }
  assert.equal(vues.size, cas.length);
  assert.ok(cas.length >= 30, `${cas.length} cas : la lecture du corpus a échoué.`);

  /* Et la clé doit vraiment porter son fichier, sinon deux `M1` se recroiseront. */
  const doubles = cas.filter((c) => cas.filter((x) => x.id === c.id).length > 1);
  assert.ok(doubles.length >= 2,
    "aucun identifiant partagé dans le corpus : ce test ne vérifie plus rien.\n"
    + "  → si le corpus a été renommé, retirer ce test ; tant qu'il y a deux M1, il tient.");
  assert.equal(new Set(doubles.map((c) => c.cle)).size, doubles.length,
    "des cas partagent leur identifiant et leur clé : la clé ne les sépare pas.");
});

/*
 * Le compte des formulations survivantes est mécanique, pas déclaré.
 *
 * Les vingt du corpus supposent cinq champs en un appel ; la chaîne en extrait un par appel.
 * Cinq d'entre elles perdent leur axe au transport et deviennent identiques à la base. Le
 * drapeau `garde` est une déclaration humaine ; le rendu, lui, se compare caractère par
 * caractère. Ce test exige que les deux disent la même chose — sinon quelqu'un annoncera vingt
 * formulations en en mesurant quinze, ce qui gonfle l'apparente couverture d'un tiers.
 */
test("les formulations déclarées effondrées sont exactement celles qui rendent la base", async () => {
  const { FORMULATIONS, distinctes } = await import("./formulations.ts");
  assert.equal(FORMULATIONS.length, 20, "le corpus en déclare vingt.");

  const groupes = distinctes();
  const absorbees = new Set(groupes.flatMap((g) => g.absorbe));
  const declareesEffondrees = new Set(FORMULATIONS.filter((f) => !f.garde).map((f) => f.id));

  assert.deepEqual([...absorbees].sort(), [...declareesEffondrees].sort(),
    "le rendu et la déclaration ne s'accordent pas : une formulation est annoncée distincte et\n"
    + "  rend la base, ou l'inverse. C'est le rendu qui a raison.");
  assert.equal(groupes.length, FORMULATIONS.length - absorbees.size);
  assert.ok(absorbees.size >= 1, "aucune formulation absorbée : ce test ne vérifie plus rien.");

  /* Et chaque effondrement doit dire pourquoi — « elle a disparu » n'est pas une raison. */
  for (const f of FORMULATIONS.filter((x) => !x.garde)) {
    assert.ok(f.effondrement && f.effondrement.length > 25,
      `${f.id} est déclarée effondrée sans dire ce qui l'aplatit.`);
  }

  /* Les gardées doivent réellement différer entre elles, deux à deux. */
  const gardees = FORMULATIONS.filter((f) => f.garde);
  const rendus = new Set(gardees.map((f) => (["name", "birth", "document", "country", "address"] as const)
    .map((c) => f.rendre("<DOC>", c)).join(" ")));
  assert.equal(rendus.size, gardees.length,
    "deux formulations gardées rendent la même chose : le compte annoncé est trop grand.");
});
