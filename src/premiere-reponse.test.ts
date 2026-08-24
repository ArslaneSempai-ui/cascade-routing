import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — module .mjs sans déclarations : il est sans dépendances par contrat
import { reponse } from "./premiere-reponse.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));

test("aucun chiffre n'est écrit dans le texte d'accueil : il vient des relevés", () => {
  /*
   * Un texte d'accueil qui recopie des chiffres est le premier à mentir — lu par tout le
   * monde, relu par personne. On change les relevés et on regarde si la sortie suit.
   */
  const exposition = { seuil: { bas: 3, haut: 4 }, unites: { traitement: "usd/period", exposition: "usd/period" }, periode: "100000 documents",
    points: [{ identiqueAuPublie: true, traitement: 1000, exposition: 7000 }] };
  const doc = { publie: { taux: { successes: 7, n: 10, rate: 0.7, low: 0.4, high: 0.9 } } };
  const s = reponse(exposition, doc);
  assert.match(s, /7 COMPLETE records out of 10/);
  assert.match(s, /70\.0 %/);
  /*
   * CE CAS FIGEAIT LA FAUTE QU'IL DEVAIT ATTRAPER.
   *
   * Il exigeait « 1,000 EUR a year » — et le texte le disait, donc il passait. Les deux
   * moitiés étaient fausses : le modèle libelle ces montants en `usd/period`, et une période
   * vaut `volume` documents, pas douze mois. Un contrôle qui recopie la sortie ne vérifie pas
   * la sortie, il la grave.
   *
   * Il lit l'unité du relevé maintenant, comme le texte qu'il éprouve.
   */
  assert.match(s, /1,000 USD per period/);
  assert.match(s, /A period is 100000 documents/);
  assert.doesNotMatch(s, /\bEUR\b|€/, "la devise ne se réinvente pas.");
  assert.match(s, /7,000/);
  assert.match(s, /\b7 times more/, "le rapport est calculé, pas recopié.");
  assert.match(s, /3–4× one blank field/);
  /* Et il ne laisse pas croire que ce sont les chiffres du lecteur. */
  assert.match(s, /NOT YOURS|Not yours/);
});

test("un relevé incohérent fait refuser, pas inventer", () => {
  assert.throws(() => reponse({ points: [{ identiqueAuPublie: false }] }, { publie: { taux: { n: 10 } } }),
    /diverged/);
  assert.throws(() => reponse({ unites: { traitement: "usd/period", exposition: "usd/period" }, periode: "100000 documents", points: [{ identiqueAuPublie: true, traitement: 1, exposition: 2 }] }, { publie: {} }),
    /no sample size/);

  /*
   * UN RELEVÉ SANS UNITÉ FAIT REFUSER. C'est le cas qui manquait : ce fichier n'a aucune
   * dépendance, donc il ne peut pas importer la table des unités — il la lit dans le relevé
   * ou il se tait. La version d'avant reconstituait, et sa reconstitution disait « EUR ».
   */
  assert.throws(() => reponse(
    { points: [{ identiqueAuPublie: true, traitement: 1, exposition: 2 }] },
    { publie: { taux: { successes: 1, n: 2, rate: 0.5, low: 0.1, high: 0.9 } } }),
    /without their unit/, "un relevé nu doit faire refuser, pas deviner.");

  /* Et deux unités différentes ne se comparent pas : « 86 fois plus » n'aurait aucun sens. */
  assert.throws(() => reponse(
    { unites: { traitement: "usd/period", exposition: "eur/period" }, periode: "x",
       points: [{ identiqueAuPublie: true, traitement: 1, exposition: 2 }] },
    { publie: { taux: { successes: 1, n: 2, rate: 0.5, low: 0.1, high: 0.9 } } }),
    /do not share a unit/, "deux devises différentes ne se divisent pas.");
});

test("le texte respire : la mise en forme n'écrase pas les lignes vides", () => {
  /* La première version filtrait `!== ""` pour retirer une ligne conditionnelle et effaçait
     toute la respiration : trente lignes collées, illisibles. */
  const s = reponse({ seuil: { bas: 3, haut: 4 }, unites: { traitement: "usd/period", exposition: "usd/period" }, periode: "100000 documents",
      points: [{ identiqueAuPublie: true, traitement: 1, exposition: 2 }] },
    { publie: { taux: { successes: 7, n: 10, rate: 0.7, low: 0.4, high: 0.9 } } });
  assert.ok(s.split("\n").filter((l: string) => l.trim() === "").length >= 8,
    "le texte n'a plus de lignes vides : il est rendu illisible par sa propre mise en forme.");
});

test("LA PREMIÈRE RÉPONSE NE DEMANDE AUCUNE INSTALLATION", () => {
  /*
   * La promesse est « une réponse avant d'avoir installé quoi que ce soit ». Elle ne se
   * déclare pas.
   *
   * DEUX PROPRIÉTÉS, ÉPROUVÉES SÉPARÉMENT, PARCE QU'AUCUNE SEULE NE SUFFIT. Que les fichiers
   * nécessaires soient VERSIONNÉS — sinon un clone frais n'aurait rien à lire — et que la
   * commande tourne sans `node_modules`. Un premier essai clonait HEAD pour tout couvrir
   * d'un coup, et échouait tant que le fichier n'était pas commité : un cas qui ne peut
   * passer qu'après le commit qu'il devrait garder ne garde rien.
   *
   * CE QUI EST BORNÉ ET CE QUI NE L'EST PAS : le temps mesuré est celui de la commande. Le
   * « soixante secondes » annoncé au lecteur inclut SON réseau, que nous ne contrôlons pas.
   * C'est la réserve qui doit voyager avec le chiffre.
   */
  /* La liste est dérivée une fois et sert aux deux usages : ce qui doit être versionné, et
     ce que le bac d'essai doit contenir. Deux dérivations séparées finiraient par différer. */
  const src = readFileSync(join(racine, "src/premiere-reponse.mjs"), "utf8");
  const lus = [...src.matchAll(/lire\("([^"]+)"\)/g)].map((m) => m[1]!);
  assert.ok(lus.length >= 2,
    `${lus.length} relevé(s) lu(s) par la première réponse : la dérivation ne marche plus, et ce cas ne vérifie rien.`);

  const suivis = spawnSync("git", ["ls-files"], { cwd: racine, encoding: "utf8" });
  if (suivis.status === 0) {
    const liste = suivis.stdout.split("\n");
    /*
     * LA LISTE SE DÉRIVE DE CE QUE LE MODULE LIT, ELLE NE SE RÉCITE PAS.
     *
     * Elle était écrite à la main : le jour où la première réponse lirait un troisième
     * relevé, il ne serait pas dans la liste, ce cas continuerait de passer, et il passerait
     * en regardant moins. C'est le défaut que ce cas existe pour empêcher, logé dans le cas.
     * Trouvé par le catalogue de pièges, sur du code écrit le même jour.
     */
    for (const f of ["src/premiere-reponse.mjs", ...lus]) {
      assert.ok(liste.includes(f),
        `${f} n'est pas versionné : un clone frais n'aurait rien à lire, et la promesse serait fausse.`);
    }
  }

  const tmp = mkdtempSync(join(tmpdir(), "cascade-premiere-"));
  try {
    mkdirSync(join(tmp, "src"));
    copyFileSync(join(racine, "src/premiere-reponse.mjs"), join(tmp, "src/premiere-reponse.mjs"));
    /* LA MÊME DÉRIVATION QUE PLUS HAUT. Deux noms écrits à la main ici auraient dit une
       chose et la dérivation une autre : le jour où la première réponse lit un troisième
       relevé, la liste versionnée le verrait et le bac d'essai non. Une seule source. */
    for (const f of lus) copyFileSync(join(racine, f), join(tmp, f));
    assert.ok(!existsSync(join(tmp, "node_modules")),
      "node_modules existe dans le bac d'essai : ce cas n'éprouve pas l'absence d'installation.");

    const debut = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ["src/premiere-reponse.mjs"],
      { cwd: tmp, encoding: "utf8", timeout: 60_000 });
    const ms = Number(process.hrtime.bigint() - debut) / 1e6;

    assert.equal(r.status, 0, `la commande a échoué sans node_modules :\n${r.stderr}`);
    assert.match(r.stdout, /COMPLETE records out of/);
    assert.match(r.stdout, /times more/);
    assert.ok(ms < 10_000,
      `la première réponse a pris ${Math.round(ms)} ms sans installation. Le budget est de 10 s ;\n`
      + "  au-delà, quelque chose s'est mis à charger ce qui ne devrait pas l'être.");

    /* LE TÉMOIN : sans son relevé, elle doit REFUSER. Sans lui, ce cas passerait aussi sur
       une commande qui n'affiche jamais rien. */
    rmSync(join(tmp, "exposition.json"));
    const sans = spawnSync(process.execPath, ["src/premiere-reponse.mjs"], { cwd: tmp, encoding: "utf8", timeout: 30_000 });
    assert.notEqual(sans.status, 0, "sans son relevé, la commande rend quand même quelque chose.");
    assert.match(sans.stderr, /is missing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("la commande est annoncée dans le README, sinon personne ne la lance", () => {
  const readme = readFileSync(join(racine, "README.md"), "utf8");
  assert.match(readme, /premiere-reponse/,
    "la première réponse n'est nommée nulle part : elle ne sert à rien si le lecteur ne la voit pas.");
});
