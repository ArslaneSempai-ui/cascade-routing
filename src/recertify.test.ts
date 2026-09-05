import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  lireEvery, RYTHME_PAR_DEFAUT_JOURS, prochaineEcheance, chargerBaselineDepuis,
  jugerCellule, verdictDuChamp, codeDeSortie, casJoints, deriveDEntree,
  rendreRecertification, type Decisions, type VerdictCellule,
} from "./recertify.ts";
import { rate, ENOUGH } from "./interval.ts";
import { empreinteDuReleve } from "./measure.ts";
import { draw } from "./corpus.ts";

/* Une référence scellée minimale mais COMPLÈTE : les champs que `chargerBaselineDepuis`
   exige sont ceux que `releveClient` écrit toujours. */
function referenceScellee(): Record<string, unknown> {
  const b: Record<string, unknown> = {
    kind: "cascade-client-record", version: 1, measuredAt: "2026-06-01T00:00:00.000Z",
    code: null,
    source: { file: "printemps.csv", sha256: "ab".repeat(32), cases: 24, casesInFile: 24 },
    fields: ["name"],
    questions: { name: { texte: "What is the person's name?", provenance: "fournie" } },
    margin: null, tiers: ["small"], declared: {},
    extraction: { small: { name: {
      accuracy: 22 / 24, items: 24, low: 0.73, high: 0.977, latency: 3,
      reussites: "1".repeat(22) + "00", blank: 0, wrong: 2,
    } } },
    recommendation: {},
  };
  b.empreinte = empreinteDuReleve(b);
  return b;
}

test("le rythme se déclare en jours entiers, et tout le reste se refuse en le nommant", () => {
  assert.equal(lireEvery(undefined), RYTHME_PAR_DEFAUT_JOURS);
  assert.equal(lireEvery("30d"), 30);
  /* `Number()` accepterait « 90 », «  » et « 0x5a » sans un mot ; le motif, non. Chaque
     refus doit NOMMER ce qui a été reçu, sinon le lecteur relance la même commande. */
  for (const mauvais of ["90j", "", "0d", "abc", "90", "12.5d"]) {
    assert.throws(() => lireEvery(mauvais), (e: Error) => {
      assert.match(e.message, /is not a rhythm/);
      assert.ok(e.message.includes(`--every=${mauvais}`), `le refus de ${JSON.stringify(mauvais)} ne nomme pas ce qui a été reçu`);
      return true;
    });
  }
  assert.equal(prochaineEcheance("2026-06-01T00:00:00.000Z", 90), "2026-08-30");
});

test("holds : le taux du jour tombe dans l'intervalle de la référence", () => {
  const base = { accuracy: 22 / 24, low: 0.73, high: 0.977, items: 24 };
  const v = jugerCellule("small", "name", base, rate(21, 24));   /* 87,5 % ∈ [73–97,7] */
  assert.equal(v.verdict, "holds");
  assert.equal(v.sens, undefined);
});

test("moved, dans les deux sens — un taux qui monte a bougé aussi", () => {
  const base = { accuracy: 22 / 24, low: 0.73, high: 0.977, items: 24 };
  const bas = jugerCellule("small", "name", base, rate(15, 24)); /* 62,5 % < 73 */
  assert.equal(bas.verdict, "moved");
  assert.equal(bas.sens, "down");
  const haut = jugerCellule("small", "name", base, rate(24, 24)); /* 100 % > 97,7 */
  assert.equal(haut.verdict, "moved");
  assert.equal(haut.sens, "up");
});

test("sous ENOUGH observations, on ne tranche pas — et on dit de quel côté le compte manque", () => {
  const maigre = jugerCellule("small", "name", { accuracy: 0.9, low: 0.6, high: 0.98, items: 10 }, rate(20, 24));
  assert.equal(maigre.verdict, "undetermined");
  assert.match(maigre.pourquoi!, /baseline rests on 10/);
  assert.match(maigre.pourquoi!, new RegExp(String(ENOUGH)));
  const jour = jugerCellule("small", "name", { accuracy: 0.9, low: 0.73, high: 0.977, items: 24 }, rate(4, 5));
  assert.equal(jour.verdict, "undetermined");
  assert.match(jour.pourquoi!, /today's sample has 5/);
});

test("un seul palier qui bouge fait bouger le champ, et le code de sortie en fait un résultat", () => {
  const base = { accuracy: 22 / 24, low: 0.73, high: 0.977, items: 24 };
  const tient = jugerCellule("small", "name", base, rate(21, 24));
  const bouge = jugerCellule("large", "name", base, rate(15, 24));
  const flou = jugerCellule("rules", "name", base, rate(3, 5));
  assert.equal(verdictDuChamp([tient, bouge, flou]), "moved");
  assert.equal(verdictDuChamp([tient, flou]), "holds");
  assert.equal(verdictDuChamp([flou]), "undetermined");
  assert.equal(codeDeSortie(["holds", "moved"]), 1);
  assert.equal(codeDeSortie(["holds", "undetermined"]), 0);
  /* « rien de tranché » n'est pas « rien n'a changé » — le même refus que diff. */
  assert.equal(codeDeSortie(["undetermined"]), 2);
  assert.equal(codeDeSortie([]), 2);
});

test("l'agrégat monte, deux cas perdus — et le rapport les nomme", () => {
  /* 20 identifiants communs : avant, 15 passent ; après, 17 passent — l'agrégat MONTE —
     mais a et b, qui passaient, ne passent plus. C'est le cas que VALIDATION.md §6 décrit,
     et il doit être VISIBLE, pas absorbé par la moyenne. */
  const ids = "abcdefghijklmnopqrst".split("");
  const avant: Decisions = {}, apres: Decisions = {};
  for (const [i, id] of ids.entries()) {
    avant[id] = { small: { name: { outcome: i < 15 ? "clean" : "wrong" } } };
    const passaitAvant = i < 15;
    const perdu = id === "a" || id === "b";
    const gagne = i >= 15 && i < 19;                      /* p, q, r, s repassent */
    apres[id] = { small: { name: { outcome: (passaitAvant && !perdu) || gagne ? "clean" : "wrong" } } };
  }
  const j = casJoints(avant, apres, "small", "name");
  assert.equal(j.communs, 20);
  assert.deepEqual(j.perdus, ["a", "b"]);
  assert.equal(j.gagnes.length, 4);

  const cellule: VerdictCellule = {
    palier: "small", champ: "name",
    base: { rate: 0.75, low: 0.53, high: 0.89, n: 20 },
    nouveau: rate(17, 20), verdict: "holds",
  };
  const md = rendreRecertification({
    date: "2026-09-05", fichier: "automne.csv",
    baseline: { file: "printemps-measured.json", measuredAt: "2026-06-01T00:00:00.000Z", empreinte: "deadbeef00000000" },
    cas: 20, champs: ["name"], cellules: [cellule],
    verdictsParChamp: { name: "holds" }, cellulesEcartees: [],
    jointure: { regime: "by-id", parChamp: { name: j } },
    derive: { mesuree: false, pourquoi: "spring CSV not beside the record." },
    rythme: { jours: 90, declare: false, prochaine: "2026-12-04" },
  });
  assert.match(md, /lost: a, b/, "les deux cas perdus ne sont pas nommés dans le rapport");
  assert.match(md, /used to pass no longer do/, "le rapport ne dit pas ce que l'agrégat qui monte cache");
  assert.match(md, /2 lost, 4 gained/);
});

test("une référence retouchée se refuse, en citant les deux empreintes et l'issue", () => {
  const bon = referenceScellee();
  assert.equal(chargerBaselineDepuis(JSON.stringify(bon), "x.json").empreinte, bon.empreinte);

  const retouche = JSON.parse(JSON.stringify(bon)) as Record<string, unknown>;
  (retouche.extraction as Record<string, Record<string, { accuracy: number }>>).small!.name!.accuracy = 0.999;
  assert.throws(() => chargerBaselineDepuis(JSON.stringify(retouche), "x.json"), (e: Error) => {
    assert.match(e.message, /does not match its own fingerprint/);
    assert.ok(e.message.includes(String(bon.empreinte)), "le refus ne cite pas l'empreinte portée");
    assert.ok(e.message.includes(empreinteDuReleve(retouche)), "le refus ne cite pas l'empreinte calculée");
    assert.match(e.message, /npm run sceller/, "un refus sans issue se fait commenter");
    return true;
  });

  const sansScelle = { ...bon } as Record<string, unknown>;
  delete sansScelle.empreinte;
  assert.throws(() => chargerBaselineDepuis(JSON.stringify(sansScelle), "x.json"), /carries no content fingerprint/);
  assert.throws(() => chargerBaselineDepuis(JSON.stringify({ kind: "autre" }), "x.json"), /not a client record/);
});

test("la dérive se lit contre son propre plancher de bruit, et refuse de trancher sous 350", () => {
  /* Une population synthétique déterministe : des longueurs entre 200 et 1200. */
  const r = draw(20260905);
  const anciennes = Array.from({ length: 800 }, () => 200 + Math.floor(r() * 1000));
  /* Un ré-échantillonnage de la MÊME population : indiscernable du tirage. */
  const r2 = draw(7);
  const memePopulation = Array.from({ length: 400 }, () => anciennes[Math.floor(r2() * anciennes.length)]!);
  const calme = deriveDEntree(anciennes, memePopulation);
  assert.equal(calme.verdict, "indistinguishable");

  /* La même, décalée de 40 % : l'indice doit sortir du bruit ET du seuil. */
  const bougee = memePopulation.map((l) => Math.round(l * 1.4));
  const alerte = deriveDEntree(anciennes, bougee);
  assert.equal(alerte.verdict, "above-threshold");
  assert.ok(alerte.indice > alerte.plancher * 2, `indice ${alerte.indice} sous 2× le plancher ${alerte.plancher}`);

  /* Sous OBSERVATIONS_MINIMALES, le chiffre existe et ne veut rien dire — on le dit. */
  const maigre = deriveDEntree(anciennes, bougee.slice(0, 100));
  assert.equal(maigre.verdict, "undetermined");
});

test("la commande refuse une référence retouchée AVANT de mesurer, code 2, rien d'écrit", () => {
  const temp = mkdtempSync(join(tmpdir(), "recertify-"));
  const retouche = referenceScellee();
  (retouche.extraction as Record<string, Record<string, { accuracy: number }>>).small!.name!.accuracy = 0.999;
  const baseline = join(temp, "printemps-measured.json");
  writeFileSync(baseline, JSON.stringify(retouche));
  const csv = join(temp, "automne.csv");
  writeFileSync(csv, "id,text,name\n1,\"Anna Petrova, dob 3 May 1990\",Anna Petrova\n");

  const r = spawnSync(process.execPath, [
    fileURLToPath(new URL("./recertify.ts", import.meta.url)),
    `--cases=${csv}`, `--baseline=${baseline}`,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `code ${r.status} — sortie :\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /does not match its own fingerprint/);
  assert.equal(existsSync(join(temp, "automne-recertified.md")), false, "un refus a quand même écrit le rapport");
  assert.equal(existsSync(join(temp, "automne-recertified.json")), false, "un refus a quand même écrit le relevé");
});

test("un drapeau inconnu se refuse en le nommant — la commande, pas seulement la fonction", () => {
  /* Le refus vient de la garde PARTAGÉE (`refuserDrapeauxInconnus`, cli.ts) : elle nomme le
     drapeau sans sa valeur et liste ce que la commande accepte. */
  const r = spawnSync(process.execPath, [
    fileURLToPath(new URL("./recertify.ts", import.meta.url)),
    "--cases=x.csv", "--baseline=y.json", "--evry=90d",
  ], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--evry/);
  assert.match(r.stderr, /This command accepts: .*--every/);
});
