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

type Cle = {
  additionsBeyondTheProse: { case: string; field: string; reading: string; addedOn: string; why: string }[];
  cases: { id: string; field: string; ambiguousHere: boolean; readings: string[];
    silenceAccepted: boolean; collapsesBecause?: string }[];
};

const CLE = new URL("../cas-ambigus.json", import.meta.url).pathname;
const PROSE = new URL("../corpus-dur/cas-ambigus.md", import.meta.url).pathname;

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

test("la clé ne déclare aucune lecture que le corpus ne contient pas", () => {
  if (!existsSync(CLE) || !existsSync(PROSE)) return;
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

test("aucun cas déclaré par le corpus ne disparaît de la clé", () => {
  if (!existsSync(CLE) || !existsSync(PROSE)) return;
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

test("un cas rendu non ambigu par notre schéma dit pourquoi, et n'en garde qu'une lecture", () => {
  if (!existsSync(CLE)) return;
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

test("toute lecture ajoutée porte sa date et sa raison", () => {
  if (!existsSync(CLE)) return;
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
