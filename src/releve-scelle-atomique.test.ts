import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ecrireReleve, readProfiles, empreinteDuReleve } from "./measure.ts";
import type { Profiles } from "./measure.ts";

/*
 * UN RELEVÉ ÉCRIT PAR LA MESURE DOIT ÊTRE RELISIBLE PAR LA MESURE.
 *
 * ─── LE DÉFAUT, ET POURQUOI PERSONNE NE L'AVAIT VU ───
 *
 * `readProfiles()` refuse un relevé sans empreinte : c'est la garde qui empêche de publier un
 * chiffre modifié à la main. La sauvegarde faite après chaque palier écrivait SANS empreinte,
 * et `sauver()` appelle `readProfiles()` à chaque palier pour reprendre les précédents.
 *
 * `npm run measure` mourait donc au DEUXIÈME palier, sur un refus parfaitement juste déclenché
 * par sa propre écriture. La commande la plus chère du dépôt était cassée et rien ne le disait,
 * parce que personne ne la lance : une heure de calcul et un accord explicite.
 *
 * **Une garde ne peut pas distinguer un fichier corrompu par un tiers d'un fichier que le
 * programme vient d'écrire lui-même.** C'est à l'écriture de se conformer, pas à la garde de
 * faire une exception — une exception aurait rouvert exactement le trou que le scellé ferme.
 */

const releveDeTest = (): Profiles => ({
  measuredAt: new Date().toISOString(),
  tiers: ["rules"],
  extraction: { rules: {} },
} as unknown as Profiles);

function bac(): string {
  const d = mkdtempSync(join(tmpdir(), "releve-"));
  assert.ok(!d.includes("/Documents/"), `terrain d'essai dans le vrai arbre : ${d}`);
  return d;
}

test("ce que la mesure écrit, la mesure le relit", () => {
  /*
   * LE CAS QUI AURAIT ATTRAPÉ LE DÉFAUT. Il ne vérifie pas « une empreinte est présente » —
   * il vérifie la propriété qui compte : le relevé traverse la garde. Un cas qui aurait
   * regardé la clé aurait pu passer sur une empreinte fausse.
   */
  const d = bac();
  try {
    const f = join(d, "data", "profiles.json");
    ecrireReleve(f, releveDeTest());
    const relu = readProfiles(f, d);
    assert.ok(relu, "le relevé écrit doit être relu, pas refusé.");
    assert.deepEqual(relu!.tiers, ["rules"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("un relevé écrit SANS passer par là est refusé — la garde tient toujours", () => {
  /*
   * LE PENDANT, ET IL EST OBLIGATOIRE. Sans lui, le cas précédent passerait aussi si
   * `readProfiles` avait cessé de refuser quoi que ce soit — ce qui est la façon la plus
   * simple de « corriger » ce défaut, et la pire.
   */
  const d = bac();
  try {
    const f = join(d, "data", "profiles.json");
    ecrireReleve(f, releveDeTest());
    writeFileSync(f, JSON.stringify({ tiers: ["rules"], extraction: { rules: {} } }, null, 2));
    assert.throws(() => readProfiles(f, d), /no content fingerprint/,
      "un relevé sans empreinte doit rester refusé.");

    const scelle = JSON.parse(readFileSync(f, "utf8"));
    scelle.empreinte = "0000000000000000";
    writeFileSync(f, JSON.stringify(scelle, null, 2));
    assert.throws(() => readProfiles(f, d), /has changed since it was measured/,
      "et une empreinte qui ne correspond pas au contenu aussi.");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("l'écriture ne laisse pas de fichier à moitié écrit derrière elle", () => {
  /*
   * `writeFileSync` tronque avant de remplir : un lecteur concurrent — `npm run figures`
   * pendant une mesure — peut tomber sur un JSON coupé en deux. Le renommage est atomique sur
   * le même système de fichiers.
   *
   * Ce cas ne peut pas observer la fenêtre elle-même sans course. Il vérifie ce qui est
   * observable : le provisoire n'existe plus après, et il ne reste rien d'autre que le relevé.
   */
  const d = bac();
  try {
    const f = join(d, "data", "profiles.json");
    ecrireReleve(f, releveDeTest());
    ecrireReleve(f, releveDeTest());
    assert.ok(!existsSync(`${f}.tmp`), "le fichier provisoire doit avoir disparu.");
    const restants = readdirSync(join(d, "data"));
    /* Le relevé du disque doit être NON VIDE avant qu'on en conclue quoi que ce soit : un
       balayage qui rend zéro entrée ferait passer ce cas sans avoir rien regardé. */
    assert.ok(restants.length > 0,
      "le dossier est vide : l'écriture n'a rien produit, donc ce cas ne regarde rien.");
    assert.deepEqual(restants, ["profiles.json"],
      "et rien d'autre ne doit rester à côté du relevé.");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("l'empreinte s'exclut du calcul, donc réécrire un relevé scellé est stable", () => {
  const r = releveDeTest();
  const a = empreinteDuReleve(r);
  (r as Record<string, unknown>).empreinte = a;
  assert.equal(empreinteDuReleve(r), a,
    "sceller un relevé déjà scellé doit rendre la même empreinte, sinon chaque écriture "
    + "invaliderait la précédente.");
});

test("les deux écritures du relevé passent par la même fonction", () => {
  /*
   * ─── CE CAS REGARDE LE TEXTE, ET IL LE DIT ───
   *
   * Les quatre cas ci-dessus éprouvent `ecrireReleve`. Aucun ne tomberait si `sauver()`
   * reprenait un `writeFileSync` direct — c'est-à-dire si le défaut d'origine revenait. Et il
   * n'y a pas de cas de comportement possible : l'atteindre demande une heure de calcul et le
   * téléchargement d'un gigaoctet de modèles.
   *
   * Ce qu'il interdit précisément : qu'une écriture du relevé existe ailleurs. Deux écritures
   * d'une même chose divergent — c'est ce défaut-ci, exactement.
   */
  const src = readFileSync(fileURLToPath(new URL("./measure.ts", import.meta.url)), "utf8");
  const apres = src.slice(src.indexOf("export function ecrireReleve"));
  const ecritures = [...apres.matchAll(/writeFileSync\(/g)].length;
  assert.equal(ecritures, 1,
    `${ecritures} écriture(s) de fichier après \`ecrireReleve\` : il ne doit y en avoir qu'une, `
    + "la sienne. Une seconde signifie qu'un site d'écriture est reparti de son côté.");
  assert.equal([...apres.matchAll(/ecrireReleve\(FICHIER/g)].length, 2,
    "les deux sites — sauvegarde après chaque palier, écriture finale — doivent l'appeler.");
});
