import { test } from "node:test";
import assert from "node:assert/strict";
import { classer, noter, oublierLesFormes, direLesFormes, formesVues } from "./forme-rendue.ts";
import { FORME } from "./signal.ts";
import { FIELDS } from "./corpus.ts";

/*
 * CE QUI EST ÉPROUVÉ ICI, ET CE QUI NE PEUT PAS L'ÊTRE PAR CES CAS.
 *
 * Les cas unitaires ci-dessous éprouvent `classer` et le compte. Aucun ne tomberait si
 * quelqu'un retirait l'appel à `noter` de la boucle de mesure — c'est-à-dire si le défaut
 * d'origine revenait, une forme aberrante comptée comme une erreur ordinaire. Le dernier cas
 * lance la commande et exige que la sortie le DISE ; c'est lui qui garde le site d'appel.
 */

test("une réponse juste reste juste, quelle que soit sa forme", () => {
  /* L'ordre de `classer` n'est pas arbitraire : la justesse passe avant la forme. Un prédicat
     trop strict transformerait sinon une bonne réponse en aberration, et le compte publié
     accuserait le modèle de ce dont le contrôle est coupable. */
  assert.equal(classer("birth", "10 / 07 / 1987", "10/07/1987"), "juste",
    "les espaces du tokeniseur autour de la ponctuation ne sont pas une aberration.");
  assert.equal(classer("document", "FR - 1856 - M", "FR-1856-M"), "juste");
});

test("le vide est un refus, pas une aberration", () => {
  assert.equal(classer("birth", "", "10/07/1987"), "vide");
  assert.equal(classer("birth", "   ", "10/07/1987"), "vide",
    "des espaces seuls sont un vide : les compter comme hors forme gonflerait le chiffre publié.");
});

test("ce qui ne ressemble pas au champ est hors forme, le reste est faux", () => {
  assert.equal(classer("birth", "the quick brown fox", "10/07/1987"), "hors-forme",
    "de la prose sur une date de naissance ne parle pas du champ demandé.");
  assert.equal(classer("name", "PT - 8507 - T", "Sofia Rossi"), "hors-forme",
    "un numéro de document rendu comme nom : le cas réel le plus fréquent de la galerie.");
  assert.equal(classer("birth", "11/07/1987", "10/07/1987"), "faux",
    "une date voisine est une erreur de lecture, pas une aberration — et les deux "
    + "n'appellent pas la même action.");
});

test("le bourrage rendu au-delà de la fenêtre est vu comme hors forme", () => {
  /*
   * LE CAS QUI A MOTIVÉ LE LOT. Au-delà de sa fenêtre de contexte, le modèle rend le début du
   * bourrage comme si c'était la réponse, avec l'assurance d'une extraction réussie. Mesuré :
   * la réponse placée à la fin est trouvée à 589 caractères de bourrage et perdue à 2 789.
   */
  const bourrage = "Invoice line item number seven, no personal data here. Invoice line";
  assert.equal(classer("name", bourrage, "Anna Petrova"), "hors-forme");
  /* Et le pendant : le même champ avec une vraie réponse fausse n'est PAS hors forme. */
  assert.equal(classer("name", "Anna Petrov", "Anna Petrova"), "faux");
});

test("le compte se tient par palier et par champ, et la phrase le dit", () => {
  oublierLesFormes();
  assert.equal(direLesFormes(), null, "rien à dire quand rien n'a été noté.");

  noter("small", "name", "Anna Petrova", "Anna Petrova");          /* juste */
  noter("small", "name", "PT - 8507 - T", "Sofia Rossi");          /* hors forme */
  noter("small", "name", "", "Sofia Rossi");                       /* vide */
  noter("large", "birth", "11/07/1987", "10/07/1987");             /* faux */

  const vues = formesVues();
  const n = vues.find((v) => v.palier === "small" && v.champ === "name")!;
  assert.equal(n.total, 3);
  assert.equal(n.horsForme, 1, "une seule des trois est hors forme.");
  assert.equal(n.vides, 1, "le vide est compté à part et n'entre pas dans les hors-forme.");

  const phrase = direLesFormes()!;
  assert.match(phrase, /1 of 4 answer\(s\) were out of shape/,
    "le compte annoncé porte son dénominateur : « 1 hors forme » seul ne dit rien.");
  assert.match(phrase, /small\s+name\s+1\/3/, "et il se décompose par palier et par champ.");
  assert.doesNotMatch(phrase, /large/,
    "un palier sans aberration ne doit pas figurer : une ligne à zéro fait lire un problème "
    + "là où il n'y en a pas.");
});

test("le compte ne corrige rien : une aberration reste comptée fausse", () => {
  /*
   * LA PROPRIÉTÉ QUI COMPTE LE PLUS. Si `noter` rendait « juste » sur une aberration, ou si
   * elle la retirait du dénominateur, le taux publié serait meilleur que la réalité — et le
   * client le citerait. Ce cas interdit cette dérive.
   */
  oublierLesFormes();
  const c = noter("small", "birth", "the quick brown fox", "10/07/1987");
  assert.notEqual(c, "juste", "une aberration ne doit jamais être comptée juste.");
  assert.equal(formesVues()[0]!.total, 1,
    "et elle reste dans le dénominateur : la retirer améliorerait le taux publié en silence.");
});

test("chaque champ mesuré porte un prédicat de forme", () => {
  /*
   * DÉRIVÉ, PAS RÉCITÉ. La liste des champs vient du corpus ; un sixième champ ajouté demain
   * arriverait sans prédicat et `classer` ne dirait plus rien de lui, en silence.
   */
  const sans = (FIELDS as string[]).filter((f) => !FORME[f]);
  assert.deepEqual(sans, [],
    `champ(s) mesuré(s) sans prédicat de forme : ${sans.join(", ")}. `
    + "Ajoute-le à FORME dans signal.ts, ou ce champ ne sera jamais dit hors forme.");
});

test("la commande ANNONCE les formes aberrantes qu'elle a vues", { timeout: 300_000 }, async () => {
  /*
   * LE SITE D'APPEL, PAS LA FONCTION.
   *
   * Les sept cas ci-dessus restent verts si quelqu'un retire `noter` de la boucle de mesure —
   * c'est-à-dire si le défaut d'origine revient : une forme aberrante comptée comme une erreur
   * ordinaire, sans que rien ne le dise. Deux sessions se sont fait prendre là-dessus
   * aujourd'hui, chacune sur la garde de l'autre. La mutation qui éprouve ce cas est celle du
   * défaut : l'appel retiré du site de mesure.
   *
   * Le déclencheur est celui qu'on a mesuré : un texte plus long que la fenêtre du modèle, où
   * la réponse est à la fin. Le modèle rend le début du bourrage, qui n'est pas un nom.
   */
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");

  const d = mkdtempSync(join(tmpdir(), "forme-"));
  const bourrage = "Invoice line item number seven, no personal data here. ".repeat(60);
  writeFileSync(join(d, "cas.csv"),
    `id,text,name\n1,"${bourrage} Client: Anna Petrova.",Anna Petrova\n`);

  const r = spawnSync("node", [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
    `--cases=${join(d, "cas.csv")}`, "--sample=1"], { encoding: "utf8", timeout: 280_000 });
  const sortie = (r.stdout ?? "") + (r.stderr ?? "");

  assert.match(sortie, /answer\(s\) were out of shape for the field asked/,
    `la commande n'annonce pas les formes aberrantes. Sortie :\n${sortie.slice(-700)}`);

  /* LE PENDANT : un document ordinaire ne doit RIEN faire annoncer, sinon l'avis crierait
     toujours et cesserait d'être lu. */
  writeFileSync(join(d, "normal.csv"), `id,text,name\n1,"Client: Anna Petrova — dob 3 May 1990.",Anna Petrova\n`);
  const r2 = spawnSync("node", [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
    `--cases=${join(d, "normal.csv")}`, "--sample=1"], { encoding: "utf8", timeout: 280_000 });
  assert.doesNotMatch((r2.stdout ?? "") + (r2.stderr ?? ""), /out of shape/,
    "un document ordinaire ne doit rien faire annoncer.");
});
