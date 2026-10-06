/**
 * LE COMPTEUR D'ÉVALUATION DÉMÉNAGE SANS PERDRE NI GAGNER UN JOUR.
 *
 * Le 6 octobre 2026, le marqueur de premier usage passe de ~/.cascade à ~/.crusetra. Ce qui
 * peut mentir dans ce déménagement, et que chaque cas ferme :
 *   - un client qui avait commencé son essai le recommencerait (la date de l'ancien perdue) ;
 *   - un client qui a les deux fichiers verrait la date la plus récente gagner (l'essai rallongé) ;
 *   - l'ancien fichier serait déplacé, effacé ou réécrit, ou ses voisins touchés ;
 *   - un test lirait le vrai marqueur de la machine au lieu du sien.
 * Tout se joue dans des dossiers fabriqués : aucun cas ne lit ni n'écrit sous le vrai HOME.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCIEN_FICHIER, FICHIER_DEFAUT, anciensPour, lignesEvaluation, marquer } from "./evaluation.ts";

/** Une maison fabriquée : le dossier neuf et l'ancien, côte à côte, vides. */
function maison(): { neuf: string; ancien: string; dossierAncien: string } {
  const d = mkdtempSync(join(tmpdir(), "eval-maison-"));
  return {
    neuf: join(d, ".crusetra", "premiere-utilisation.json"),
    ancien: join(d, ".cascade", "premiere-utilisation.json"),
    dossierAncien: join(d, ".cascade"),
  };
}

function poser(fichier: string, iso: string): void {
  mkdirSync(join(fichier, ".."), { recursive: true });
  writeFileSync(fichier, JSON.stringify({ premiereUtilisation: iso, note: "local only, never transmitted" }, null, 2) + "\n");
}

const dateDe = (fichier: string): string =>
  (JSON.parse(readFileSync(fichier, "utf8")) as { premiereUtilisation: string }).premiereUtilisation;

const AUJOURDHUI = new Date("2026-10-06T09:00:00Z");

test("seul l'ancien existe : sa date est gardée, recopiée dans le neuf, et l'ancien reste intact", () => {
  const m = maison();
  poser(m.ancien, "2026-09-20T08:00:00.000Z");
  const avant = readFileSync(m.ancien);
  const u = marquer(m.neuf, AUJOURDHUI, [m.ancien]);
  assert.equal(u.premiere, "2026-09-20T08:00:00.000Z",
    "le changement de nom a remis l'essai à zéro : le client gagnerait trente jours");
  assert.equal(u.neuf, false);
  assert.equal(u.avarie, false);
  assert.equal(u.reprisDe, m.ancien);
  assert.equal(dateDe(m.neuf), "2026-09-20T08:00:00.000Z", "le neuf doit recevoir la date de l'ancien");
  assert.deepEqual(readFileSync(m.ancien), avant, "l'ancien marqueur a été réécrit");
  /* Et la fois suivante, la même date, sans rien réécrire. */
  const avantNeuf = readFileSync(m.neuf);
  assert.equal(marquer(m.neuf, new Date("2026-10-20T09:00:00Z"), [m.ancien]).premiere, "2026-09-20T08:00:00.000Z");
  assert.deepEqual(readFileSync(m.neuf), avantNeuf, "un second lancement a réécrit le marqueur neuf");
});

test("les deux existent : la date la plus ancienne gagne, dans un sens comme dans l'autre", () => {
  /* L'ancien est le plus ancien : il gagne, et le neuf est corrigé. */
  const a = maison();
  poser(a.ancien, "2026-08-01T08:00:00.000Z");
  poser(a.neuf, "2026-10-01T08:00:00.000Z");
  const ua = marquer(a.neuf, AUJOURDHUI, [a.ancien]);
  assert.equal(ua.premiere, "2026-08-01T08:00:00.000Z",
    "la date la plus récente a gagné : l'essai s'est rallongé de deux mois");
  assert.equal(dateDe(a.neuf), "2026-08-01T08:00:00.000Z", "le neuf garde une date plus récente que la vraie");
  assert.equal(dateDe(a.ancien), "2026-08-01T08:00:00.000Z");

  /* Le neuf est le plus ancien : il gagne, et rien n'est réécrit. */
  const b = maison();
  poser(b.ancien, "2026-10-01T08:00:00.000Z");
  poser(b.neuf, "2026-08-01T08:00:00.000Z");
  const neufAvant = readFileSync(b.neuf), ancienAvant = readFileSync(b.ancien);
  const ub = marquer(b.neuf, AUJOURDHUI, [b.ancien]);
  assert.equal(ub.premiere, "2026-08-01T08:00:00.000Z", "l'ancien, plus récent, a effacé la vraie date");
  assert.equal(ub.reprisDe, undefined);
  assert.deepEqual(readFileSync(b.neuf), neufAvant);
  assert.deepEqual(readFileSync(b.ancien), ancienAvant);
});

test("seul le neuf existe : sa date, et l'ancien n'est pas créé", () => {
  const m = maison();
  poser(m.neuf, "2026-09-15T08:00:00.000Z");
  const u = marquer(m.neuf, AUJOURDHUI, [m.ancien]);
  assert.equal(u.premiere, "2026-09-15T08:00:00.000Z");
  assert.equal(u.neuf, false);
  assert.equal(existsSync(m.dossierAncien), false, "le compteur a recréé l'ancien dossier");
});

test("aucun n'existe : le premier usage s'horodate dans le neuf seulement", () => {
  const m = maison();
  const u = marquer(m.neuf, AUJOURDHUI, [m.ancien]);
  assert.equal(u.neuf, true);
  assert.equal(u.premiere, AUJOURDHUI.toISOString());
  assert.equal(dateDe(m.neuf), AUJOURDHUI.toISOString());
  assert.equal(existsSync(m.dossierAncien), false, "le compteur a écrit sous l'ancien nom");
});

test("un marqueur illisible ne fait perdre la date d'aucun autre", () => {
  /* Le neuf est abîmé, l'ancien lisible : la date de l'ancien tient, et le neuf est réparé avec elle. */
  const a = maison();
  poser(a.ancien, "2026-09-01T08:00:00.000Z");
  mkdirSync(join(a.neuf, ".."), { recursive: true });
  writeFileSync(a.neuf, "{pas du json");
  const ua = marquer(a.neuf, AUJOURDHUI, [a.ancien]);
  assert.equal(ua.premiere, "2026-09-01T08:00:00.000Z");
  assert.equal(ua.avarie, false, "dire « the clock restarts today » serait faux : la date de l'ancien tient");
  assert.equal(dateDe(a.neuf), "2026-09-01T08:00:00.000Z");

  /* L'ancien est abîmé, le neuf lisible : le neuf tient, l'ancien n'est pas touché. */
  const b = maison();
  poser(b.neuf, "2026-09-10T08:00:00.000Z");
  mkdirSync(b.dossierAncien, { recursive: true });
  writeFileSync(b.ancien, "{pas du json");
  const ub = marquer(b.neuf, AUJOURDHUI, [b.ancien]);
  assert.equal(ub.premiere, "2026-09-10T08:00:00.000Z");
  assert.equal(ub.avarie, false);
  assert.equal(readFileSync(b.ancien, "utf8"), "{pas du json");

  /* Les deux abîmés, et seulement alors : l'horloge repart, et le message le dit. */
  const c = maison();
  for (const f of [c.neuf, c.ancien]) { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, "{"); }
  const uc = marquer(c.neuf, AUJOURDHUI, [c.ancien]);
  assert.equal(uc.premiere, AUJOURDHUI.toISOString());
  assert.equal(uc.avarie, true, "deux marqueurs illisibles remplacés sans le dire : un compteur remis à zéro sans témoin");
  assert.equal(readFileSync(c.ancien, "utf8"), "{", "l'ancien marqueur illisible a été réécrit");
});

test("passé trente jours sous l'ancien nom, l'essai reste passé sous le neuf", () => {
  const m = maison();
  poser(m.ancien, "2026-08-01T08:00:00.000Z");
  marquer(m.neuf, AUJOURDHUI, [m.ancien]);
  const tout = lignesEvaluation(m.neuf, AUJOURDHUI).join(" ");
  assert.match(tout, /day 67 since first use \(2026-08-01\)/,
    "le rappel compte depuis la date reprise, pas depuis le jour du déménagement");
  assert.match(tout, /https:\/\/crusetra\.com\/engagement\.html/);
});

test("les fichiers voisins de l'ancien marqueur ne sont ni lus, ni déplacés, ni touchés", () => {
  const m = maison();
  poser(m.ancien, "2026-09-01T08:00:00.000Z");
  /* Des voisins comme ceux d'un vrai ~/.cascade : leur contenu est fabriqué ici. */
  const voisins: Record<string, string> = { "cle-privee.pem": "pas une vraie cle\n", "reglages.env": "A=1\n" };
  for (const [n, t] of Object.entries(voisins)) writeFileSync(join(m.dossierAncien, n), t);
  marquer(m.neuf, AUJOURDHUI, [m.ancien]);
  const vus = readdirSync(m.dossierAncien).sort();
  assert.ok(vus.length >= 3, `${vus.length} fichier(s) lus dans l'ancien dossier : une liste vide ne prouverait rien`);
  assert.deepEqual(vus, ["cle-privee.pem", "premiere-utilisation.json", "reglages.env"]);
  for (const [n, t] of Object.entries(voisins)) assert.equal(readFileSync(join(m.dossierAncien, n), "utf8"), t);
  assert.deepEqual(readdirSync(join(m.neuf, "..")), ["premiere-utilisation.json"],
    "le compteur a écrit autre chose que son marqueur dans le dossier neuf");

  /* Et la source ne sait rien faire d'autre : ni lister un dossier, ni copier, ni déplacer, ni effacer. */
  const source = readFileSync(fileURLToPath(new URL("./evaluation.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /\b(readdirSync|opendirSync|renameSync|rmSync|unlinkSync|rmdirSync|cpSync|copyFileSync|readdir|rename|unlink|glob)\b/,
    "evaluation.ts sait désormais lister, copier, déplacer ou effacer : l'ancien dossier porte des fichiers qui ne le regardent pas");
  const nomsSousLAncien = [...source.matchAll(/"\.cascade",\s*"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(nomsSousLAncien, ["premiere-utilisation.json"],
    "evaluation.ts nomme sous ~/.cascade autre chose que son marqueur");
});

test("le marqueur de la maison relit l'ancien ; un fichier nommé ne lit que lui-même", () => {
  assert.equal(FICHIER_DEFAUT, join(homedir(), ".crusetra", "premiere-utilisation.json"));
  assert.equal(ANCIEN_FICHIER, join(homedir(), ".cascade", "premiere-utilisation.json"));
  assert.deepEqual(anciensPour(FICHIER_DEFAUT), [ANCIEN_FICHIER],
    "le marqueur de la maison ne relit plus l'ancien : chaque essai en cours repartirait à zéro");
  assert.deepEqual(anciensPour(join(tmpdir(), "x.json")), [],
    "un fichier nommé relirait le vrai marqueur de la machine : les tests dépendraient de son HOME");
});
