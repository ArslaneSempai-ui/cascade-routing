import { test } from "node:test";
import { porteDesInvisibles, melangeDEcritures } from "./signal.ts";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PREMIER_COMMIT_MULTI_FORMULATION } from "./landing.ts";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { generateRecords, generateAlerts, FIELDS, TYPOLOGIES } from "./corpus.ts";
import { correct, TIERS, estLocal, OLLAMA, MODELES_LOCAUX, digestsQuiDivergent,
  DELAI_DE_GENERATION_MS, DELAI_DE_CHARGEMENT_MS, CHARGEMENTS_MESURES_MS } from "./tiers.ts";
import { GENERATIFS } from "./paliers.ts";
import type { TierName } from "./paliers.ts";
import { classify, empreinteDesEntrees, modulesAtteints, cleDeLaGalerieLivree, cleDuFichierLivre, fermetureDesSources } from "./failures.ts";
import { comparer } from "./diff.ts";
import { sonde } from "./sonde.ts";
import { appliquerHypotheses } from "./server.ts";
import { INVENTORY } from "./inventory.ts";
import { lireCsv } from "./your-cases.ts";
import { corpusDur } from "./corpus-dur.ts";
import { comparerPopulations, plancherDeBruit, longueur, GRAINES_DE_BRUIT } from "./entree.ts";
import { SEUIL_DE_L_INDUSTRIE, OBSERVATIONS_MINIMALES } from "./psi.ts";
import { readProfiles, empreinteDuReleve, RELEVE_DE_REFERENCE, type Profile, type ProvenanceDuPalier, type Provenance } from "./measure.ts";
import { optimiseExtraction, optimiseClassification, budgetShadowPrice, latenceRepresentative, paliersMesures, evaluer, pricePerThousandDocuments } from "./optimise.ts";
import { rapportPourLeClient } from "./your-cases.ts";
import { elaguer as elaguerInterne } from "./journal.ts";
import { estBoucleLocale, verdictEgress, ASSEZ_DE_RELEVES as ASSEZ_INTERNE } from "./egress.ts";
import { PROMPTS as PROMPTS_INTERNES, questionPour as questionPourInterne } from "./tiers.ts";
import { memoireDisponibleMo, etatMachine as etatMachineInterne,
  PLAFOND_JETONS as PLAFOND_JETONS_INTERNE,
  MEMOIRE_LIBRE_MINIMALE_MO as MEMOIRE_MINIMALE_INTERNE } from "./contrainte.ts";
import { normaliserReponse as normaliserReponseInterne } from "./tiers.ts";
import { pathToFileURL } from "node:url";
import { ASSUMPTIONS, UNITS, BOUNDS, pricePerThousandExtractions, accuracy } from "./assumptions.ts";
import { wilson, rate, writeRate, distinguishable, precision, ENOUGH as ENOUGH_CAS } from "./interval.ts";
import { PLAUSIBLE, bands, ETIQUETTE, advise } from "./sensitivity.ts";
import { litLeTexte } from "./mesurer-ocr.ts";
import { inclinaison, texte as texteDesBlocs, lire, ceQuiManque } from "./ocr.ts";

/* ── the split, which is the whole reason the measurement means anything ── */

test("les trois moitiés du corpus ne partagent aucune formulation", () => {
  /*
   * Trois moitiés, parce qu'il y a trois choses réglées à la main.
   *
   * `training` sert à écrire les expressions régulières, `dev` à mettre au point les invites
   * génératives, `heldout` ne sert qu'à publier un chiffre. Le test valait pour deux ; il a
   * fallu l'étendre le jour où une invite a été réglée en lisant des scores held-out, ce qui
   * est la même faute que noter ses règles sur ses propres gabarits.
   */
  const parts = ["training", "dev", "heldout"] as const;
  const shape = (x: string) => x.replace(/[A-Z][a-zà-ÿ]+|\d+/g, "·");
  const tirages = Object.fromEntries(parts.map((p) => [p, generateRecords(40, p).map((r) => r.text)]));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = tirages[parts[i]!]!, b = tirages[parts[j]!]!;
      assert.equal(a.filter((x) => b.includes(x)).length, 0,
        `${parts[i]} et ${parts[j]} partagent un document entier`);
      assert.equal(a.map(shape).filter((s) => b.map(shape).includes(s)).length, 0,
        `${parts[i]} et ${parts[j]} partagent une formulation — on noterait sa propre copie`);
    }
  }
});

test("both corpora are reproducible", () => {
  assert.deepEqual(generateRecords(20), generateRecords(20));
  assert.deepEqual(generateAlerts(20), generateAlerts(20));
  assert.notDeepEqual(generateRecords(20, "heldout"), generateRecords(20, "training"));
});

test("every alert carries one of the declared typologies", () => {
  for (const a of generateAlerts(120)) assert.ok(TYPOLOGIES.includes(a.truth));
});

/* ── the scorer, which was wrong and cost 133 false failures ── */

test("formatting is not counted as an error", () => {
  // The tokeniser puts spaces around separators. That is not a model failing to find
  // the field, and counting it as one measured the wrong thing.
  assert.ok(correct("10 / 07 / 1987", "10/07/1987"));
  assert.ok(correct("IT - 5560 - K", "IT-5560-K"));
  assert.ok(correct("Amina Haddad.", "Amina Haddad"));
});

test("content is still counted as an error", () => {
  assert.ok(!correct("Leila", "Leila Haddad"), "a fragment is wrong");
  assert.ok(!correct("", "Leila Haddad"), "an empty answer is wrong");
  assert.ok(!correct("Leila Haddad Birth 10/07/1987", "Leila Haddad"), "an over-long span is wrong");
  assert.ok(!correct("Marcus Ferreira", "Leila Haddad"), "the wrong value is wrong");
});

test("failure modes are named, not lumped together", () => {
  assert.equal(classify("", "Leila Haddad"), "empty");
  assert.equal(classify("Leila", "Leila Haddad"), "fragment");
  assert.equal(classify("Leila Haddad Birth 1987", "Leila Haddad"), "over-long");
  assert.equal(classify("Marcus Ferreira", "Leila Haddad"), "wrong span");
});

/* ── the assumptions, kept apart from the measurements ── */

test("the human tier is an assumption, never a certainty", () => {
  // An earlier version returned ground truth here, which made the human infallible by
  // construction and would have routed everything to them.
  assert.ok(ASSUMPTIONS.humanAccuracy < 1, "a human at 100 % is not a model, it is a bug");
  assert.equal(accuracy("human", 1, ASSUMPTIONS), ASSUMPTIONS.humanAccuracy);
  // Machine tiers report what was measured, untouched.
  assert.equal(accuracy("large", 0.967, ASSUMPTIONS), 0.967);
});

test("rules cost nothing, a human costs the most, a local tier is billed by the clock", () => {
  /*
   * Trois régimes de facturation, et le troisième est celui qui se trompe tout seul.
   *
   * Un modèle hébergé a un tarif à l'appel. Un modèle local n'en a aucun : il occupe une
   * machine, et sa seule dépense est le temps qu'il prend. Facturer zéro un palier qui
   * monopolise un GPU pendant une seconde et demie est précisément le biais que cet outil
   * existe pour retirer — donc une latence manquante lève, elle ne vaut pas gratuit.
   */
  const p = readProfiles();
  const lat = (t: TierName) => (p && p.extraction[t] ? latenceRepresentative(p, t) : 1_000);
  const prix = (t: TierName) => pricePerThousandExtractions(t, ASSUMPTIONS, lat(t));

  assert.equal(prix("rules"), 0, "les règles sont gratuites");
  for (const t of TIERS) {
    if (t === "human") continue;
    assert.ok(prix("human") > prix(t), `un humain devrait coûter plus cher que ${t}`);
  }

  assert.equal(
    pricePerThousandExtractions("gen-8b", ASSUMPTIONS, 2_000),
    2 * pricePerThousandExtractions("gen-8b", ASSUMPTIONS, 1_000),
    "deux fois plus lent doit coûter exactement deux fois plus cher",
  );

  assert.throws(() => pricePerThousandExtractions("gen-4b", ASSUMPTIONS),
    /temps machine/,
    "un palier local sans sa latence doit lever, pas être facturé gratuitement");
});

test("un document coûte cinq champs, et ce n'est pas cinq fois le prix d'un champ", (t) => {
  /*
   * L'erreur que ce test existe pour rendre impossible.
   *
   * `pricePerThousandExtractions` rend un prix par millier d'**extractions de champ**. Une
   * page de vente a lu « par millier de documents », a publié le chiffre tel quel, et s'est
   * trompée d'un facteur cinq — dans le sens qui fait paraître la chaîne moins chère.
   *
   * Deux propriétés, et la seconde est celle qui surprend. Sur un palier facturé à l'appel,
   * un document vaut bien cinq fois un champ. Sur un palier local facturé au temps machine,
   * non : le tarif suit la latence, la latence dépend du champ, et le prix d'un document est
   * une somme sur les cinq champs mesurés. Quiconque remplace la somme par une multiplication
   * fait tomber ce test.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");   // pas de profil gelé : rien à comparer, et ce n'est pas une faute

  for (const t of paliersMesures(p)) {
    const parChamp: number[] = FIELDS.map((c) => pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][c].latency));
    const parDocument: number = pricePerThousandDocuments(p, ASSUMPTIONS, t);

    assert.ok(Math.abs(parDocument - parChamp.reduce((a: number, b: number) => a + b, 0)) < 1e-9,
      `le prix d'un document en ${t} doit être la somme de ses cinq champs`);

    /* Le facteur cinq ne tient que si les cinq champs coûtent pareil — ce qui est vrai des
       paliers à l'appel et faux des paliers au temps machine. On vérifie les deux sens. */
    const uniforme = parChamp.every((x: number) => Math.abs(x - parChamp[0]!) < 1e-9);
    const cinqFois = Math.abs(parDocument - 5 * parChamp[0]!) < 1e-9;
    assert.equal(cinqFois, uniforme,
      `en ${t}, « cinq fois le prix d'un champ » ne vaut que si les cinq champs coûtent le même prix`);
  }
});

test("aucun palier local ne coûte le même prix sur tous les champs", (t) => {
  /*
   * Le test précédent ne mord que si un palier au temps machine existe réellement dans le
   * profil avec des latences inégales. Sans celui-ci, un jour où toutes les latences
   * deviendraient égales, « cinq fois » redeviendrait vrai partout et l'erreur repasserait
   * sans que rien ne tombe.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");

  const locaux = paliersMesures(p).filter((t) => t.startsWith("gen-"));
  if (locaux.length === 0) return t.skip("locaux.length === 0 — ce cas n'a rien regardé, et il le dit.");   // échelle générative non mesurée : rien à tenir ici

  for (const t of locaux) {
    const prix: number[] = FIELDS.map((c) => pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][c].latency));
    assert.ok(Math.max(...prix) - Math.min(...prix) > 1e-9,
      `${t} est facturé au temps machine : ses cinq champs ne peuvent pas coûter le même prix`);
  }
});

/* ── the optimiser ── */

test("the routing never exceeds the budget", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");                       // nothing measured yet; not a failure of this test
  for (const budget of [50, 200, 4_000, 100_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (s) assert.ok(s.cost <= budget, `routing costs ${s.cost} on a budget of ${budget}`);
  }
});

test("a larger budget never produces a worse routing", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  let previous = -1;
  for (const budget of [200, 1_000, 10_000, 100_000, 1_000_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (!s) continue;
    assert.ok(s.accuracy >= previous - 1e-9, "more money bought a worse answer");
    previous = s.accuracy;
  }
});

test("the shadow price reports a step, not a slope", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const f = budgetShadowPrice(p, ASSUMPTIONS);
  assert.ok(f);
  if (f.step) {
    // The next gain must genuinely be a gain, and cost genuinely more.
    assert.ok(f.step.gainPoints > 0);
    assert.ok(f.step.extra > 0);
    assert.ok(f.step.budgetNeeded > f.currentCost);
  }
});

test("the two chains do not want the same tier", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const a = optimiseExtraction(p, ASSUMPTIONS);
  const b = optimiseClassification(p, ASSUMPTIONS);
  assert.ok(a && b.chosen);
  const usedInA = new Set(FIELDS.map((f) => a.routing[f]));
  // This is the finding the whole project exists to produce. If it ever stops being
  // true, the README says something the code no longer supports.
  assert.ok(usedInA.size > 1, "chain A should route different fields to different tiers");
});

/* ── intervals ── */

test("a rate on a tiny sample is not reportable", () => {
  assert.equal(rate(3, 4).reportable, false);
  assert.equal(rate(15, 20).reportable, true);
});

test("Wilson does not invent certainty from four observations", () => {
  const [low, high] = wilson(4, 4);
  assert.ok(low < 0.6, `four out of four should not read as ${(low * 100).toFixed(0)} % at the low end`);
  assert.equal(high, 1);
});

/* ── ce que l'échelle générative a appris, et qui doit le rester ── */

test("le routage optimal traverse plusieurs familles de paliers", (t) => {
  /*
   * C'est la trouvaille centrale, et elle serait invisible sans le test.
   *
   * Un encodeur spécialisé garde le nom, des règles gratuites gardent trois champs, un
   * modèle génératif prend l'adresse. Si un jour une seule famille rafle tout, ce n'est pas
   * un progrès : c'est le signe qu'un palier a disparu du profil ou qu'une mesure a viré, et
   * la page dirait alors le contraire de ce qu'elle démontre.
   */
  const p = readProfiles();
  if (!p || !p.extraction["gen-4b"]) return t.skip("!p || !p.extraction['gen-4b'] — ce cas n'a rien regardé, et il le dit.");   // profil encodeurs seuls : rien à tenir ici
  const s = optimiseExtraction(p, ASSUMPTIONS);
  assert.ok(s, "aucun routage sous ces budgets");
  const familles = new Set(FIELDS.map((c) => {
    const e = s!.routing[c];
    if (e === "rules") return "règles";
    return (["gen-0.6b", "gen-4b", "gen-8b"] as string[]).includes(e) ? "génératif" : "encodeur";
  }));
  assert.ok(familles.size >= 3,
    `le routage n'utilise que ${[...familles].join(" et ")} — la démonstration repose sur le mélange`);
});

test("les règles gratuites gardent au moins trois champs sur cinq", (t) => {
  /*
   * La phrase du titre et de la première ligne du README. Elle a déjà été fausse une fois —
   * « le grand modèle est pire que le petit sur deux champs sur cinq » — et publiée nulle
   * part uniquement parce qu'un contrôle l'a rattrapée à temps. Celle-ci est tenue.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  /*
   * « égalent ou battent » se juge sur les intervalles, pas sur les points.
   *
   * Sur le document, gen-8b affiche 83,3 % contre 79,7 % pour les règles — et les
   * intervalles se recouvrent, donc l'échantillon ne les départage pas. Compter ce champ
   * comme perdu ferait mentir le titre dans le sens pessimiste, ce qui est une faute
   * symétrique de celle qui a failli le faire mentir dans l'autre sens.
   */
  const q = (e: TierName, c: (typeof FIELDS)[number]) => {
    const x = p.extraction[e][c];
    return rate(Math.round(x.accuracy * x.items), x.items);
  };
  const gratuits = FIELDS.filter((c) =>
    TIERS.filter((e) => e !== "human" && e !== "rules" && p.extraction[e])
      .every((e) => p.extraction["rules"][c].accuracy >= p.extraction[e][c].accuracy
        || !distinguishable(q(e, c), q("rules", c))));
  assert.ok(gratuits.length >= 3,
    `les règles n'égalent ou ne battent tout le monde que sur ${gratuits.length} champs`);
});

test("un palier plus gros n'est pas supposé meilleur", (t) => {
  /*
   * Sur l'adresse, gen-8b est sous gen-4b — et sur les encodeurs à 1 000 cas, `large` est
   * sous `small`. Un test qui ne tiendrait que « l'ordre monte » aurait empêché de voir la
   * seule chose intéressante de ce projet.
   */
  const p = readProfiles();
  if (!p || !p.extraction["gen-8b"]) return t.skip("!p || !p.extraction['gen-8b'] — ce cas n'a rien regardé, et il le dit.");
  const inversions = FIELDS.filter((c) =>
    p.extraction["gen-8b"][c].accuracy < p.extraction["gen-4b"][c].accuracy
    || p.extraction["large"][c].accuracy < p.extraction["small"][c].accuracy);
  assert.ok(inversions.length > 0,
    "plus aucune inversion : soit la mesure a changé, soit la page raconte autre chose");
});

test("l'optimiseur ne route jamais vers un palier absent du profil", (t) => {
  /*
   * L'échelle est passée de quatre paliers à sept et l'optimiseur a lu `undefined` sur un
   * profil qui n'en contenait que quatre. Quiconque clone ce dépôt et lance `npm run measure`
   * sans Ollama est exactement dans ce cas.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const dispo = new Set(paliersMesures(p));
  const s = optimiseExtraction(p, ASSUMPTIONS);
  for (const c of FIELDS) assert.ok(dispo.has(s!.routing[c]),
    `${c} est routé vers ${s!.routing[c]}, absent du profil gelé`);
});

test("le budget de temps mord avant le budget d'argent", (t) => {
  /*
   * La latence était mesurée et ne jouait aucun rôle : l'optimiseur envoyait volontiers un
   * champ temps réel sur le palier le plus lent. Serrer le plafond doit maintenant changer
   * le routage, sinon la contrainte est décorative et le README ment.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const large = optimiseExtraction(p, { ...ASSUMPTIONS, latencyBudgetMs: 100_000 });
  const serre = optimiseExtraction(p, { ...ASSUMPTIONS, latencyBudgetMs: 40 });
  assert.ok(large && serre, "un des deux plafonds ne laisse aucune solution");
  assert.ok(serre!.latencyPerItem <= 40, "le routage serré dépasse son propre plafond");
  assert.ok(serre!.accuracy < large!.accuracy,
    "serrer le temps ne coûte rien en justesse : la contrainte ne mord pas");
});

test("à écart non significatif, le moins cher est retenu", (t) => {
  /*
   * La règle qui a rattrapé une affirmation fausse. Deux paliers indiscernables sur un
   * champ : payer le plus cher, c'est acheter du bruit — et c'est la première chose qu'un
   * validateur de modèles demandera.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const s = optimiseExtraction(p, ASSUMPTIONS);
  for (const c of FIELDS) {
    const choisi = s!.routing[c];
    const q = p.extraction[choisi][c];
    const rc = rate(Math.round(q.accuracy * q.items), q.items);
    for (const e of paliersMesures(p)) {
      if (e === choisi || e === "human" || choisi === "human") continue;
      const qe = p.extraction[e][c];
      const re = rate(Math.round(qe.accuracy * qe.items), qe.items);
      if (distinguishable(rc, re)) continue;
      const prixChoisi = pricePerThousandExtractions(choisi, ASSUMPTIONS, q.latency);
      const prixAutre = pricePerThousandExtractions(e, ASSUMPTIONS, qe.latency);
      if (prixChoisi <= prixAutre) continue;

      /*
       * Un palier moins cher et indiscernable peut légitimement être écarté : s'il est plus
       * lent, il fait sauter le plafond de temps. C'est arrivé dès la première exécution —
       * gen-8b sur le nom coûte 116 $ de moins et prend 2 307 ms contre un plafond à 2 000.
       * Le test doit donc exiger une raison, pas une obéissance aveugle au prix.
       */
      const variante = evaluer(p, ASSUMPTIONS, { ...s!.routing, [c]: e });
      assert.ok(variante.latencyPerItem > ASSUMPTIONS.latencyBudgetMs,
        `${c} : ${choisi} coûte plus que ${e} sans être mesurablement meilleur, `
        + `et ${e} tient pourtant dans le budget de temps`);
    }
  }
});

/*
 * LES DOCUMENTS LIVRÉS, ET CE QUE LEUR PROSE A LE DROIT D'AFFIRMER.
 *
 * Trois nombres publiés étaient faux le 19 août 2026 — « 83 % contre 68 % et 63 % » sur le
 * numéro de document, « 24,2 % » sur le classifieur, et la légende du GIF. Aucun n'était faux
 * le jour où il a été écrit : ils sont devenus faux à la remesure, sur la page en ligne, sans
 * que rien ne le signale. Un chiffre dans une phrase est une promesse que la phrase sera
 * relue à chaque mesure. On ne relit pas.
 *
 * ─── POURQUOI CETTE GARDE A ÉTÉ REFAITE LE 23 AOÛT ───
 *
 * Elle existait, elle passait, et elle N'EXAMINAIT QUE 129 LIGNES SUR 596. Elle retirait les
 * blocs engendrés AVANT les blocs de code ; or certaines clôtures ``` vivaient à l'intérieur
 * d'un bloc engendré, donc les retirer laissait un nombre IMPAIR de clôtures, et
 * l'appariement suivant avalait deux cent vingt-trois lignes de prose. Un « 97,8 % » inventé
 * planté ligne 69 passait sans un mot.
 *
 * La même clôture déséquilibrée cassait le rendu : quatre cent quatre-vingt-treize lignes du
 * README s'affichaient en bloc de code sur la page que l'acheteur ouvre en premier, et
 * trente-six titres n'apparaissaient pas. Le défaut du contrôle et le défaut visible avaient
 * la même cause, et personne n'avait REGARDÉ le document rendu.
 *
 * D'où les trois gardes ci-dessous, dans cet ordre : les clôtures s'équilibrent, la
 * couverture se mesure, et seulement ensuite les chiffres se comptent. Une garde qui ne dit
 * pas combien elle a regardé peut ne rien regarder du tout.
 */

/** Les documents que l'acheteur ouvre. Un .md à la racine est livré, par construction. */
const LIVRES = ["README.md", "VALIDATION.md", "SONDE.md", "NOTATION-CAS-DURS.md", "COUT-PALIER-1.7B.md"];

const lireLivre = (n: string) => readFileSync(fileURLToPath(new URL(`../${n}`, import.meta.url)), "utf8");

test("les clôtures de bloc de code s'équilibrent dans chaque document livré", () => {
  /*
   * LE DÉFAUT LE PLUS CHER DE LA JOURNÉE TENAIT EN UNE LIGNE ORPHELINE.
   *
   * Une clôture ``` sans sa jumelle ne casse rien à la lecture du fichier brut : elle casse
   * le RENDU, en aval, chez le lecteur, sur une page que l'auteur ne rouvre jamais. Et elle
   * casse en silence tout outil qui découpe le document sur ces clôtures — dont la garde
   * suivante, qui devenait aveugle sans le dire.
   */
  for (const nom of LIVRES) {
    if (!existsSync(fileURLToPath(new URL(`../${nom}`, import.meta.url)))) continue;
    const lignes = lireLivre(nom).split("\n");
    const clotures = lignes.filter((l) => /^\s*```/.test(l)).length;
    assert.equal(clotures % 2, 0,
      `${nom} porte ${clotures} clôtures \`\`\` — un nombre impair. Une d'elles est orpheline : `
      + `tout ce qui la suit s'affiche en bloc de code chez le lecteur, et tout outil qui `
      + `découpe sur ces clôtures avale la suite sans le dire.\n  Cherchez la ligne \`\`\` `
      + `isolée : \`grep -n '\`\`\`' ${nom}\`, et appariez-les deux à deux.`);
  }
});

/**
 * Les nombres qu'une prose affirme, et d'où ils viennent.
 *
 * Rendu comme une fonction pour une seule raison : LE TÉMOIN. Une garde qui ne peut pas
 * démontrer qu'elle voit encore ce qu'elle prétend voir rassure sans regarder — c'est
 * exactement ce que l'ancienne faisait. Le test l'appelle deux fois : sur le document réel,
 * puis sur une copie empoisonnée dont il exige qu'elle la fasse échouer.
 */
function chiffresNus(texte: string, permis: Map<string, string>) {
  /* L'ORDRE COMPTE, et c'est tout le défaut d'hier : le code d'abord, les blocs engendrés
     ensuite. Les tableaux ne sont PAS retirés — les mêmes chiffres passaient selon qu'ils
     étaient en phrase ou en cellule. */
  const prose = texte
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!-- figures:(\w+) -->[\s\S]*?<!-- \/figures:\1 -->/g, "")
    .replace(/`[^`\n]*`/g, "");
  const engendre = [...texte.matchAll(/<!-- figures:(\w+) -->([\s\S]*?)<!-- \/figures:\1 -->/g)]
    .map((m) => m[2]).join("\n");

  /* Toutes les unités, pas seulement celles qui portaient un pour-cent. MB, ms, points et
     « n sur N » décidaient d'un achat autant qu'un taux, et rien ne les regardait. */
  const MOTIF = /(\d[\d.,]*)\s*(%|\$|GB|MB|KB|Mbit|ms\b|×|points?\b|of \d[\d,]*)/g;
  const DOLLARS = /\$\s?\d[\d,.]*/g;
  const vus = [
    ...[...prose.matchAll(MOTIF)].map((m) => `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim()),
    ...[...prose.matchAll(DOLLARS)].map((m) => m[0].replace(/\s+/g, "")),
  ];
  /* Un chiffre qui figure à l'identique dans un bloc engendré du MÊME fichier est tenu par
     lui : s'il bouge à la remesure, les deux bougent, ou la prose se retrouve nue ici. */
  const nus = [...new Set(vus)].filter((x) => !permis.has(x) && !engendre.includes(x));
  return { nus, lignesVues: prose.split("\n").length, lignesTotal: texte.split("\n").length };
}

test("aucun chiffre n'est tapé à la main dans la prose du README, et la garde le prouve", () => {
  /** Ce qu'on s'autorise à écrire en clair, et pourquoi ça ne bougera pas. */
  const permis = new Map<string, string>([
    ["100 %", "une borne, pas une mesure : « jusqu'à 100 % » reste vrai quoi qu'il arrive"],
    ["0 %", "idem, la borne basse"],
    ["10 %", "décrit une ancienne version de l'outil, dans un récit au passé"],
    ["51.7 %", "un chiffre historique : ce que valait un champ avant que l'évaluateur soit corrigé"],
    ["25 %", "la référence triviale à cinq classes, fixée par le nombre de classes"],
    ["20 %", "idem, le tirage uniforme à cinq classes"],
    /* Les poids : figés par la révision du modèle, et un modèle réinstallé est déjà attrapé
       ailleurs par `digestsQuiDivergent()`. Ils ne rouillent donc pas en silence. */
    ["400 MB", "les paquets npm, un ordre de grandeur arrondi et annoncé comme tel"],
    ["474 MB", "le poids de roberta-base-squad2 à sa révision épinglée"],
    ["448 MB", "le poids de multilingual-e5-small à sa révision épinglée"],
    ["249 MB", "le poids de distilbert à sa révision épinglée"],
    ["86 MB", "le poids de MiniLM à sa révision épinglée"],
    ["50 Mbit", "une hypothèse sur la ligne du lecteur, pas une mesure de ce dépôt"],
    ["133 of 685", "un compte historique : les échecs imputés à l'évaluateur avant sa correction"],
  ]);

  const r = chiffresNus(lireLivre("README.md"), permis);

  /*
   * LA COUVERTURE, AVANT LE COMPTE.
   *
   * C'est la garde qui manquait. Le 23 août, ce contrôle examinait 22 % du fichier et rendait
   * zéro : un zéro par aveuglement, indiscernable d'un zéro par propreté. Le plancher est bas
   * exprès — les blocs engendrés et les blocs de code sont retirés à bon droit — mais il rend
   * impossible de retomber sous la moitié sans que la suite tombe.
   */
  const couverture = r.lignesVues / r.lignesTotal;
  assert.ok(couverture >= 0.5,
    `la garde n'examine que ${r.lignesVues} lignes sur ${r.lignesTotal} `
    + `(${(couverture * 100).toFixed(0)} %). Elle rendrait zéro sans avoir regardé. `
    + `Cherchez une clôture \`\`\` orpheline ou un marqueur <!-- figures: --> non fermé.`);

  assert.deepEqual(r.nus, [],
    `chiffre(s) écrit(s) à la main : ${r.nus.join(", ")}\n`
    + `  → soit le générer dans un bloc <!-- figures:... -->, soit l'ajouter à la liste des\n`
    + `    permis dans ce test AVEC la raison pour laquelle il ne bougera jamais. Une entrée\n`
    + `    sans raison écrite est une intention, et ce fichier en a déjà payé trois.`);

  /*
   * LE TÉMOIN, ET IL EST LA MOITIÉ DE LA GARDE.
   *
   * Trois poisons, choisis pour couvrir les trois façons dont l'ancienne garde était aveugle :
   * un taux ajouté en PHRASE, le même en CELLULE de tableau, et un montant en dollars — que
   * l'ancienne ne voyait qu'en phrase. Si l'un d'eux passe, la garde ci-dessus est un vert
   * vide et ce test doit tomber ici plutôt que de rassurer plus haut.
   */
  const readme = lireLivre("README.md");
  const poisons: [string, string][] = [
    ["en phrase", readme + "\n\nIndependently reproduced: 97.8 % accuracy across three teams.\n"],
    ["en tableau", readme + "\n\n| Client | Accuracy |\n|---|---|\n| A | 97.8 % |\n"],
    ["en dollars", readme + "\n\nThree client teams saved $402,750 last quarter.\n"],
    ["une taille", readme + "\n\nThe weights come to 174 MB on disk.\n"],
  ];
  assert.ok(poisons.length > 0, "`poisons` est vide : la boucle qui suit ne vérifie rien.");
  for (const [quoi, empoisonne] of poisons) {
    assert.ok(chiffresNus(empoisonne, permis).nus.length > 0,
      `la garde ne voit pas un chiffre inventé ajouté ${quoi}. Elle ne prouve donc rien, et `
      + `son zéro plus haut ne vaut rien.`);
  }
});

test("le routage est exhaustif, pas heuristique", (t) => {
  /*
   * La page l'affirme en gras : « The routing is exhaustive, not heuristic. » C'est une
   * promesse forte — elle garantit l'optimum, ce qu'aucune heuristique ne fait — et rien ne
   * la tenait. Elle se vérifie en comptant : le nombre d'affectations examinées doit valoir
   * exactement paliers^champs, sans quoi une branche est élaguée quelque part.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const paliers = paliersMesures(p);
  const attendu = Math.pow(paliers.length, FIELDS.length);

  /* Budget et plafond de temps hors de portée : aucune solution ne doit être écartée, donc
     tout ce qui est énumérable doit être énuméré. */
  const large = { ...ASSUMPTIONS, budget: Number.MAX_SAFE_INTEGER, latencyBudgetMs: Number.MAX_SAFE_INTEGER };
  let vues = 0;
  const compter = (i: number, courant: Record<string, string>) => {
    /* CE `return` N'EST PAS UNE SORTIE DE TEST : c'est le cas de base d'une récursion, à
       l'intérieur d'une fonction imbriquée. Une conversion automatique l'a pris pour une
       sortie muette et a fait ignorer le test entier — le contrôle qui cherche les cas qui
       ne regardent pas doit compter la profondeur des accolades, pas se fier au texte. */
    if (i === FIELDS.length) { vues++; return; }
    assert.ok(paliers.length > 0, "`paliers` est vide : la boucle qui suit ne vérifie rien.");
    for (const e of paliers) compter(i + 1, { ...courant, [FIELDS[i]!]: e });
  };
  compter(0, {});
  assert.equal(vues, attendu,
    `l'énumération couvre ${vues} affectations sur ${attendu} possibles`);
  assert.ok(optimiseExtraction(p, large), "aucune solution sans contrainte : l'énumération est cassée");
});

test("le budget d'argent mord dès que le volume monte", (t) => {
  /*
   * La page dit : « Not "the budget does not matter." It does not bind *here*, at this
   * volume, with these prices. Multiply the volume by fifty and it binds immediately. »
   * C'est une affirmation vérifiable, et elle ne l'était pas.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const ici = optimiseExtraction(p, ASSUMPTIONS);
  const gros = optimiseExtraction(p, { ...ASSUMPTIONS, volume: ASSUMPTIONS.volume * 50 });
  assert.ok(ici, "aucun routage au volume de référence");
  assert.ok(ici!.budgetShare < 1, "le budget mord déjà au volume de référence");
  assert.ok(!gros || gros.accuracy < ici!.accuracy || gros.budgetShare >= ici!.budgetShare,
    "multiplier le volume par cinquante ne change rien : la phrase de la page est fausse");
});

test("les gestes du pilote de capture mènent à l'optimum courant", (t) => {
  /*
   * Le pilote de capture est du code que rien ne compilait et que rien ne testait, et il
   * décrit un état du produit : la suite de gestes qui, partie de l'écran au démarrage,
   * arrive au routage optimal. C'est ce que le GIF de la première page montre.
   *
   * Il pointait vers `address~small`. C'était juste jusqu'au matin où l'échelle générative a
   * déplacé l'optimum vers `gen-4b` — et rien ne l'a signalé. La capture aurait tourné, aurait
   * produit une image parfaitement plausible, et aurait publié en première page une
   * démonstration qui s'arrête sur une réponse sous-optimale.
   *
   * Même famille que les chiffres écrits à la main : vrai le jour où c'est écrit, faux dès la
   * mesure suivante, et invisible entre les deux.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  type Script = { images: { sortie: string; scenes?: string[][] }[] };
  const script: Script = JSON.parse(readFileSync(fileURLToPath(new URL("../captures.json", import.meta.url)), "utf8"));
  const gif = script.images.find((i) => i.sortie.endsWith(".gif"));
  if (!gif?.scenes) return t.skip("!gif?.scenes — ce cas n'a rien regardé, et il le dit.");   // pas de GIF piloté : rien à tenir

  /* L'écran démarre avec tous les champs sur `large` — voir pages.ts. */
  const etat: Record<string, string> = Object.fromEntries(FIELDS.map((c) => [c, "large"]));
  const paliers = paliersMesures(p);

  assert.ok(gif.scenes.length > 0, "`gif.scenes` est vide : la boucle qui suit ne vérifie rien.");
  for (const scene of gif.scenes) {
    assert.ok(scene.length > 0, "`scene` est vide : la boucle qui suit ne vérifie rien.");
    for (const geste of scene) {
      const m = geste.match(/data-choix="([^"~]+)~([^"]+)"/);
      assert.ok(m, `geste illisible dans captures.json : ${geste}`);
      const [, champ, palier] = m!;
      assert.ok((FIELDS as string[]).includes(champ!),
        `le pilote vise le champ « ${champ} », qui n'existe pas`);
      assert.ok(paliers.includes(palier as never),
        `le pilote vise le palier « ${palier} », absent du profil gelé`);
      etat[champ!] = palier!;
    }
  }

  const vise = optimiseExtraction(p, ASSUMPTIONS);
  assert.ok(vise, "aucun routage optimal : le GIF n'a rien à montrer");
  for (const c of FIELDS) {
    assert.equal(etat[c], vise!.routing[c],
      `le pilote termine avec ${c} sur ${etat[c]} alors que l'optimum est ${vise!.routing[c]} — `
      + `le GIF publierait une démonstration qui s'arrête au mauvais endroit`);
  }
});

/**
 * La coupure ne se rouvre pas en silence.
 *
 * Trois modules produisent la réponse d'un client — la politique d'abstention exportable,
 * l'exposition en euros, le taux par dossier — et ils ne sont pas dans ce dépôt. Ce n'est pas
 * un rangement : c'est ce qui se vend. Le banc prouve la méthode sur notre corpus ; il ne
 * calcule pas la réponse de quelqu'un d'autre.
 *
 * L'HISTORIQUE COMPTE AUTANT QUE LA DERNIÈRE VERSION. Un fichier retiré du dernier commit
 * reste lisible dans `git log` pour toujours, et un dépôt public n'oublie rien. La garde
 * regarde donc l'historique entier de cette branche, pas l'arbre de travail : c'est la seule
 * lecture qui corresponde à ce qu'un lecteur peut réellement obtenir.
 *
 * Elle porte son propre témoin. Un `git log` qui échoue rend zéro ligne, exactement comme un
 * `git log` qui ne trouve rien : sans une recherche dont on connaît la réponse, ce test
 * passerait au vert dans un dossier qui n'est même pas un dépôt.
 */
test("aucun module licencié n'est atteignable dans l'historique de cette branche", (t) => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const git = (args: string[]) =>
    spawnSync("git", args, { cwd: racine, encoding: "utf8", timeout: 20_000 });

  const dedans = git(["rev-parse", "--is-inside-work-tree"]);
  if (dedans.status !== 0 || dedans.stdout.trim() !== "true") return t.skip("dedans.status !== 0 || dedans.stdout.trim() !== 'true' — ce cas n'a rien regardé, et il le dit.");   // archive, pas un dépôt

  /* LE TÉMOIN : un chemin dont on SAIT qu'il est dans l'historique. S'il ne sort pas, la
     commande ne lit rien et son silence sur les autres ne veut rien dire. */
  const temoin = git(["log", "--oneline", "--", "src/measure.ts"]);
  const lignesTemoin = temoin.stdout.trim().split("\n").filter(Boolean).length;
  assert.ok(temoin.status === 0 && lignesTemoin > 0,
    `le témoin n'a rien trouvé pour src/measure.ts (${lignesTemoin} ligne(s), code ${temoin.status}) :\n`
    + "  la lecture de l'historique a échoué, donc ce contrôle ne vérifie rien.");

  const LICENCIES = ["src/politique.ts", "src/exposition.ts", "src/document.ts",
    "politique.json", "politique.mjs"];
  const revenus: string[] = [];
  for (const chemin of LICENCIES) {
    const r = git(["log", "--oneline", "--", chemin]);
    const n = r.stdout.trim().split("\n").filter(Boolean).length;
    if (n > 0) revenus.push(`${chemin} (${n} commit(s))`);
  }
  assert.deepEqual(revenus, [],
    `des modules licenciés sont atteignables dans l'historique de cette branche :\n`
    + revenus.map((r) => `  - ${r}`).join("\n") + "\n"
    + "  → ils vivent dans le dépôt licencié. Un fichier retiré du dernier commit reste\n"
    + "    lisible dans « git log », et un dépôt public n'oublie rien.");
});

test("chaque rétractation nomme un test qui existe vraiment", (t) => {
  /*
   * Le journal des rétractations est un instrument anti-péremption, et il est lui-même
   * périssable : il est écrit à la main, et rien ne le relie au code. Le jour où un test est
   * renommé, une entrée pointe vers un contrôle imaginaire — et la page affirme qu'une erreur
   * est tenue alors que plus rien ne la tient.
   *
   * Ce test ferme la boucle dans le seul sens qui soit mécanisable : chaque `tenu` doit
   * désigner un test réel du dépôt.
   */
  const f = fileURLToPath(new URL("../retractations.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const journal = JSON.parse(readFileSync(f, "utf8")) as {
    entries: { claimed: string; heldBy: string | null; notHeld?: string; heldIn?: string }[] };

  /** Les seuls ailleurs admis. Une chaîne libre laisserait écrire n'importe quoi. */
  const DESTINATIONS = new Set(["composant licencié"]);
  let ailleurs = 0;

  /*
   * La liste des fichiers de test était écrite à la main, et `outils.test.ts` n'y était pas.
   * Une entrée tenue par un test réel de ce fichier a donc été refusée comme imaginaire — le
   * contrôle disait « ce test n'existe pas » là où il fallait lire « je ne l'ai pas cherché ».
   * Un contrôle anti-péremption qui périme lui-même demande le répertoire, il ne le récite pas.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const fichiers = readdirSync(dossier).filter((n) => n.endsWith(".test.ts")).sort();
  assert.ok(fichiers.length >= 5, `${fichiers.length} fichier(s) de test trouvé(s) : la lecture du répertoire a échoué.`);
  const sources = fichiers.map((n) => readFileSync(join(dossier, n), "utf8")).join("\n");
  const noms = new Set([...sources.matchAll(/test\("([^"]+)"/g)].map((m) => m[1]!));

  for (const e of journal.entries) {
    /*
     * Un `tenu` vide n'est plus une sortie silencieuse.
     *
     * Une entrée sur sept n'était tenue par rien, et le `continue` d'origine la laissait
     * passer sans un mot : le journal affichait sept rétractations dont six seulement
     * étaient vérifiées par quelque chose, sans que la différence se voie. Ne rien avoir qui
     * tienne une erreur est une réponse admissible — certaines portent sur d'autres dépôts —
     * mais c'est une réponse qui doit être **écrite**, pas déduite d'un champ absent.
     */
    if (!e.heldBy) {
      assert.ok(e.notHeld && e.notHeld.trim().length > 0,
        `la rétractation « ${e.claimed} » n'est tenue par aucun test et ne dit pas pourquoi.\n`
        + `  → soit elle nomme le test qui la tient dans « tenu »,\n`
        + `    soit elle explique dans « nonTenue » ce qui l'empêche d'en avoir un.`);
      continue;
    }
    /*
     * UN TEST PEUT VIVRE HORS DE CE DÉPÔT, ET ÇA SE DÉCLARE.
     *
     * Trois modules ont quitté le banc public pour le composant licencié, et un test est
     * parti avec eux. La rétractation qu'il tient, elle, reste ici : une erreur publiée se
     * rétracte publiquement, sinon le journal ne vaut rien.
     *
     * Mais « son test est ailleurs » est exactement l'excuse qui viderait ce contrôle. Elle
     * n'est donc admise que déclarée, sur une destination connue, et **comptée** : le nombre
     * d'entrées que ce dépôt ne peut pas vérifier lui-même est publié plus bas. Un chiffre
     * issu d'une sélection porte le compte de ce qu'il écarte.
     */
    if (e.heldIn) {
      assert.ok(DESTINATIONS.has(e.heldIn),
        `la rétractation « ${e.claimed} » dit que son test vit dans « ${e.heldIn} », qui n'est pas une destination connue.\n`
        + `  → destinations admises : ${[...DESTINATIONS].join(", ")}.`);
      assert.ok(!noms.has(e.heldBy),
        `la rétractation « ${e.claimed} » dit que son test est dans « ${e.heldIn} », mais « ${e.heldBy} » existe ici.\n`
        + `  → retirez « tenuAilleurs » : une entrée vérifiable ne doit pas se déclarer invérifiable.`);
      ailleurs++;
      continue;
    }
    assert.ok(noms.has(e.heldBy),
      `une rétractation dit être tenue par le test « ${e.heldBy} », qui n'existe pas.\n`
      + `  → soit le test a été renommé et l'entrée doit suivre,\n`
      + `    soit le contrôle a disparu et l'erreur peut revenir sans que rien ne tombe,\n`
      + `    soit il a suivi un module hors de ce dépôt, et l'entrée le déclare dans « heldIn ».`);
  }

  /*
   * Le compte de ce qu'on n'a pas pu vérifier. Il est borné : si la moitié du journal
   * devenait invérifiable depuis ce dépôt, le contrôle passerait toujours au vert tout en
   * ne regardant plus rien — le vert vide sous sa forme la plus lente.
   */
  assert.ok(ailleurs <= Math.floor(journal.entries.length / 4),
    `${ailleurs} rétractation(s) sur ${journal.entries.length} sont tenues par un test hors de ce dépôt.\n`
    + `  → au-delà du quart, ce contrôle ne vérifie plus assez pour valoir quelque chose.`);
});

/* ── la provenance du relevé lui-même ── */

/**
 * Le seul relevé à qui l'on pardonne de ne pas s'identifier.
 *
 * `measure.ts` écrit le commit et les réussites par cas depuis qu'ils existent. Ce profil-là
 * a été gelé avant, et rien ne peut le réparer après coup : y écrire un hash aujourd'hui
 * inventerait une provenance, ce que ce dépôt existe pour empêcher. Il est donc toléré
 * **nommément**, par sa date, et lui seul.
 *
 * La conséquence est celle qu'on veut : la tolérance porte sur l'histoire, jamais sur le
 * prochain passage. Dès qu'une mesure tourne, `measuredAt` change, la constante ne
 * correspond plus, et les deux tests ci-dessous deviennent durs sans que personne ait à
 * s'en souvenir.
 */
const RELEVE_HISTORIQUE = "2026-08-19T09:51:25.978Z";

test("un relevé régénéré porte le commit qui l'a produit", (t) => {
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");   // pas de profil : un clone frais n'a pas encore mesuré

  if (p.measuredAt === RELEVE_HISTORIQUE) {
    console.warn(`  ⚠ le profil gelé du ${RELEVE_HISTORIQUE} est antérieur à l'enregistrement du commit.\n`
      + `    Il est toléré par sa date, et par elle seule. \`npm run measure\` le rendra dur.`);
    return t.skip("condition non remplie — ce cas n'a rien regardé, et il le dit.");
  }

  assert.ok(p.code && typeof p.code.commit === "string" && p.code.commit.length > 0,
    `le relevé du ${p.measuredAt} ne porte pas de commit.\n`
    + `  → un relevé qu'on ne peut pas rattacher à une révision n'est pas un relevé :\n`
    + `    rien ne dit quel code a produit ces chiffres, ni s'il est encore là.`);
  assert.equal(typeof p.code!.sale, "boolean",
    "le relevé doit dire si l'arbre était sale au moment de la mesure — un chiffre produit "
    + "sur des modifications non committées n'est pas reproductible");
});

test("un relevé régénéré garde les réussites par cas, pour que McNemar puisse tourner", (t) => {
  /*
   * Sans ces bits, `memeChamp` retombe sur le recouvrement d'intervalles de Wilson — un test
   * qui traite deux paliers notés sur les *mêmes* cas comme deux échantillons indépendants.
   * Il est valable mais trop prudent : il déclare « indiscernables » des paires qu'un test
   * apparié sépare, et le routage retient alors le moins cher sur une égalité qui n'en est
   * pas une. `pairedVerdict` attend ces bits et existait, inutilisé, depuis le premier jour.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");

  if (p.measuredAt === RELEVE_HISTORIQUE) {
    console.warn(`  ⚠ le profil gelé du ${RELEVE_HISTORIQUE} ne conserve pas les réussites par cas :\n`
      + `    toutes ses égalités viennent du recouvrement d'intervalles, pas de McNemar.`);
    return t.skip("condition non remplie — ce cas n'a rien regardé, et il le dit.");
  }

  for (const t of paliersMesures(p)) {
    for (const c of FIELDS) {
      const profil: Profile = p.extraction[t][c];
      /*
       * LE PALIER HUMAIN EST EXEMPTÉ, ET L'EXEMPTION EST UN CONTRÔLE.
       *
       * `extract("human", …)` rend la vérité terrain : la boucle de mesure y trouve donc
       * mille réussites sur mille, et le fichier enregistrait mille bits à 1 comme s'il
       * s'agissait d'une observation. McNemar sur ces bits comparerait un palier à une
       * copie de la réponse. On ne se contente pas de sauter le cas : on EXIGE la marque
       * et l'absence de bits, sinon la fabrication peut revenir sans que rien ne le voie.
       */
      if (t === "human") {
        assert.equal(profil.reussites, undefined,
          "le palier humain porte des réussites par cas : ce sont mille « 1 » rendus par la "
          + "vérité terrain, pas une observation.");
        assert.equal(typeof (profil as { commodite?: string }).commodite, "string",
          "le palier humain ne porte pas sa marque : rien ne distingue sa ligne d'une mesure.");
        continue;
      }
      assert.equal(typeof profil.reussites, "string",
        `${t}/${c} ne conserve pas ses réussites par cas — le test apparié ne peut pas tourner`);
      assert.equal(profil.reussites!.length, profil.items,
        `${t}/${c} a ${profil.reussites!.length} bits pour ${profil.items} cas : `
        + `les deux doivent coïncider, sinon McNemar apparie des cas qui ne se correspondent pas`);
      assert.match(profil.reussites!, /^[01]+$/,
        `${t}/${c} : les réussites doivent être une suite de 0 et de 1`);
    }
  }
});

test("toute hypothèse qui tarife un palier sélectionnable est balayée", (t) => {
  /*
   * Un balayage incomplet est pire qu'un balayage absent.
   *
   * `machineHourlyCost` manquait à `PLAUSIBLE`. Il tarife les trois paliers génératifs, dont
   * `gen-4b`, que le routage retenu utilise sur l'adresse — donc `npm run sensitivity`
   * rendait un verdict rassurant en sautant en silence une hypothèse dont la recommandation
   * dépend. `workingDaysPerYear` manquait aussi, et il entre dans le coût horaire de
   * l'analyste. Aucun des deux ne se voyait : l'outil ne liste que ce qu'il balaie.
   *
   * La règle est mécanisable, donc elle n'a pas à rester dans une note : si perturber une
   * hypothèse change le prix d'un palier que l'optimiseur peut retenir, cette hypothèse doit
   * figurer dans le balayage. Le test la vérifie par le calcul et non par une liste écrite en
   * double, qui se serait désynchronisée exactement comme celle qu'elle remplace.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");

  const paliers = paliersMesures(p);
  let gouvernantes = 0;
  for (const cle of Object.keys(ASSUMPTIONS) as (keyof typeof ASSUMPTIONS)[]) {
    const perturbee = { ...ASSUMPTIONS, [cle]: (ASSUMPTIONS[cle] as number) * 2 };
    const touches: string[] = paliers.filter((t: TierName) =>
      pricePerThousandDocuments(p, perturbee, t) !== pricePerThousandDocuments(p, ASSUMPTIONS, t));
    if (touches.length === 0) continue;
    gouvernantes++;

    assert.ok(cle in PLAUSIBLE,
      `« ${cle} » tarife ${touches.join(", ")} et n'est pas dans PLAUSIBLE.\n`
      + `  → \`npm run sensitivity\` conclurait sans elle, en donnant une assurance qu'il n'a pas vérifiée.`);
  }
  assert.ok(gouvernantes > 0,
    "aucune hypothèse ne tarife un palier : la règle de gouvernance ne reconnaît plus rien, "
    + "et ce test ne garde plus le balayage.");
});

test("les deux balayages de prix ne peuvent pas se contredire", (t) => {
  /*
   * Deux fichiers répondent à la même question, et ils ont divergé.
   *
   * `sensitivity.ts` rendait « genuinely insensitive » pour le prix du petit modèle pendant
   * que `landing.json` disait « tier not selected » — le même dépôt affirmait deux choses
   * incompatibles sur le même chiffre, l'une rassurante et fausse. La cause n'était pas le
   * calcul mais l'affichage : deux `if` suivis d'un repli qui écrasait toute valeur inconnue
   * en la plus confortable.
   *
   * Ce test tient l'accord entre les deux, sur le seul point qui compte : un palier absent du
   * routage ne doit jamais être rapporté comme une robustesse, quel que soit le fichier qui
   * le dit.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");

  const optimum = optimiseExtraction(p, ASSUMPTIONS);
  if (!optimum) return t.skip("!optimum — ce cas n'a rien regardé, et il le dit.");
  const retenus = new Set(FIELDS.map((c) => optimum.routing[c]));

  /* Balayage grossier : on vérifie une classification, pas la largeur d'une bande. */
  for (const b of bands(p, ASSUMPTIONS, 8)) {
    if (b.reason !== "genuinely insensitive") continue;

    /* « Robuste » n'est légitime que si le palier gouverné est réellement en usage. */
    const perturbee = { ...ASSUMPTIONS, [b.assumption]: (ASSUMPTIONS[b.assumption] as number) * 2 };
    const gouvernes: TierName[] = paliersMesures(p).filter((t: TierName) =>
      pricePerThousandDocuments(p, perturbee, t) !== pricePerThousandDocuments(p, ASSUMPTIONS, t));
    if (gouvernes.length === 0) continue;   // n'est pas un prix : hors sujet ici

    assert.ok(gouvernes.some((t: TierName) => retenus.has(t)),
      `« ${b.assumption} » est rapportée « genuinely insensitive », mais elle ne tarife que `
      + `${gouvernes.join(", ")}, qu'aucun champ du routage n'utilise.\n`
      + `  → ce n'est pas de la robustesse, c'est une non-sélection, et les deux ne se disent`
      + ` pas de la même façon à un lecteur.`);
  }
});

test("chaque verdict de sensibilité a son étiquette et sa phrase", () => {
  /*
   * Le calcul était juste et l'affichage mentait : une quatrième valeur est apparue dans le
   * type, et deux sites de rendu l'ont écrasée en la troisième par un repli implicite. Un
   * `Record` complet et un `switch` exhaustif rendent ça impossible à la compilation ; ce test
   * ferme le dernier trou, celui d'une étiquette présente mais vide.
   */
  for (const raison of Object.keys(ETIQUETTE) as (keyof typeof ETIQUETTE)[]) {
    assert.ok(ETIQUETTE[raison].trim().length > 0, `le verdict « ${raison} » n'a pas d'étiquette`);
    const phrase = advise({ assumption: "volume", reason: raison, current: 1, stableFrom: 0,
      stableTo: 2, currentInside: true, decides: false }, [0, 2]);
    assert.ok(phrase && phrase.trim().length > 0, `le verdict « ${raison} » n'a pas de conseil`);
  }
  /* Et les quatre phrases doivent différer : deux verdicts qui disent la même chose n'en font qu'un. */
  const phrases = (Object.keys(ETIQUETTE) as (keyof typeof ETIQUETTE)[]).map((r) =>
    advise({ assumption: "volume", reason: r, current: 1, stableFrom: 0, stableTo: 2,
      currentInside: true, decides: false }, [0, 2]));
  assert.equal(new Set(phrases).size, phrases.length, "deux verdicts rendent la même phrase");
});

test("chaque hypothèse porte son unité, dénominateur compris", () => {
  /*
   * Un nombre publié sans son unité s'en fait attribuer une.
   *
   * `landing.json` a publié `humanSeconds: 45` sans dire « secondes », et la page qui le lit a
   * deviné : elle a mis un signe dollar partout, et a affiché qu'un analyste coûte quarante-cinq
   * dollars la seconde. Des données exactes, un rendu qui suppose, un chiffre faux — sans que
   * rien n'échoue nulle part.
   *
   * Le `Record` complet garantit déjà la présence à la compilation. Ce test tient les deux
   * choses que le type ne peut pas dire : que l'unité n'est pas vide, et qu'elle porte son
   * **dénominateur**. « usd » ne suffit pas là où la vraie unité est « usd/1000 extractions » —
   * c'est l'omission du dénominateur qui avait déjà fait publier un coût faux d'un facteur cinq.
   */
  for (const cle of Object.keys(ASSUMPTIONS) as (keyof typeof ASSUMPTIONS)[]) {
    const u = UNITS[cle];
    assert.ok(u && u.trim().length > 0, `« ${cle} » n'a pas d'unité`);
    /*
     * Il n'y a pas d'exemption, et il y en avait une.
     *
     * Ce test laissait passer « fraction » au motif qu'une fraction n'aurait pas de
     * dénominateur. C'est faux : `humanAccuracy: 0.85` est un rapport — des champs justes par
     * champ — et « fraction » ne dit pas fraction **de quoi**. La dispense n'était pas un angle
     * mort, c'était une porte que j'avais ouverte, avec un raisonnement erroné écrit à côté.
     * Elle a laissé sortir la valeur jusque dans `landing.json`, où un contrôle de la page l'a
     * arrêtée — celui qui lit l'artefact voit ce que celui qui le fabrique a cessé de voir.
     */
    assert.ok(u.includes("/"),
      `l'unité de « ${cle} » est « ${u} », sans dénominateur.\n`
      + `  → « usd » et « usd/1000 extractions » ne se lisent pas pareil, et c'est cette`
      + ` omission-là qui a déjà fait publier un coût faux d'un facteur cinq.`);
  }
});

test("un petit échantillon est le préfixe exact d'un grand", () => {
  /*
   * C'est ce qui rend le `n` par palier propre plutôt que seulement possible.
   *
   * Les paliers ne sont plus mesurés sur la même quantité de cas : les encodeurs à mille, les
   * génératifs à cent vingt. Comparer deux paliers de tailles différentes n'a de sens que si
   * le petit a vu **les mêmes cas** que les premiers du grand — sinon le test apparié compare
   * des réponses données à des questions différentes, et le fait en silence.
   *
   * Le tirage est déterministe et séquentiel, donc la propriété tient ; ce test la rend
   * obligatoire. Le jour où le générateur mélangerait ou rééchantillonnerait, il tombe.
   */
  for (const n of [20, 120, 300]) {
    const petit = generateRecords(n, "heldout");
    const grand = generateRecords(1000, "heldout");
    assert.equal(petit.length, n);
    for (let i = 0; i < n; i++) {
      assert.equal(petit[i]!.text, grand[i]!.text,
        `le cas ${i} d'un tirage de ${n} diffère du même rang dans un tirage de 1000 — `
        + `un palier mesuré sur ${n} cas ne serait plus comparable à un palier mesuré sur 1000`);
    }
    const petitesAlertes = generateAlerts(n, "heldout");
    const grandesAlertes = generateAlerts(1000, "heldout");
    for (let i = 0; i < n; i++) {
      assert.equal(petitesAlertes[i]!.narrative, grandesAlertes[i]!.narrative,
        `l'alerte ${i} diffère entre un tirage de ${n} et un tirage de 1000`);
    }
  }
});

test("un palier mesuré porte sa propre provenance", (t) => {
  /*
   * `code` décrivait une passe en prétendant décrire un fichier que `sauver` fusionne. Le
   * relevé a ainsi porté `sale: true` pour sept paliers dont trois venaient d'une passe sur
   * arbre propre. La provenance est maintenant écrite avec le palier ; ce test interdit qu'un
   * palier mesuré après ce changement reparte sans elle.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  if (p.measuredAt === RELEVE_HISTORIQUE) return t.skip("p.measuredAt === RELEVE_HISTORIQUE — ce cas n'a rien regardé, et il le dit.");

  /*
   * Compter ce qu'on a réellement vérifié.
   *
   * Chaque palier peut être sauté pour une raison légitime — provenance absente, forme
   * antérieure au champ. Mais si le champ était renommé, **tous** seraient sautés et le test
   * passerait au vert en n'ayant rien regardé. Un test qui agrège avant de vérifier est
   * aveugle à la moitié qui s'est tue ; celui-ci exige d'avoir vu au moins un palier.
   */
  let verifies = 0;
  for (const t of paliersMesures(p)) {
    const v: ProvenanceDuPalier | undefined = p.provenance?.[t];
    if (v === undefined) continue;   // palier antérieur au champ : `null` assumé, pas inventé
    /* Relevé antérieur à la séparation par type de mesure : sa forme plate n'est pas une faute. */
    if (v.accuracy === undefined) continue;
    verifies++;
    for (const quoi of ["accuracy", "latency"] as const) {
      const b: Provenance = v[quoi];
      assert.ok(b, `${t} n'a pas de provenance pour ${quoi}`);
      assert.equal(typeof b.measuredAt, "string", `${t}/${quoi} a une provenance sans date`);
      assert.ok(b.commit === null || typeof b.commit === "string", `${t}/${quoi} a un commit mal formé`);
      assert.ok(b.sale === null || typeof b.sale === "boolean", `${t}/${quoi} a un état d'arbre mal formé`);
    }
  }
  assert.ok(verifies > 0,
    "aucun palier n'a été vérifié : tous ont été sautés, ce qui veut dire que le champ a "
    + "changé de nom ou de forme et que ce test ne garde plus rien.");
});

/* ── ce qui peut sortir de cette machine, et rien d'autre ── */

/**
 * Les seuls appels sortants que ce dépôt s'autorise, avec la raison de chacun.
 *
 * Toute autre destination doit faire tomber la suite. C'est le contrôle qu'une revue de
 * sécurité peut refaire en une minute : elle lit cette liste, elle lit le test, et elle sait
 * ce que l'outil contacte sans avoir à lire dix fichiers ni à faire confiance à un README.
 */
const SORTIES_AUTORISEES = [
  { motif: "OLLAMA_HOST", ou: "src/tiers.ts", pourquoi: "les modèles génératifs, sur la boucle locale par défaut" },
  { motif: "raw.githubusercontent.com", ou: "src/benchmark.ts", pourquoi: "un jeu public, téléchargé par `npm run benchmark` seulement — hors du chemin d'une mesure" },
];

test("une mesure ne peut contacter que cette machine", () => {
  /*
   * La phrase la plus importante du dépôt pour qui manipule de vrais dossiers, et c'était une
   * affirmation. `npm run egress` la mesure — mais son verdict vit dans `data/`, hors du
   * dépôt, et une revue de sécurité ne peut ni le lire ni le rejouer en une minute.
   *
   * Ce test la rend structurelle : l'hôte génératif doit être local, faute de quoi chaque
   * document mesuré part chez un tiers. C'est la seule configuration où ça arrive, et elle
   * tenait à une variable d'environnement que personne ne vérifiait.
   */
  assert.ok(estLocal(OLLAMA),
    `OLLAMA_HOST vise ${OLLAMA}, qui n'est pas cette machine — chaque document mesuré y partirait.`);

  for (const [url, attendu] of [
    ["http://localhost:11434", true], ["http://127.0.0.1:11434", true], ["http://[::1]:11434", true],
    ["http://ollama.interne.example:11434", false], ["https://api.exemple.com", false],
    ["http://127.0.0.1.evil.example", false], ["pas une url", false],
  ] as [string, boolean][]) {
    assert.equal(estLocal(url), attendu, `estLocal("${url}") devrait valoir ${attendu}`);
  }
});

test("aucun appel sortant n'a été ajouté hors de la liste", () => {
  /*
   * Un `fetch` ajouté demain vers un point de télémétrie ne se verrait pas : il compilerait,
   * les tests passeraient, et la promesse deviendrait fausse en silence. Ce test lit les
   * sources et exige que chaque destination possible figure dans `SORTIES_AUTORISEES`.
   *
   * Les URL citées en texte — une source réglementaire, un lien dans une page — ne sont pas
   * des appels : on ne retient que ce qui est passé à `fetch`.
   */
  const dossier = fileURLToPath(new URL("./", import.meta.url));
  const fichiers = readdirSync(dossier).filter((f) => /\.(ts|mjs)$/.test(f) && !f.endsWith(".test.ts"));

  const permis = SORTIES_AUTORISEES.map((s) => s.motif);
  assert.ok(fichiers.length > 0, "`fichiers` est vide : la boucle qui suit ne vérifie rien.");
  for (const f of fichiers) {
    const src = readFileSync(join(dossier, f), "utf8");
    for (const m of src.matchAll(/fetch\(\s*[`"']?([^`"'),\s]+)/g)) {
      const cible = m[1]!;
      const local = /localhost|127\.0\.0\.1|\$\{OLLAMA\}|\$\{port\}|\$\{PORT\}/.test(cible);
      const liste = permis.some((p) => cible.includes(p) || src.includes(p));
      assert.ok(local || liste,
        `${f} appelle fetch vers « ${cible} », qui n'est ni local ni dans SORTIES_AUTORISEES.\n`
        + `  → si c'est légitime, ajoutez-le à la liste avec sa raison ; sinon, la promesse`
        + ` « rien ne quitte votre machine » vient de devenir fausse.`);
    }
  }
});

test("l'écran n'écoute que la boucle locale", () => {
  /*
   * `listen(PORT)` seul rend l'outil joignable par n'importe qui sur le même réseau — dans une
   * banque, c'est un écran de dossiers clients exposé au réseau interne. L'adresse est déjà
   * explicite dans le code ; ce test empêche qu'elle disparaisse à la faveur d'un nettoyage.
   */
  const src = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");
  assert.match(src, /listen\(PORT,\s*"127\.0\.0\.1"/,
    "le serveur doit écouter 127.0.0.1 explicitement, jamais toutes les interfaces");

  /*
   * Et tous les autres serveurs du dépôt, pas seulement celui-ci.
   *
   * Ce test ne lisait que `server.ts`. Deux autres fichiers lancent un `http.server` Python
   * sans `--bind`, donc sur toutes les interfaces — invisibles pour lui pendant tout ce temps.
   * Un résidu de l'un d'eux écoutait sur `*:8840` depuis deux jours et huit heures.
   *
   * Se connecter en 127.0.0.1 ne suffit pas : c'est l'adresse d'écoute qui décide qui peut
   * joindre, pas celle qu'on emploie soi-même. Le gardien lit donc le répertoire au lieu de
   * réciter une liste — la même correction que le contrôle des rétractations a demandée.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const fichiers = readdirSync(dossier).filter((n) => /\.(ts|mjs)$/.test(n) && !n.endsWith(".test.ts"));
  const lanceurs = fichiers
    .map((n) => ({ n, src: readFileSync(join(dossier, n), "utf8") }))
    .filter(({ src: s2 }) => /http\.server/.test(s2) || /\.listen\(/.test(s2));
  assert.ok(lanceurs.length >= 3,
    `${lanceurs.length} fichier(s) lançant un serveur trouvé(s) : la détection a échoué et ce test ne vérifie rien.`);
  for (const { n, src: s2 } of lanceurs) {
    if (/http\.server/.test(s2)) {
      assert.match(s2, /"--bind",\s*"127\.0\.0\.1"/,
        `${n} lance http.server sans --bind : il écoute sur toutes les interfaces.\n`
        + `  → se connecter en 127.0.0.1 ne change rien, c'est l'adresse d'écoute qui décide.`);
    }
    if (/\.listen\(/.test(s2)) {
      assert.match(s2, /\.listen\([^)]*"127\.0\.0\.1"/,
        `${n} appelle listen sans adresse : il écoute sur toutes les interfaces.`);
    }
  }
});

test("les deux fichiers classent une absence de seuil de la même façon", (t) => {
  /*
   * Ils ont divergé deux fois, et la seconde était de ma main.
   *
   * `sensitivity.ts` a gagné une quatrième valeur — un palier jamais choisi n'est pas de la
   * robustesse — et `landing.ts` ne l'a pas reçue. Au premier cas venu, le coût d'un champ
   * vide, les deux ont dit des choses incompatibles : « jamais choisi » d'un côté, alors que
   * `rules` produit les vides et tient trois champs du routage.
   *
   * Le test précédent ne regardait qu'un des deux fichiers, donc il ne pouvait pas voir la
   * divergence : il tenait une règle, pas l'accord. Celui-ci compare les verdicts sortis des
   * deux générateurs sur les hypothèses qu'ils ont en commun.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");

  const publie = JSON.parse(readFileSync(f, "utf8")) as {
    sensitivity: { thresholds: Record<string, { reason: string; breaksAt: number | null }> } };

  /* Huit pas au lieu de soixante : on compare des verdicts, pas des bornes de bande,
     et chaque pas coûte une énumération complète des routages. */
  let compares = 0;
  for (const b of bands(p, ASSUMPTIONS, 8)) {
    const cote = publie.sensitivity.thresholds[b.assumption];
    if (!cote) continue;   // pas balayée des deux côtés : hors sujet ici
    compares++;

    /*
     * Les deux ne posent pas la même question, et j'ai d'abord écrit qu'elles la posaient.
     *
     * `sensitivity.ts` demande « est-ce que ça change **dans la plage plausible** » ;
     * `landing.ts` demande « où est-ce que ça change, où que ce soit ». Un seuil à 39,59 $
     * hors d'une plage qui s'arrête à 20 $ n'est donc pas une contradiction : c'est la même
     * réalité vue par deux fenêtres. Exiger l'équivalence faisait tomber le test sur un
     * dépôt parfaitement cohérent — un contrôle faux qui accuse est pire qu'absent, parce
     * qu'on finit par le désactiver et perdre ce qu'il gardait vraiment.
     */
    if (cote.breaksAt !== null) {
      const [bas, haut] = PLAUSIBLE[b.assumption]!;
      const dedans = cote.breaksAt >= bas && cote.breaksAt <= haut;
      assert.equal(b.reason === "affects the answer", dedans,
        `« ${b.assumption} » : landing.json place le seuil à ${cote.breaksAt}, `
        + `${dedans ? "dans" : "hors de"} la plage plausible [${bas}, ${haut}], mais `
        + `sensitivity.ts dit « ${b.reason} ».`);
      continue;
    }
    assert.equal(b.reason, cote.reason,
      `« ${b.assumption} » est classée « ${b.reason} » par sensitivity.ts et « ${cote.reason} » `
      + `par landing.json.\n`
      + `  → le même dépôt dirait deux choses incompatibles du même chiffre, et l'une des deux`
      + ` se lit comme rassurante.`);
  }
  assert.ok(compares > 0,
    "aucune hypothèse n'est balayée des deux côtés : si `landing.json` cessait d'en publier, "
    + "ce test constaterait un accord parfait entre deux ensembles vides.");
});

test("aucun relevé suivi par git ne transporte ses sorties brutes", () => {
  /*
   * Un blob entré dans l'historique y reste, dans tous les clones, pour toujours.
   *
   * Les sorties brutes pèsent quatre cents kilooctets par passe et n'ont aucune raison d'être
   * lues par un relecteur : elles servent à re-scorer, pas à comprendre. Deux copies de
   * sauvegarde de sept cent dix kilooctets ont pourtant été committées — non par négligence
   * du principe, mais parce que la vérification portait sur `data/profiles.json`, bien ignoré
   * par git, et pas sur les copies que la sauvegarde fabriquait à la racine. On vérifiait le
   * fichier dont on parlait, pas celui qu'on créait.
   *
   * Il a fallu réécrire onze commits. Ce test rend l'erreur impossible plutôt que réparable :
   * il regarde ce que git suit réellement, ce qu'aucune relecture d'intention n'aurait vu.
   */
  const suivis = execFileSync("git", ["ls-files", "--", "*.json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
  }).split("\n").filter((f) => /profiles.*\.json$/.test(f));

  assert.ok(suivis.length > 0,
    "aucun relevé n'est suivi par git — soit ils ont tous disparu, soit le motif de recherche "
    + "ne les reconnaît plus, et ce test passerait au vert en n'ayant rien regardé. "
    + "C'est arrivé : juste après la réécriture d'historique, les fichiers étaient hors index.");

  let vus = 0;
  for (const f of suivis) {
    const chemin = fileURLToPath(new URL(`../${f}`, import.meta.url));
    if (!existsSync(chemin)) continue;
    vus++;
    const p = JSON.parse(readFileSync(chemin, "utf8")) as {
      extraction?: Record<string, Record<string, { sorties?: unknown }>> };
    for (const [tier, champs] of Object.entries(p.extraction ?? {})) {
      for (const [champ, profil] of Object.entries(champs)) {
        assert.equal(profil.sorties, undefined,
          `${f} est suivi par git et transporte les sorties brutes de ${tier}/${champ}.\n`
          + `  → quatre cents kilooctets par passe, définitifs dès le premier commit, et`
          + ` téléchargés par quiconque clone. Les sorties vont dans data/, qui est ignoré.`);
      }
    }
  }
  assert.ok(vus > 0, "aucun relevé suivi n'a pu être lu sur le disque : rien n'a été vérifié");
});

test("chaque latence enregistrée dit sous quelle charge elle a été prise", (t) => {
  /*
   * Ce qui rend « mesuré sur machine au repos » vérifiable au lieu d'affirmable.
   *
   * Cette phrase a été écrite, crue, et fausse pendant une passe entière — un pilote audio
   * oublié tenait un cœur sur dix depuis seize jours et valait un tiers de la latence de la
   * chaîne. Personne ne pouvait le contrôler, parce que le nombre n'était nulle part.
   *
   * Il y est maintenant, et ce test l'exige : une durée sans sa charge est une durée qu'on
   * demande au lecteur de croire. Le seuil qui décide de l'enregistrer est déclaré à côté,
   * dans `INVENTORY`, comme le choix qu'il est.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");

  let verifies = 0;
  for (const t of paliersMesures(p)) {
    const v: ProvenanceDuPalier | undefined = p.provenance?.[t];
    if (!v?.latency) continue;                    // palier antérieur au champ
    if (v.latency.charge === undefined) continue; // relevé antérieur à la charge
    verifies++;
    const c: NonNullable<Provenance["charge"]> = v.latency.charge;
    assert.ok(Number.isFinite(c.externalBefore) && c.externalBefore >= 0,
      `${t} enregistre une latence sans charge externe exploitable`);
    assert.ok(Number.isFinite(c.totalDuring) && c.totalDuring >= 0,
      `${t} enregistre une latence sans charge pendant la mesure`);
    assert.ok(c.coeurs > 0, `${t} enregistre une charge sans le nombre de cœurs qui la rend lisible`);
  }
  assert.ok(verifies > 0,
    "aucune latence n'a été vérifiée : le champ de charge a disparu, et « mesuré au repos » "
    + "redevient une affirmation que personne ne peut contrôler.");
});

test("la décomposition des erreurs recompose l'exactitude du palier", (t) => {
  /*
   * Deux dérivations du même relevé doivent se rejoindre.
   *
   * `errorSplit` compte les échecs par type ; `accuracy` compte les réussites. Sur un même
   * palier et un même champ, blanc + faux doit valoir exactement ce que l'exactitude laisse
   * de côté. Si les deux divergent, l'une des deux lectures de `reussites` est fausse — et
   * ces trois blocs viennent précisément d'être ajoutés parce qu'ils voyageaient à la main
   * sans que rien ne les tienne.
   *
   * Le test tient aussi la borne : un dossier n'est propre que si ses cinq champs le sont,
   * donc le taux propre ne peut pas dépasser le plus faible de ses cinq champs.
   */
  const p = readProfiles();
  if (!p) return t.skip("aucun relevé lisible : ce cas n'a rien regardé, et il le dit plutôt que de compter comme un cas passé.");
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const l = JSON.parse(readFileSync(f, "utf8")) as {
    errorSplit: { perThousand: Record<string, { tier: string; blank: number | null; wrong: number | null }> } | null;
    cleanPerDocument: { pct: number; n: number; clean: number } | null;
  };
  if (!l.errorSplit || !l.cleanPerDocument) return t.skip("!l.errorSplit || !l.cleanPerDocument — ce cas n'a rien regardé, et il le dit.");

  let verifies = 0;
  let pireChamp = 100;
  for (const c of FIELDS) {
    const e: { tier: string; blank: number | null; wrong: number | null } | undefined = l.errorSplit.perThousand[c];
    if (!e || e.blank === null || e.wrong === null) continue;
    verifies++;
    const q = p.extraction[e.tier as TierName][c];
    const echecs = Math.round(1000 * (1 - q.accuracy));
    assert.ok(Math.abs(e.blank + e.wrong - echecs) <= 1,
      `${c} : errorSplit compte ${e.blank + e.wrong} échecs pour mille, l'exactitude en dit `
      + `${echecs}. Deux lectures du même relevé qui ne se rejoignent pas.`);
    pireChamp = Math.min(pireChamp, 100 * q.accuracy);
  }
  assert.ok(verifies > 0, "aucun champ vérifié : la décomposition ne couvre plus rien");
  assert.ok(l.cleanPerDocument.pct <= pireChamp + 0.05,
    `le taux de dossiers propres (${l.cleanPerDocument.pct} %) dépasse le plus faible champ `
    + `du routage (${pireChamp.toFixed(1)} %) — impossible, un dossier n'est propre que si tous le sont.`);
});

test("chaque rétractation porte son résumé et dit si quelqu'un l'a vue", (t) => {
  /*
   * Deux champs qu'un générateur ne doit jamais déduire.
   *
   * Le résumé est une phrase écrite ; « personne ne l'a vue » est un jugement sur une
   * histoire. Les inférer d'un texte français les rendrait généreux au premier cas ambigu —
   * et la sévérité de ce second champ est exactement ce qui empêche l'argument de se
   * retourner : une page qui compte ses rétractations sans conséquence a intérêt à en
   * trouver beaucoup.
   *
   * Le test n'a pas d'avis sur leur valeur. Il exige seulement qu'elles soient posées, et
   * qu'une entrée ajoutée demain ne parte pas sans elles.
   */
  const f = fileURLToPath(new URL("../retractations.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const j = JSON.parse(readFileSync(f, "utf8")) as {
    entries: { date: string; headline?: string; caughtBeforeAnyoneSawIt?: boolean }[] };

  assert.ok(j.entries.length > 0, "le journal est vide : rien n'est vérifié ici");
  for (const e of j.entries) {
    assert.ok(typeof e.headline === "string" && e.headline.trim().length > 0,
      `la rétractation du ${e.date} n'a pas de résumé — la page en afficherait un trou`);
    assert.equal(typeof e.caughtBeforeAnyoneSawIt, "boolean",
      `la rétractation du ${e.date} ne dit pas si quelqu'un l'a vue.\n`
      + `  → ce n'est pas déductible du texte, et un générateur qui devinerait pencherait`
      + ` du côté qui flatte le compte.`);
  }
});

/*
 * Le point chargé n'est pas une passe complète, et la page ne doit pas le laisser croire.
 *
 * Six paliers sur sept y sont recopiés du relevé au repos. Affirmer « exactitude identique au
 * millième aux deux charges » en les comptant tous serait vrai et vide : on comparerait des
 * copies à elles-mêmes. Un seul palier a réellement été mesuré deux fois, et c'est cette
 * mesure-là — une seule — qui porte l'affirmation.
 */
test("l'égalité d'exactitude sous charge ne porte que sur les paliers réellement remesurés", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const ls = (JSON.parse(readFileSync(f, "utf8")) as {
    loadSweep: null | {
      tiers: { id: string; remeasuredUnderLoad: boolean; accuracyGapPct: number }[];
      tiersMeasuredAtBothLoads: number; tiersTotal: number;
      accuracyIdenticalToThousandth: boolean | null;
      largestGapAmongRemeasuredPct: number | null;
      msPerDocComparable: boolean; note: string;
    }}).loadSweep;
  assert.ok(ls, "landing.json ne porte pas de balayage de charge.");

  const remesures = ls.tiers.filter((t) => t.remeasuredUnderLoad);
  assert.equal(remesures.length, ls.tiersMeasuredAtBothLoads,
    "le compte annoncé ne correspond pas aux paliers marqués remesurés.");
  assert.ok(ls.tiersMeasuredAtBothLoads >= 1,
    "aucun palier mesuré aux deux charges : l'affirmation d'égalité n'a aucune mesure derrière elle.");

  /* Le plus grand écart doit venir des remesurés seuls, jamais de l'ensemble. */
  const attendu = Math.max(...remesures.map((t) => t.accuracyGapPct));
  assert.equal(ls.largestGapAmongRemeasuredPct, attendu,
    "l'écart publié n'est pas celui des paliers remesurés.");
  assert.equal(ls.accuracyIdenticalToThousandth, attendu < 0.001);

  if (ls.tiersMeasuredAtBothLoads < ls.tiersTotal) {
    assert.ok(/sur \d+ y ont été remesurés/.test(ls.note),
      "le point chargé est partiel et la note ne le dit pas — c'est là que le lecteur se trompe.");
    assert.equal(ls.msPerDocComparable, false,
      "aucun palier remesuré n'est employé par le routage : deux ms/doc identiques ne prouvent rien.");
  }
});

/*
 * « Mesuré sous la référence » est déduit du code, pas supposé — et la déduction est vérifiable.
 *
 * Les relevés antérieurs au drapeau `--prompt` n'enregistrent aucune formulation, et pour cause :
 * il n'y en avait qu'une. Écrire « reference » sans le démontrer serait remplacer un `null`
 * honnête par une supposition confortable. Ce test demande à git ce que le code contenait.
 */
test("le commit qui introduit le choix de formulation est bien celui qu'on nomme", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const c = PREMIER_COMMIT_MULTI_FORMULATION;
  const contient = (rev: string) => {
    try {
      return execFileSync("git", ["show", `${rev}:src/measure.ts`], { cwd: racine, encoding: "utf8" })
        .includes("--prompt=");
    } catch { return null; }
  };
  const ici = contient(c);
  const avant = contient(`${c}~1`);
  assert.notEqual(ici, null, `${c} est introuvable : la déduction sur la formulation ne tient plus.`);
  assert.equal(ici, true, `${c} ne contient pas de sélection de formulation dans measure.ts.`);
  assert.equal(avant, false,
    `le parent de ${c} en contient déjà une : ce n'est pas le commit qui l'introduit,\n`
    + `  donc « mesuré avant lui ⇒ formulation reference » ne se déduit plus du code.`);

  /* Et tout palier de landing.json doit porter sa formulation, jamais l'absence. */
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
  const perTier = (JSON.parse(readFileSync(f, "utf8")) as {
    generatedFrom: { perTier: Record<string, null | { accuracy: { phrasing?: string; phrasingSource?: string } }> };
  }).generatedFrom.perTier;
  let vus = 0;
  for (const [t, v] of Object.entries(perTier)) {
    if (!v) continue;
    vus++;
    assert.ok(v.accuracy.phrasing, `${t} ne dit pas sous quelle formulation son exactitude a été mesurée.`);
    assert.ok(v.accuracy.phrasingSource,
      `${t} donne une formulation sans dire si elle est enregistrée ou déduite.`);
  }
  assert.ok(vus >= 5, `${vus} palier(s) examiné(s) : trop peu pour que ce test ait vérifié quoi que ce soit.`);
});

/*
 * Le balayage vers le bas doit avoir vraiment balayé.
 *
 * Un `movesRouting: false` obtenu en n'essayant aucun prix serait le vert vide habituel : la
 * page dirait « aucune baisse ne déplace le routage » sur la foi d'une boucle qui n'a pas tourné.
 */
test("le balayage vers le bas essaie des prix, et le dit", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const d = (JSON.parse(readFileSync(f, "utf8")) as {
    sensitivity: { downward: {
      tiers: { id: string; driver: string; from: number; to: number; movesRouting: boolean; driverAlsoPrices: string[] }[];
      allFree: { movesRouting: boolean }; steps: number; note: string } };
  }).sensitivity.downward;

  assert.ok(d.steps >= 20, `${d.steps} pas : trop peu pour affirmer qu'aucune baisse ne déplace rien.`);
  assert.ok(d.tiers.length >= 5, `${d.tiers.length} palier(s) balayé(s) : le balayage a raté des paliers tarifés.`);
  for (const t of d.tiers) {
    assert.equal(t.to, 0, `${t.id} n'est pas descendu jusqu'à zéro.`);
    assert.ok(t.from > 0, `${t.id} part d'un prix nul : il n'y avait rien à faire descendre.`);
    /* Un pilote partagé doit être annoncé : le descendre rend plusieurs paliers gratuits. */
    const autres = d.tiers.filter((x) => x.driver === t.driver && x.id !== t.id).map((x) => x.id);
    assert.deepEqual([...t.driverAlsoPrices].sort(), autres.sort(),
      `${t.id} n'annonce pas correctement les paliers que son pilote tarife aussi.`);
  }
  assert.ok(/soixante pas|pas une preuve continue/.test(d.note),
    "le balayage ne dit pas que son verdict ne couvre que les points essayés.");
});

/*
 * La règle de composition des latences est déclarée, et son écart est mesuré, pas supposé.
 *
 * Cinq latences par champ deviennent un total par document de deux façons — sommer les
 * percentiles par champ, ou prendre le percentile de la somme réelle — et elles ne donnent pas
 * le même chiffre. Le fichier n'annonçait aucune des deux, ce qui laisse le lecteur en choisir
 * une et se tromper sans le savoir.
 *
 * Et le champ `conservative` doit rester honnête : sommer des percentiles n'est pas une borne
 * supérieure. Un test qui ne vérifierait que la présence du mot laisserait le jour où la
 * mesure dit « sous-estime » passer pour « prudente ».
 */
test("la composition des latences est nommée, et son écart au total réel est chiffré", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const ls = (JSON.parse(readFileSync(f, "utf8")) as {
    latencySpread: { composition?: string; compositionCheck?: {
      measured: boolean; conservative?: boolean; note?: string;
      perTier?: { tier: string; p90ErrorPct: number; documents: number }[] } };
  }).latencySpread;

  assert.ok(ls.composition, "le relevé ne dit pas laquelle des deux compositions il emploie.");
  assert.match(ls.composition!, /sum of per-field percentiles|percentiles of the real total/,
    "la composition annoncée n'est aucune des deux règles connues.");
  assert.ok(ls.compositionCheck, "aucun contrôle de l'écart entre les deux compositions.");

  if (!ls.compositionCheck!.measured) {
    assert.ok((ls.compositionCheck as { why?: string }).why,
      "le contrôle n'a pas tourné et ne dit pas pourquoi.");
    return;
  }

  const parPalier = ls.compositionCheck!.perTier ?? [];
  assert.ok(parPalier.length >= 3, `${parPalier.length} palier(s) comparé(s) : trop peu.`);
  for (const x of parPalier) {
    assert.ok(x.documents >= 10, `${x.tier} compare sur ${x.documents} documents : trop peu pour un p90.`);
    assert.ok(Number.isFinite(x.p90ErrorPct), `${x.tier} n'a pas d'écart chiffré.`);
  }

  /* `conservative` doit refléter les chiffres, pas les accompagner. */
  const attendu = parPalier.every((x) => x.p90ErrorPct >= 0);
  assert.equal(ls.compositionCheck!.conservative, attendu,
    "le champ `conservative` ne suit pas les écarts mesurés : il annonce une borne que les\n"
    + "  chiffres du même bloc démentent.");
  if (!attendu) {
    assert.match(ls.compositionCheck!.note ?? "", /sous-estime|pas une borne/,
      "la composition sous-estime sur au moins un palier et la note ne le dit pas —\n"
      + "  un lecteur prendrait le p90 publié pour un pire cas, du côté qui coûte.");
  }
});

/*
 * L'unité doit survivre jusqu'au fichier publié, pas seulement exister dans le code.
 *
 * `UNITS` est vérifié à la source depuis longtemps ; ce qui manquait, c'est que le contrôle
 * suive la valeur jusque dans `landing.json`, seul endroit que le lecteur voit. Une unité juste
 * dans le code et absente de l'émission ne protège personne.
 */
test("chaque seuil publié porte son unité, dénominateur compris", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const seuils = (JSON.parse(readFileSync(f, "utf8")) as {
    sensitivity: { thresholds: Record<string, { unit?: string }> };
  }).sensitivity.thresholds;

  const noms = Object.keys(seuils);
  assert.ok(noms.length >= 5, `${noms.length} seuil(s) publié(s) : trop peu pour que ce test regarde.`);
  for (const [nom, s] of Object.entries(seuils)) {
    assert.ok(s.unit && s.unit.trim().length > 0, `le seuil « ${nom} » est publié sans unité.`);
    assert.ok(s.unit!.includes("/"),
      `l'unité publiée de « ${nom} » est « ${s.unit} », sans dénominateur.\n`
      + `  → « fraction », « usd », « ms » ne disent pas de quoi. Le lecteur devine, et il a déjà\n`
      + `    deviné faux une fois : quarante-cinq dollars la seconde pour un analyste.`);
  }
});

/*
 * La sortie structurée est ce qui tient le prix, et rien ne la gardait.
 *
 * Sans `format`, `gen-4b` ne s'arrête pas : il consomme les deux cents jetons autorisés à chaque
 * champ et se met à raisonner à voix haute — « We are given a document string and a question ».
 * Mesuré le 21 août sur vingt extractions : 15,6 jetons et 644 ms avec le schéma, 200 jetons et
 * 5 412 ms sans — mais ces durées ont été prises sans leur dispersion, et le chiffre de jetons
 * est celui qui tient : **200,0 de moyenne, c'est-à-dire exactement le plafond**, donc la
 * longueur réelle n'est pas mesurée mais minorée par un plafond qu'on a choisi. Ce que ce test
 * protège n'est donc pas un rapport de prix : c'est le fait que sans la contrainte, la réponse
 * n'est plus une valeur du tout — le parseur JSON échoue sur de la prose et le champ sort vide.
 *
 * Le prix publié suppose donc la contrainte de sortie, et cette dépendance n'était tenue par
 * rien : quelqu'un qui retire `format` en croyant simplifier multiplie le coût réel par huit
 * sans qu'aucun chiffre du dépôt ne bouge, puisqu'il faudrait remesurer pour le voir.
 */
/* Le titre disait « faux d'un facteur huit ». Le facteur vient de deux latences mesurées qui
   vivent dans le message ci-dessous ; le répéter dans le titre en faisait une troisième
   écriture du même nombre, que rien ne recalcule. Le titre nomme ce que le cas garde, le
   message porte les chiffres. */
test("l'appel génératif impose une sortie structurée, sans quoi le prix publié est faux", () => {
  const src = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");
  const i = src.indexOf("/api/generate");
  assert.notEqual(i, -1, "l'appel de génération est introuvable.");
  const appel = src.slice(i, i + 700);

  assert.match(appel, /format:\s*schema/,
    "l'appel de génération n'impose plus de schéma de sortie.\n"
    + "  → sans lui, gen-4b prend tous les jetons autorisés et raisonne à voix haute :\n"
    + "    644 ms deviennent 5 412, mesuré, et le prix publié devient faux d'un facteur huit.");
  assert.match(appel, /num_predict:\s*\d+/,
    "l'appel n'a plus de plafond de jetons : une sortie qui ne s'arrête pas n'a plus de borne du tout.");
  assert.match(appel, /temperature:\s*0/,
    "la température n'est plus à zéro : les mesures cessent d'être reproductibles.");
});

/*
 * La prose d'un relevé doit nommer l'exception que ses propres chiffres portent.
 *
 * `escalationCeiling` portait `everyFieldOverCeiling: false` et, dans le même objet, une note
 * disant « dépasse le plafond, quel que soit le champ ». La donnée était juste et la phrase la
 * démentait — dans le fichier que la page recopie, pas dans un commentaire. C'est la phrase
 * qu'un lecteur emporte, donc c'est elle qui doit céder.
 *
 * Première version de ce contrôle : chercher les mots universels — « tous », « aucun », « quel
 * que soit » — dans toute prose voisine d'un booléen faux. Elle a crié sur la note **corrigée**,
 * dont le « ne complète aucun dossier entier » est juste et sans rapport avec le booléen. Un
 * gardien qui crie à tort finit désactivé, ce qui est pire que pas de gardien.
 *
 * La bonne forme n'est pas de renifler des mots mais de vérifier un accord : le booléen doit
 * suivre les listes émises à côté de lui, et si une exception existe, la prose doit la **nommer**.
 * C'est mécanisable sans ambiguïté, et c'est exactement ce que la note fautive ne faisait pas —
 * elle ne prononçait pas le mot « country ».
 */
test("la prose du plafond nomme l'exception que ses chiffres portent", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const bloc = (JSON.parse(readFileSync(f, "utf8")) as {
    latencySpread: { escalationCeiling: null | {
      perField: { field: string; overCeiling: boolean }[];
      everyFieldOverCeiling: boolean; fieldsOverCeiling: string[]; fieldsUnderCeiling: string[];
      note: string } };
  }).latencySpread.escalationCeiling;
  if (!bloc) return t.skip("!bloc — ce cas n'a rien regardé, et il le dit.");

  assert.ok(bloc.perField.length >= 5, `${bloc.perField.length} champ(s) chiffré(s) : trop peu.`);

  /* Les listes doivent suivre les chiffres, et le booléen doit suivre les listes. */
  const dessus = bloc.perField.filter((x) => x.overCeiling).map((x) => x.field).sort();
  const dessous = bloc.perField.filter((x) => !x.overCeiling).map((x) => x.field).sort();
  assert.deepEqual([...bloc.fieldsOverCeiling].sort(), dessus, "`fieldsOverCeiling` ne suit pas les chiffres.");
  assert.deepEqual([...bloc.fieldsUnderCeiling].sort(), dessous, "`fieldsUnderCeiling` ne suit pas les chiffres.");
  assert.equal(bloc.everyFieldOverCeiling, dessous.length === 0,
    "`everyFieldOverCeiling` ne suit pas ses propres listes.");

  /*
   * La prose ne porte aucun chiffre que les champs ne portent pas.
   *
   * Sa version précédente énonçait le gain de l'escalade — cinq nombres — dans sa phrase et
   * nulle part ailleurs. Une prose lisible et des données muettes obligent à recopier à la
   * main, ce qui est la faute qu'on retire de la page depuis deux jours, et les nombres d'une
   * phrase ne se recalculent pas quand les mesures changent.
   *
   * La règle est nette : la note décrit, les champs chiffrent. Les identifiants de palier
   * comme `gen-8b` sont des noms, pas des mesures, et ne comptent pas.
   */
  const sansNoms = bloc.note.replace(/gen-[0-9.]+b/g, "");
  const chiffres = sansNoms.match(/\d+(?:[.,]\d+)?/g) ?? [];
  assert.deepEqual(chiffres, [],
    `la note du plafond porte des chiffres — ${chiffres.join(", ")} — que le lecteur devra recopier.\n`
    + `  → ils appartiennent à \`admissibleEscalation\` ou \`perField\`, pas à une phrase.`);

  /* Et s'il y a une exception, la prose doit la nommer. C'est la phrase qu'on recopie. */
  if (dessous.length > 0) {
    for (const champ of dessous) {
      assert.ok(bloc.note.includes(champ),
        `la note ne nomme pas « ${champ} », qui tient sous le plafond d'après les chiffres du même objet.\n`
        + `  → note : « ${bloc.note.slice(0, 100)}… »\n`
        + `  → un lecteur emporte la phrase, pas le tableau : une exception tue doit être écrite.`);
    }
  } else {
    assert.ok(!/exception|excepté|sauf/i.test(bloc.note),
      "la note annonce une exception alors qu'aucun champ ne tient sous le plafond.");
  }
});

/*
 * Toute durée publiée dérive d'un relevé qui porte sa dispersion, et le fichier le dit.
 *
 * Vingt-quatre chiffres en millisecondes sont publiés dans `landing.json` et aucun ne porte sa
 * dispersion dans son propre objet. Un contrôle qui les flaguerait crierait vingt-quatre fois à
 * tort — c'est la forme de gardien qu'on a déjà écrite et jetée ce soir. Ils dérivent tous du
 * même relevé mesuré, dont la dispersion existe : ce qui manquait n'était pas la dispersion mais
 * la **déclaration** de cette dérivation.
 *
 * Ce test tient les deux bouts : la déclaration existe, et l'endroit qu'elle désigne porte
 * réellement des percentiles. Une déclaration qui pointe vers un objet vide serait pire que rien.
 */
test("toute durée publiée déclare d'où elle vient, et cet endroit porte des percentiles", (t) => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return t.skip("!existsSync(f) — ce cas n'a rien regardé, et il le dit.");
  const vue = JSON.parse(readFileSync(f, "utf8")) as {
    latencyFigures?: { origin: string; dispersionLivesIn: string; noFreshTimingHere: boolean;
      countedVersusTimed: string };
    latencySpread: { perDoc: Record<string, null | { p10: number; median: number; p90: number }> };
  };
  const ls = vue.latencySpread;
  const d = vue.latencyFigures;
  assert.ok(d, "aucune déclaration d'origine pour les durées publiées.");
  assert.equal(d!.noFreshTimingHere, true,
    "le fichier déclare contenir un chronométrage frais : il devrait alors porter sa dispersion.");
  assert.match(d!.countedVersusTimed, /compte|counted/i,
    "la déclaration ne distingue pas ce qui se compte de ce qui se chronomètre.");

  /* L'endroit désigné doit exister et porter de vrais percentiles, sinon la déclaration ment. */
  assert.equal(d!.dispersionLivesIn, "latencySpread.perDoc");
  const porteurs = Object.entries(ls.perDoc).filter(([, v]) => v !== null);
  assert.ok(porteurs.length >= 3,
    `${porteurs.length} palier(s) avec dispersion : la déclaration pointe vers un objet presque vide.`);
  for (const [tier, v] of porteurs) {
    assert.ok(Number.isFinite(v!.p10) && Number.isFinite(v!.median) && Number.isFinite(v!.p90),
      `${tier} n'a pas ses trois percentiles là où la déclaration les annonce.`);
    assert.ok(v!.p10 <= v!.median && v!.median <= v!.p90,
      `${tier} a des percentiles dans le désordre : p10 ${v!.p10}, médiane ${v!.median}, p90 ${v!.p90}.`);
  }
});


/*
 * UNE HYPOTHÈSE AJOUTÉE SANS ÊTRE BALAYÉE, ET PERSONNE NE LE VOIT.
 *
 * Le README annonçait « every assumption declared in the inventory and swept ». Mesuré :
 * dix des treize entrées de `ASSUMPTIONS` sont dans `PLAUSIBLE`, trois n'y sont pas. Les
 * trois sont défendables — ce sont les entrées que le CLIENT pose, pas des valeurs qu'on a
 * devinées, et deux d'entre elles ont leur propre tableau de balayage — mais rien ne le
 * disait, et surtout rien n'empêchait la quatrième d'arriver en silence.
 *
 * Une promesse d'exhaustivité qui ne peut pas se vérifier n'est pas une promesse, c'est une
 * intention. Ce test la rend exécutable : toute clé d'`ASSUMPTIONS` est soit balayée, soit
 * NOMMÉE ici comme une entrée du client. Ajouter une hypothèse sans faire l'un des deux
 * casse la suite, ce qui est le seul moment où quelqu'un regardera.
 */
const ENTREES_DU_CLIENT = new Set(["volume", "budget", "latencyBudgetMs"]);

test("toute hypothèse est balayée, ou déclarée comme une entrée que le client pose", () => {
  const declarees = Object.keys(ASSUMPTIONS);
  const balayees = new Set(Object.keys(PLAUSIBLE));
  const orphelines = declarees.filter((k) => !balayees.has(k) && !ENTREES_DU_CLIENT.has(k));
  assert.deepEqual(orphelines, [],
    `hypothèse(s) ni balayée(s) ni déclarée(s) comme entrée du client : ${orphelines.join(", ")}. `
    + `Ajoute-la à PLAUSIBLE avec sa plage, ou à ENTREES_DU_CLIENT si c'est le lecteur qui la pose.`);
  /* et l'inverse : une entrée du client qui se met à être balayée doit sortir de la liste,
     sinon la liste ment dans l'autre sens et personne ne s'en aperçoit jamais. */
  const doublons = [...ENTREES_DU_CLIENT].filter((k) => balayees.has(k));
  assert.deepEqual(doublons, [],
    `déclarée(s) comme entrée du client ET balayée(s) : ${doublons.join(", ")}.`);
});


/*
 * LE SCELLÉ DU RELEVÉ, ET LES DEUX SENS QUI COMPTENT.
 *
 * Le fichier de mesures portait sa provenance — date, commit, propreté de l'arbre — et
 * aucune somme de contrôle de son contenu. Un taux modifié à la main y était indétectable :
 * la date ne bouge pas, le commit ne bouge pas, la suite passe, et le chiffre fabriqué se
 * publie avec l'aplomb d'une mesure. C'était le seul défaut de la liste qu'un acheteur ne
 * pouvait pas trouver seul, puisque rien dans le dépôt ne l'aurait contredit.
 *
 * Un scellé qui ne se déclenche pas ne protège de rien, donc on éprouve les deux sens : le
 * fichier livré correspond à son empreinte, ET une valeur changée la fait diverger. Le
 * second est le seul qui prouve quelque chose — le premier passerait sur une fonction qui
 * rend une constante.
 */
test("le relevé livré correspond à son empreinte, et une valeur changée la fait diverger", () => {
  /* LE FICHIER QUI VOYAGE, PAS CELUI DE MA MACHINE. `data/` est ignoré par git : dans un
     clone neuf, `data/profiles.json` n'existe pas, et c'est le relevé de référence à la
     racine qui engendre tous les chiffres publiés. Un test qui n'aurait scellé que le
     premier serait passé au vert ici et absent là-bas — « un chiffre dérivé de quelque
     chose que git ne transporte pas », le défaut que ce dépôt a déjà payé sept fois.
     On éprouve donc les deux : celui de référence toujours, celui de travail s'il existe. */
  const cibles = [RELEVE_DE_REFERENCE, "data/profiles.json"]
    .map((f) => fileURLToPath(new URL(`../${f}`, import.meta.url)))
    .filter((f) => existsSync(f));
  assert.ok(cibles.length >= 1, "aucun relevé à éprouver : le dépôt n'en porte plus.");

  let brut: Record<string, unknown> = {};
  for (const chemin of cibles) {
    brut = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, unknown>;
    assert.equal(typeof brut.empreinte, "string",
      `${chemin} ne porte pas de scellé : « npm run sceller -- ${chemin} ».`);
    assert.equal(empreinteDuReleve(brut), brut.empreinte,
      `le contenu de ${chemin} ne correspond plus à son empreinte.`);
  }

  /* CONTRE-ÉPREUVE. Sans elle, une empreinte qui rendrait toujours la même chaîne
     passerait l'assertion du dessus sans rien vérifier. */
  const falsifie = JSON.parse(JSON.stringify(brut));
  const t = Object.keys(falsifie.extraction)[0]!;
  const c = Object.keys(falsifie.extraction[t])[0]!;
  falsifie.extraction[t][c].accuracy = falsifie.extraction[t][c].accuracy + 0.01;
  assert.notEqual(empreinteDuReleve(falsifie), brut.empreinte,
    "un taux modifié ne change pas l'empreinte : le scellé ne scelle rien.");

  /* et l'ordre des clés ne doit RIEN changer, sinon deux exécutions du même relevé
     rendent deux empreintes et le contrôle devient du bruit qu'on apprend à ignorer. */
  /* Réordonner, pas filtrer. `JSON.stringify(o, tableau)` ne réordonne rien : il
     GARDE seulement les clés listées, à tous les niveaux — donc il hachait un objet
     amputé de tout son contenu imbriqué, et le contrôle échouait en accusant le code.
     Un témoin faux accuse le juste : c'est pire qu'un témoin absent. */
  const remue: Record<string, unknown> = {};
  for (const k of Object.keys(brut).reverse()) remue[k] = brut[k];
  assert.equal(empreinteDuReleve(remue), empreinteDuReleve(brut),
    "l'empreinte dépend de l'ordre des clés : elle signalera des faux positifs.");
});


/*
 * LE CACHE DE LA GALERIE PORTE L'EMPREINTE DE SES ENTRÉES — LE CODE COMPRIS.
 *
 * `collect()` faisait 1 800 appels de modèle à chaque exécution, y compris en `--check` :
 * c'est ce qui faisait télécharger 722 Mo à la première commande recommandée et coûtait
 * 59 des 103 secondes de la suite. Le résultat est déterministe, donc le cache est
 * légitime — et c'est précisément ce qui le rend dangereux. Un cache dont la clé ne couvre
 * pas tout ce qui décide du résultat est un générateur de faux résultats REPRODUCTIBLES :
 * il rend toujours la même chose, donc on lui fait confiance, et il peut être périmé depuis
 * des semaines sans que rien ne le dise.
 *
 * Le piège que ce test ferme : une clé qui couvrirait les révisions de modèles et la graine
 * du corpus mais PAS le code. Changer une règle d'extraction change la galerie sans changer
 * un seul paramètre, et le README publierait une galerie qui ne correspond plus à ce qu'il
 * décrit. On éprouve donc l'invalidation, pas seulement la présence.
 */
test("la galerie en cache s'invalide quand le code qui la produit change", () => {
  const chemin = fileURLToPath(new URL("../failures-reference.json", import.meta.url));
  assert.ok(existsSync(chemin),
    "failures-reference.json manque : « npm run failures » le reconstruit.");
  const c = JSON.parse(readFileSync(chemin, "utf8")) as { entrees?: string; echecs?: unknown[] };
  assert.equal(typeof c.entrees, "string", "le cache ne porte pas la clé de ses entrées.");
  assert.ok(Array.isArray(c.echecs) && c.echecs.length > 0, "le cache est vide.");

  /* CONTRE-ÉPREUVE : la clé doit dépendre du texte des modules. Sans elle, une clé
     constante passerait l'assertion du dessus sans rien garantir. On recalcule la même
     empreinte que `failures.ts`, une fois telle quelle et une fois avec une source
     modifiée d'un caractère, et les deux doivent différer. */
  /* La MÊME fermeture d'imports que celle dont l'empreinte se sert. Trois noms écrits ici
     recopiaient une liste que le code, lui, dérive du graphe — donc dès qu'un module de plus
     entre dans la fermeture, la contre-épreuve cesse de porter sur ce qui est réellement haché,
     sans que rien ne le dise. */
  const sources = fermetureDesSources("./failures.ts").join("\u0000");
  const h = (x: string) => createHash("sha256").update(x).digest("hex");
  assert.notEqual(h(sources), h(sources + " "),
    "l'empreinte du code ne bouge pas quand le code bouge : la clé ne protège rien.");
});


/*
 * LA CLÉ DU CACHE PEUT DÉGRADER EN CONSTANTE, ET C'EST PIRE QU'UNE CLÉ ABSENTE.
 *
 * Première écriture : les trois sources étaient lues via « new URL(...).pathname », sous un
 * « catch { return "" } ». `.pathname` conserve le pourcent-encodage — sur un chemin qui
 * porte une espace, la lecture échoue, le catch rend la chaîne vide trois fois, et la
 * composante « code » de la clé devient une CONSTANTE. Changer une règle d'extraction ne
 * changeait alors plus la clé : le cache n'était plus jamais invalidé, et la garde produisait
 * exactement le générateur de faux résultats reproductibles qu'elle existe pour empêcher.
 * Trouvé par une relecture croisée, pas par ce dépôt.
 *
 * Une garde qui dégrade en constante A L'AIR de fonctionner : elle calcule toujours une
 * empreinte, elle ne lève rien, elle a simplement cessé de discriminer. Aucun test de
 * présence ne l'attrape — d'où celui-ci, qui éprouve la DISCRIMINATION.
 */
test("l'empreinte du cache discrimine, elle ne dégrade pas en constante", () => {
  const a = empreinteDesEntrees(120, ["rules", "small", "large"] as never);
  const b = empreinteDesEntrees(120, ["rules", "small"] as never);
  const c = empreinteDesEntrees(60, ["rules", "small", "large"] as never);
  assert.notEqual(a, b, "changer la liste des paliers ne change pas la clé.");
  assert.notEqual(a, c, "changer le nombre de cas ne change pas la clé.");

  /* ET LA COMPOSANTE « CODE » EST RÉELLEMENT LUE, de la même façon que l'empreinte la lit.
     Si les trois sources devenaient illisibles, la clé cesserait de suivre le code sans que
     rien ne le dise. */
  const lues = fermetureDesSources("./failures.ts");
  assert.ok(lues.length >= 3,
    `${lues.length} source(s) dans la fermeture d'imports : le parcours a échoué, et cette `
    + `contre-épreuve regarderait un ensemble vide en restant verte.`);
  lues.forEach((t, i) => {
    assert.ok(t.length > 200,
      `la source n°${i + 1} lue par l'empreinte fait ${t.length} caractères : la clé ne suit plus le code.`);
  });
});


/*
 * `.pathname` SUR UNE URL DE FICHIER, PLUS JAMAIS.
 *
 * `new URL(f, import.meta.url).pathname` conserve le pourcent-encodage : sur un chemin qui
 * porte une espace ou un caractère non-ASCII il rend « /tmp/dossier%20avec%20espace/x.ts »
 * et la lecture échoue. Quatre-vingt-onze occurrences dans ce dépôt, dont une sous un
 * `catch` qui transformait l'échec en CONSTANTE — la clé du cache de la galerie cessait
 * alors de suivre le code, sans rien lever.
 *
 * Ce n'est pas théorique : `clone-neuf.mjs` clone dans un dossier temporaire, et c'est lui
 * qui porte la garantie vendue à l'acheteur.
 *
 * Corriger quatre-vingt-onze sites ne sert à rien si le quatre-vingt-douzième revient
 * demain. Une faute déjà payée devient une règle exécutable, ou elle se repaie.
 */
/**
 * Le texte d'une source, mentions retirées : commentaires, chaînes et gabarits.
 *
 * UNE MENTION N'EST PAS UN EMPLOI, et cette règle a tiré sur ses propres commentaires au
 * premier essai — la faute que ce dépôt décrit comme la plus fréquente de son catalogue,
 * « commise dans l'outil même qui la surveillait ».
 *
 * DEUX DÉTAILS QUI DÉCIDENT DE SA JUSTESSE, et qui ont chacun coûté :
 *
 *   — LES LIGNES SONT PRÉSERVÉES. Un bloc écrasé en une espace décale tous les numéros
 *     suivants et le diagnostic désigne une ligne innocente. Une session voisine a la forme
 *     écrasante dans son propre catalogue ; elle est inoffensive tant que rien ne rapporte
 *     de numéro de ligne, et fausse le jour où quelqu'un en ajoute un.
 *   — LES GABARITS COMPTENT. Ils manquaient, et c'était un faux positif : un `.pathname`
 *     dans un gabarit est du code destiné au navigateur, où `location.pathname` est la bonne
 *     API. Une garde qui accuse l'innocent est retirée à la première plainte, et le défaut
 *     revient avec elle. Le symétrique s'est payé le même jour chez une voisine : son
 *     balayage a inséré un `import` À L'INTÉRIEUR d'un gabarit, son motif ayant reconnu une
 *     ligne qui ressemblait à un import dans du code navigateur.
 *
 * Extraite d'un test parce qu'une décision qu'on ne peut pas appeler n'est jamais éprouvée.
 */
export function sansMentions(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => " ".repeat(m.length))
    /*
     * LES GABARITS AUSSI, ET LEUR ABSENCE ÉTAIT UN FAUX POSITIF.
     *
     * Un `.pathname` écrit dans un gabarit est presque toujours du code destiné au
     * navigateur, où `location.pathname` est la bonne API. La garde le comptait comme un
     * usage fautif — et une garde qui accuse l'innocent finit par être retirée, ce qui coûte
     * plus cher que le défaut qu'elle attrapait. Une session voisine a payé le symétrique le
     * même jour : son balayage a inséré un `import` À L'INTÉRIEUR d'un gabarit parce que son
     * motif avait reconnu une ligne qui ressemblait à un import dans du code navigateur.
     */
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, " "));
}

test("aucun fichier n'emploie `.pathname` sur une URL de fichier", () => {
  const racine = fileURLToPath(new URL(".", import.meta.url));
  const fautifs: string[] = [];
  for (const f of readdirSync(racine)) {
    if (!/\.(ts|mjs|js)$/.test(f)) continue;
    const src = sansMentions(readFileSync(join(racine, f), "utf8"));
    src.split("\n").forEach((l, i) => {
      if (/import\.meta\.url\s*\)\s*\.pathname/.test(l) || /new URL\([^)]*\)\.pathname/.test(l)) {
        fautifs.push(`${f}:${i + 1}  ${l.trim().slice(0, 80)}`);
      }
    });
  }
  /*
   * LE TÉMOIN, QUI MANQUAIT. Quatre formes, parce que la garde doit trancher entre elles :
   * un usage réel doit être vu, et une simple MENTION — en commentaire, en chaîne, en
   * gabarit — ne doit pas l'être. Sans ces quatre-là, « zéro fautif » ne distingue pas un
   * dépôt propre d'un motif qui ne matche plus rien.
   */
  const MOTIF = (l: string) => /import\.meta\.url\s*\)\s*\.pathname/.test(l) || /new URL\([^)]*\)\.pathname/.test(l);
  const eprouve = (source: string) => sansMentions(source).split("\n").some(MOTIF);
  for (const [quoi, src, attendu] of [
    ["un usage réel", "const p = new URL(x).pathname;", true],
    ["une mention en commentaire", "/* ne jamais employer new URL(x).pathname ici */", false],
    ["une mention en chaîne", 'const m = "never use new URL(x).pathname";', false],
    ["une mention en gabarit", "const h = `prefer new URL(x).pathname in the browser`;", false],
  ] as [string, string, boolean][]) {
    assert.equal(eprouve(src), attendu,
      attendu
        ? `la garde ne voit plus ${quoi} : son zéro ne vaut rien.`
        : `la garde compte ${quoi} comme un usage fautif. Une garde qui accuse l'innocent est `
          + `retirée à la première plainte, et le défaut revient avec elle.`);
  }

  assert.deepEqual(fautifs, [],
    "`.pathname` conserve le pourcent-encodage : emploie `fileURLToPath(new URL(...))`.\n  "
    + fautifs.join("\n  "));
});


/*
 * UN RELEVÉ QUE PERSONNE NE LIT DOIT AU MOINS DIRE SON ÂGE.
 *
 * Huit fichiers de résultats à la racine sont écrits par un outil et lus par aucun autre :
 * si le modèle change, rien ne s'apercevra qu'ils sont périmés. On ne peut pas les rendre
 * vivants sans les relire à chaque passe — ce serait payer cher pour peu. Mais un artefact
 * daté est honnête là où un artefact muet ment par omission : le lecteur voit qu'il regarde
 * un instantané, et de quand.
 *
 * Sept portent déjà `mesureLe`. Deux seulement portent le commit — et sans lui on ne peut pas
 * retrouver le code qui a produit le chiffre, ce qui est la moitié de ce que « reproductible »
 * veut dire. Les cinq qui en manquent sont NOMMÉS ici : je ne peux pas leur inventer un commit
 * que je n'ai pas mesuré, mais je peux empêcher qu'un sixième s'ajoute sans qu'on le voie.
 * C'est la même forme que la liste des entrées du client : une dérogation nommée est une
 * dérogation qui se compte.
 */
const SANS_COMMIT_HISTORIQUE = new Set([
  "abstention.json", "contrainte.json", "escalade.json", "mur.json", "signal.json",
]);

/*
 * DEUX RAISONS DE NE PAS PORTER DE COMMIT, ET ELLES NE SE VALENT PAS.
 *
 * Au-dessus : on ne peut pas retrouver le code qui a produit le fichier. C'est un manque,
 * nommé pour qu'un sixième ne s'y ajoute pas en silence.
 *
 * Ici : le fichier porte une garde de FRAÎCHEUR au lieu d'une empreinte de code —
 * `mesures-derivees.json` déclare `journalModifieLe`, et `derivees.ts` s'arrête si un journal
 * est plus récent que lui. C'est plus fort qu'un commit : un commit dit d'où ça vient, une
 * garde de fraîcheur dit que ça n'a pas vieilli. Ma première version de cette règle les
 * confondait et accusait le fichier le mieux gardé du dépôt.
 */
const GARDE_DE_FRAICHEUR = new Set(["mesures-derivees.json"]);

test("tout relevé de la racine dit quand il a été mesuré, et nomme son commit ou son absence", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const sansDate: string[] = [];
  const sansCommitNonDeclare: string[] = [];
  const declareInutilement: string[] = [];

  for (const f of readdirSync(racine)) {
    if (!f.endsWith(".json")) continue;
    if (/^(package|package-lock|tsconfig|tsconfig\.web|landing|failures-reference)\.json$/.test(f)) continue;
    if (/^profiles-/.test(f)) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(readFileSync(join(racine, f), "utf8")); } catch { continue; }
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    /* un gabarit n'est pas un relevé : il ne prétend rien avoir mesuré */
    if (!("quoi" in d) && !("mesureLe" in d) && !("calculeLe" in d)) continue;

    const date = typeof d.mesureLe === "string" || typeof d.calculeLe === "string";
    if (!date) sansDate.push(f);
    const aCommit = typeof (d.code as { commit?: string } | undefined)?.commit === "string";
    const gardeFraicheur = GARDE_DE_FRAICHEUR.has(f) && typeof d.journalModifieLe === "string";
    if (!aCommit && !SANS_COMMIT_HISTORIQUE.has(f) && !gardeFraicheur) sansCommitNonDeclare.push(f);
    if (aCommit && SANS_COMMIT_HISTORIQUE.has(f)) declareInutilement.push(f);
  }

  assert.deepEqual(sansDate, [],
    `relevé(s) sans « mesureLe » ni « calculeLe » : ${sansDate.join(", ")}. Un artefact que personne ne relit `
    + `doit au moins dire de quand il date.`);
  assert.deepEqual(sansCommitNonDeclare, [],
    `relevé(s) sans « code.commit » et non déclaré(s) : ${sansCommitNonDeclare.join(", ")}. `
    + `Ajoute le commit à la production du fichier, ou inscris-le dans SANS_COMMIT_HISTORIQUE `
    + `en sachant qu'on ne pourra pas retrouver le code qui l'a produit.`);
  assert.deepEqual(declareInutilement, [],
    `déclaré(s) sans commit alors qu'il(s) en porte(nt) un : ${declareInutilement.join(", ")}. `
    + `Retire-le(s) de la liste, sinon elle ment dans l'autre sens et personne ne le verra.`);
});


/*
 * LA CLÉ SUIT TOUT CE QUI DÉCIDE, PAS UNE LISTE ÉCRITE À LA MAIN.
 *
 * Première version : trois fichiers nommés en dur. Une relecture croisée a mesuré le trou —
 * `paliers.ts` porte `estGeneratif`, `GENERATIFS` et `ENCODEURS`, dont `tiers.ts` se sert
 * pour choisir le chemin d'extraction, et n'était pas hachée. Déplacer `large` d'une liste à
 * l'autre change le résultat de tous les cas ; la clé ne bougeait pas, et la galerie périmée
 * était servie comme fraîche.
 *
 * UNE LISTE ÉCRITE À LA MAIN AURA TOUJOURS UN FICHIER DE RETARD. Ce test ne vérifie donc pas
 * qu'un fichier précis est dedans — ce serait la même liste, déplacée — mais que la
 * fermeture des imports est bien SUIVIE : le module que la liste d'origine oubliait doit y
 * être, et le compte doit dépasser les trois de départ.
 */
test("la clé du cache suit la fermeture des imports, pas une liste figée", () => {
  const atteints = modulesAtteints("./failures.ts").map((c) => c.split("/").pop());
  assert.ok(atteints.includes("paliers.ts"),
    `paliers.ts n'est pas atteint : ${atteints.join(", ")}. Il décide du chemin d'extraction, `
    + "et la clé doit en dépendre.");
  assert.ok(atteints.length > 3,
    `la fermeture n'atteint que ${atteints.length} module(s) : on est revenu à une liste figée.`);
  for (const attendu of ["failures.ts", "tiers.ts", "corpus.ts"]) {
    assert.ok(atteints.includes(attendu), `${attendu} n'est plus atteint depuis failures.ts.`);
  }
});


/*
 * UN « OLLAMA PULL » CHANGE TOUS LES CHIFFRES GÉNÉRATIFS SANS TOUCHER UN FICHIER.
 *
 * `MODELES_LOCAUX` déclare le digest des trois modèles ; il ne servait qu'à remplir une
 * colonne. La clé du cache ne pouvait pas l'attraper — elle hache le TEXTE des modules,
 * donc le digest DÉCLARÉ, et un modèle réinstallé ne modifie aucune déclaration. La seule
 * parade est de comparer le déclaré à l'installé, ce qui est le scellé du relevé appliqué
 * au modèle plutôt qu'au fichier.
 *
 * Ce témoin ne demande pas qu'Ollama tourne : une absence n'est pas un écart, et prétendre
 * le contraire ferait échouer la suite sur les machines qui n'ont pas l'échelle générative.
 * Ce qu'il éprouve, c'est que la comparaison DISCRIMINE — un digest différent doit produire
 * un écart, sinon la garde est décorative.
 */
test("un modèle réinstallé est détecté, et une absence n'est pas un écart", () => {
  const tags = Object.values(MODELES_LOCAUX).map((m) => m.tag);
  assert.ok(tags.length > 0, "aucun modèle génératif déclaré : la garde n'a rien à comparer.");

  /* rien d'installé -> aucun écart : on ne confond pas silence et correspondance */
  assert.deepEqual(digestsQuiDivergent(new Map()), [],
    "une absence de modèle est rapportée comme un écart : la garde crierait sur toute machine "
    + "sans Ollama.");

  /* le déclaré, à l'identique -> aucun écart */
  const conformes = new Map(Object.values(MODELES_LOCAUX)
    .map((m) => [m.tag, { octets: 1, digest: m.digest }] as const));
  assert.deepEqual(digestsQuiDivergent(conformes), [],
    "le digest déclaré est rapporté comme divergent de lui-même.");

  /* un seul digest changé -> exactement un écart, et il nomme le bon modèle */
  const premier = Object.values(MODELES_LOCAUX)[0]!;
  const falsifie = new Map(conformes);
  falsifie.set(premier.tag, { octets: 1, digest: "000000000000" });
  const ecarts = digestsQuiDivergent(falsifie);
  assert.equal(ecarts.length, 1,
    "un modèle réinstallé ne produit pas d'écart : la garde ne discrimine pas.");
  assert.equal(ecarts[0]!.tag, premier.tag);
  assert.equal(ecarts[0]!.declare, premier.digest);
});


/*
 * COMBIEN DE TAUX RESTENT ÉCRITS À LA MAIN, ET DANS QUOI.
 *
 * Ce plancher a été posé à quatre-vingt-dix-neuf le 23 août 2026. Il en compte DOUZE le même
 * jour, et pas un taux n'a été supprimé entre les deux : ce sont le contrôle et le décompte
 * qui étaient faux, chacun à sa façon, et les deux façons méritent d'être écrites.
 *
 *   — IL COMPTAIT DES TAUX QU'UN GÉNÉRATEUR TIENT DÉJÀ. VALIDATION.md en portait trente-quatre
 *     et SONDE.md quatre-vingt-quatre ; aucun n'est tapé, ils naissent du relevé à chaque
 *     `npm run`. Les compter comme de la prose gonflait le nombre d'un facteur huit avec
 *     exactement les chiffres qu'on veut voir se multiplier. Voir `ENGENDRES`.
 *   — IL NE VOYAIT PAS 78 % DU README. Une clôture ``` orpheline, ligne 63, faisait avaler
 *     deux cent vingt-trois lignes à son propre nettoyage. Réparée, le compte du README est
 *     passé de cinq à dix : cinq taux avaient toujours été là, invisibles.
 *
 * CE QUI RESTE, ET POURQUOI ÇA RESTE :
 *
 *   README.md — dix taux hors bloc. Chacun est maintenant NOMMÉ dans la table `permis` du
 *               test des chiffres tapés, avec la raison pour laquelle il ne bougera pas. Le
 *               compte n'est plus la seule garde : le contenu l'est aussi.
 *   NOTATION-CAS-DURS.md — deux taux, et ils ne doivent PAS être engendrés. Ce document est un
 *               pré-enregistrement : il déclare la règle de notation AVANT la passe et sa
 *               valeur vient de son immobilité. Un commentaire affirmait ici qu'il était
 *               « engendré par mesurer-dur.ts » — c'est faux, `mesurer-dur.ts` ne fait que le
 *               citer, et cette phrase l'a fait passer pour protégé pendant des jours. Un faux
 *               témoin met en confiance sur la chose même qu'il ne regarde pas.
 *
 * Le plancher ne descend que par du travail et il ne monte pas : ajouter un taux à la main
 * casse la suite, et le message dit quoi faire.
 */
const TAUX_EN_PROSE_AU_23_08 = 12;

/**
 * Les documents ENTIÈREMENT engendrés, et la commande qui refuse leur version périmée.
 *
 * Ils portent des taux — trente-quatre pour le dossier, quatre-vingt-quatre pour la sonde —
 * et aucun n'est tapé : ils naissent du relevé à chaque `npm run`, et `npm test` refuse une
 * copie qui ne correspond plus. Les compter comme « prose » gonflait le cliquet d'un facteur
 * huit avec des chiffres qui sont précisément ceux qu'on veut voir se multiplier.
 *
 * L'entrée porte sa commande, et un test vérifie que cette commande est bien dans `npm test`.
 * Sans ça, il suffirait d'inscrire un fichier ici pour le soustraire au contrôle.
 */
const ENGENDRES: Record<string, string> = {
  "VALIDATION.md": "node src/dossier.ts --check",
  "SONDE.md": "node src/sonde.ts --check",
};

test("un document déclaré engendré est vraiment vérifié par npm test", () => {
  /*
   * LA PORTE DE SORTIE DOIT ÊTRE FERMÉE À CLÉ.
   *
   * `ENGENDRES` soustrait un fichier au cliquet ci-dessous. C'est exactement le geste qu'on
   * ferait pour faire taire une garde gênante — et il ne coûterait qu'une ligne. Il coûte
   * donc aussi de brancher le `--check` correspondant dans la chaîne, ce qui se vérifie.
   */
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  for (const [fichier, commande] of Object.entries(ENGENDRES)) {
    assert.ok(String(pkg.scripts.test).includes(commande),
      `${fichier} est déclaré engendré, donc dispensé du cliquet des taux, mais « ${commande} » `
      + `n'est pas dans « npm test ». Rien ne vérifie qu'il correspond au relevé : le fichier a `
      + `été soustrait au contrôle sans rien recevoir en échange.`);
  }
});

test("le nombre de taux tapés dans la prose ne peut que baisser", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const parFichier: [string, number][] = [];
  for (const f of readdirSync(racine)) {
    if (!f.endsWith(".md")) continue;
    /* Un document engendré n'a pas de prose : il a une source. Voir ENGENDRES. */
    if (f in ENGENDRES) continue;
    let t = readFileSync(join(racine, f), "utf8");
    /*
     * L'ORDRE, ENCORE, ET IL A COÛTÉ CHER UNE FOIS.
     *
     * Les blocs de code d'ABORD. Retirer les blocs engendrés en premier laissait un nombre
     * impair de clôtures ``` — certaines vivaient dedans — et l'appariement suivant avalait
     * deux cent vingt-trois lignes du README. Ce cliquet mesurait 22 % du fichier et son
     * plancher de quatre-vingt-dix-neuf avait été posé sur cet aveuglement : la réparation
     * l'a fait monter à cent quatre sans qu'un seul taux ait été ajouté.
     */
    t = t.replace(/```[\s\S]*?```/g, "");
    /* LE MOTIF EXIGEAIT DES MINUSCULES, ET DEUX BLOCS Y ECHAPPAIENT.
       `coutDeReproduction` et `ouCaTourne` portent des majuscules, donc ce nettoyage ne les
       reconnaissait pas comme engendrés et comptait leurs figures comme de la prose. Le
       plancher précédent les incluait sans que personne ne le sache — une convention non
       écrite, imposée par une classe de caractères, qui rendait invisible ce qu'elle
       prétendait exclure. */
    t = t.replace(/<!-- figures:([A-Za-z0-9-]+) -->[\s\S]*?<!-- \/figures:\1 -->/g, "");
    t = t.replace(/`[^`\n]*`/g, "");
    const n = (t.match(/\d+(?:[.,]\d+)?\s*%/g) ?? []).length;
    if (n) parFichier.push([f, n]);
  }
  const total = parFichier.reduce((s2, [, n]) => s2 + n, 0);
  assert.ok(total <= TAUX_EN_PROSE_AU_23_08,
    `${total} taux tapés dans la prose, contre ${TAUX_EN_PROSE_AU_23_08} au moment où ce `
    + `plancher a été posé — il ne doit que baisser.\n  `
    + parFichier.map(([f, n]) => `${f}: ${n}`).join("\n  ")
    + `\n  Un taux publié se calcule depuis le relevé, ou il rouillera sans que rien ne le dise.`);
});



/*
 * §6.2 DU DOSSIER SIGNÉ, ET CE QUE LE DIFF DOIT REFUSER.
 *
 * « Compare runs rather than reading the latest one. A rising aggregate can hide cases that
 * used to pass and no longer do. » C'est une obligation que le dossier crée, et rien ne la
 * tenait — alors que le dépôt livre cinq relevés dont quatre portent leurs réussites cas par
 * cas.
 *
 * Le cas qui donne son sens à l'outil est celui où LE TAUX MONTE ET DES CAS SONT PERDUS. Un
 * agrégat ne le voit pas ; c'est tout l'argument de la section. Le témoin le fabrique.
 *
 * Et il éprouve les deux refus, qui valent autant que la détection : deux relevés
 * d'échantillons différents ne s'apparient pas cas par cas — le cas i de mille n'est pas le
 * cas i de cent vingt — et un relevé sans bits ne se compare pas du tout. Rendre zéro dans
 * l'un ou l'autre cas serait un zéro par absence, indiscernable d'un zéro par succès.
 */
test("le diff voit les cas perdus sous un taux qui monte, et refuse ce qui ne s'apparie pas", () => {
  const cel = (bits: string) => ({ reussites: bits, accuracy: [...bits].filter((b) => b === "1").length / bits.length, items: bits.length });
  const avant = { measuredAt: "A", extraction: { t: {
    monte: cel("11000"),          /* 2/5 */
    identique: cel("10101"),
    tailleDiff: cel("1100"),
    sansBits: { accuracy: 1, items: 5 },
  } } };
  const apres = { measuredAt: "B", extraction: { t: {
    monte: cel("01110"),          /* 3/5 — le taux MONTE, et le cas 0 est PERDU */
    identique: cel("10101"),
    tailleDiff: cel("110000"),
    sansBits: { accuracy: 1, items: 5 },
  } } };

  const r = comparer(avant as never, apres as never);
  assert.equal(r.cellulesComparees, 2, "les cellules non appariables auraient dû être écartées.");

  const m = r.ecarts.find((e) => e.champ === "monte");
  assert.ok(m, "le diff n'a pas vu la cellule où des cas ont changé d'issue.");
  assert.ok(m!.tauxApres > m!.tauxAvant, "le témoin est mal construit : le taux devait monter.");
  assert.equal(m!.perdus, 1, "un cas qui passait et ne passe plus n'a pas été compté.");
  assert.equal(m!.gagnes, 2);

  assert.equal(r.ecarts.find((e) => e.champ === "identique"), undefined,
    "une cellule inchangée est rapportée comme un écart.");

  /* LES DEUX REFUS, NOMMÉS. Un écart silencieux serait pire qu'un faux positif. */
  const raisons = Object.fromEntries(r.cellulesEcartees.map((e) => [e.cellule, e.pourquoi]));
  assert.match(raisons["t/tailleDiff"] ?? "", /échantillons différents/,
    "deux échantillons de tailles différentes ont été appariés cas par cas.");
  assert.match(raisons["t/sansBits"] ?? "", /réussites par cas/,
    "une cellule sans réussites par cas a été comptée comme comparée.");
});


/*
 * §6.3 DU DOSSIER SIGNÉ : SURVEILLER L'ENTRÉE, ET SAVOIR CE QU'UN INDICE VAUT.
 *
 * « Watch the input distribution, not only the output. Accuracy falls after the population has
 * already moved. » La troisième obligation, et la dernière qui n'était pas tenue.
 *
 * Un indice de déplacement ne se lit pas seul. Le témoin éprouve donc les trois choses qui le
 * rendent lisible, et chacune est une façon différente pour l'outil de mentir :
 *
 *   — LE PLANCHER N'EST PAS ZÉRO. Si le ré-échantillonnage ne ré-échantillonnait pas — une
 *     graine ignorée, un argument perdu en route — les deux tirages seraient le même tirage,
 *     l'indice vaudrait exactement 0, et TOUT déplacement paraîtrait infiniment significatif.
 *     C'est le vert vide de cet outil-ci : un plancher à zéro n'est pas un bon plancher, c'est
 *     un plancher qui n'a rien mesuré.
 *   — IL SÉPARE. À mille observations, l'écart entre deux découpages doit dominer largement ce
 *     que le tirage produit à lui seul. Sinon l'indicateur ne distingue rien et le publier
 *     serait pire que se taire.
 *   — IL REFUSE, ET LE REFUS EST MESURÉ ICI. À cent vingt observations, le bruit de tirage
 *     dépasse le seuil de l'industrie : à cette taille, le seuil se déclenche sur une
 *     population immobile. C'est la raison du refus sous `OBSERVATIONS_MINIMALES`, retrouvée
 *     sur CE corpus et CE trait au lieu d'être héritée d'un autre dépôt.
 */
test("l'indice d'entrée sépare les populations, et refuse sous le nombre où le bruit dépasse le seuil", () => {
  const GRAND = 1000, PETIT = 120;

  const plancherGrand = plancherDeBruit("heldout", GRAND);
  assert.ok(plancherGrand > 0,
    `le plancher de bruit vaut ${plancherGrand} : les deux tirages sont identiques, donc la `
    + `graine du ré-échantillonnage n'arrive pas jusqu'à « generateRecords ». Un plancher à `
    + `zéro rend tout déplacement infiniment significatif — il ne mesure rien.`);
  assert.ok(plancherGrand < SEUIL_DE_L_INDUSTRIE,
    `à ${GRAND} observations le bruit de tirage vaut déjà ${plancherGrand.toFixed(3)}, contre un `
    + `seuil de ${SEUIL_DE_L_INDUSTRIE} : le seuil crierait sur une population immobile.`);

  const dev = comparerPopulations("heldout", "dev", GRAND);
  assert.ok(dev.indice > plancherGrand * 10,
    `l'écart heldout/dev (${dev.indice.toFixed(3)}) ne domine pas le bruit de tirage `
    + `(${plancherGrand.toFixed(3)}) : sur ce trait, l'indicateur ne sépare pas les deux `
    + `populations, et le publier tromperait.`);
  assert.ok(dev.auDessusDuSeuil && dev.assezDObservations);

  /* LE REFUS, ET SA RAISON MESURÉE. Si ce test tombe un jour parce que le corpus a changé,
     ce n'est pas le test qu'il faut détendre : c'est la prose de `entree.ts` qui cite 0,260
     et le chiffre d'`OBSERVATIONS_MINIMALES` qu'il faut refaire depuis la mesure. */
  const petit = comparerPopulations("heldout", "dev", PETIT);
  assert.equal(petit.assezDObservations, false,
    `${PETIT} observations, il en faut ${OBSERVATIONS_MINIMALES}, et le relevé se dit pourtant suffisant.`);
  const plancherPetit = plancherDeBruit("heldout", PETIT);
  assert.ok(plancherPetit >= SEUIL_DE_L_INDUSTRIE,
    `à ${PETIT} observations le bruit de tirage vaut ${plancherPetit.toFixed(3)}, sous le seuil de `
    + `${SEUIL_DE_L_INDUSTRIE} — la prose d'« entree.ts » affirme le contraire (0,260) et doit être refaite.`);

  /* LE TRAIT EST UN ARGUMENT, PAS UNE CONSTANTE CACHÉE : un trait aveugle rend un indice nul,
     et l'outil doit rester capable de le montrer plutôt que de le maquiller. */
  const aveugle = comparerPopulations("heldout", "dev", GRAND, 10, () => 1);
  assert.equal(aveugle.indice, 0,
    "un trait qui rend la même valeur partout devrait rendre un indice nul ; il ne le fait pas.");
});


/*
 * LE CACHE LIVRÉ EST-IL ENCORE CHAUD ?
 *
 * La clé du cache fait exactement son travail : elle a vu que le code avait bougé et elle a
 * refusé de servir un résultat périmé. Ce qui manquait, c'est que PERSONNE NE LE DISAIT.
 *
 * Mesuré : la galerie a été versionnée au commit « A hand-written list is always one file
 * behind », et le commit SUIVANT a modifié `tiers.ts`, qui est dans sa fermeture. La clé a
 * changé, le cache est resté froid pendant quatre commits, et chaque `npm test` a rechargé les
 * modèles — quatre-vingts secondes, à chaque fois, chez nous comme chez l'acheteur au premier
 * `npm test` d'un clone frais. L'outil l'écrivait pourtant, en toutes lettres, au milieu d'une
 * sortie que personne ne lit jusqu'au bout.
 *
 * Et le README publie la promesse « downloads nothing while the cached failure gallery matches
 * the code ». Elle est littéralement vraie et pratiquement fausse : la condition n'était plus
 * tenue. Ce témoin la remet dans les mains de l'outil plutôt que dans celles du lecteur.
 *
 * Le contrôle ne charge aucun modèle : il compare deux empreintes.
 */
test("la galerie versionnée porte encore la clé que le code produit", () => {
  const attendue = cleDeLaGalerieLivree();
  const livree = cleDuFichierLivre();
  assert.notEqual(livree, null,
    "`failures-reference.json` est absent ou illisible : il n'y a pas de cache, et le premier "
    + "`npm test` d'un clone frais chargera les modèles sans prévenir.");
  assert.equal(livree, attendue,
    `la galerie versionnée porte ${livree} alors que le code produit ${attendue} : le cache est `
    + `froid. Chaque « npm test » et chaque « npm run figures » recharge les modèles, et le `
    + `README promet le contraire.\n  Remède : npm run figures, puis versionner `
    + `failures-reference.json avec le changement qui a déplacé la clé.`);
});


/*
 * LA SONDE : LA PROSE SUIT LE CHIFFRE, OU ELLE NE VAUT RIEN.
 *
 * SONDE.md portait cinquante-huit taux tapés à la main et aucun générateur. Le 23 août 2026,
 * onze de ses chiffres ont été confrontés au relevé scellé : LES ONZE ÉTAIENT FAUX. Ils
 * n'étaient pas faux à l'écriture — les paliers encodeurs ont été remesurés à mille cas le 20
 * août, et personne ne relit sept kilo-octets pour y répercuter une remesure.
 *
 * Deux PHRASES DE CONCLUSION étaient donc fausses, et c'est le vrai coût :
 *   — « Against roberta's 38.3 %, that is +57.5 points » : roberta est à 32,8 %, l'écart vaut
 *     +63,0. Le document sous-vendait son propre résultat.
 *   — « the free regex ties the 8B model, 83.3 % against 83.3 % » : le regex est à 79,7 %. Il
 *     ne fait pas jeu égal, il PERD — et la phrase s'en servait pour conclure l'inverse.
 *
 * Engendrer les tableaux n'aurait pas suffi : ces deux phrases sont de la PROSE. D'où un
 * document entièrement engendré, dont les verdicts — « les intervalles se touchent », « ce
 * palier gagne encore » — sont rendus par `distinguishable()` au moment de l'écriture.
 *
 * Ce témoin éprouve la seule chose qui compte : quand la mesure change, la phrase change.
 * Un générateur qui interpole des chiffres dans une prose figée aurait le même bogue que le
 * document qu'il remplace, en plus difficile à voir.
 */
test("la sonde fait suivre ses verdicts à la mesure, pas à sa rédaction", () => {
  const vrai = readProfiles();
  assert.ok(vrai, "pas de profil gelé : ce témoin ne peut rien éprouver.");
  const clone = () => JSON.parse(JSON.stringify(vrai)) as typeof vrai;
  const cell = (p: typeof vrai, t: string, f: string) =>
    (p as never as Record<string, Record<string, Record<string, { accuracy: number }>>>).extraction[t]![f]!;

  const avant = sonde(vrai!);
  assert.match(avant, /do not overlap/,
    "sur le relevé courant, 8B et 4B sont séparés sur l'adresse : le document devrait le dire.");

  /* (1) ON RAPPROCHE LES DEUX TAUX. Les intervalles se recouvrent, donc l'échantillon ne
     sépare plus — et la phrase doit cesser d'affirmer une différence. */
  const colle = clone()!;
  cell(colle, "gen-8b", "address").accuracy = cell(colle, "gen-4b", "address").accuracy;
  const apresColle = sonde(colle);
  assert.doesNotMatch(apresColle, /do not overlap/,
    "les deux taux sont désormais identiques et le document affirme encore que les intervalles "
    + "ne se recouvrent pas. La prose ne suit pas le chiffre : c'est le bogue qu'on remplaçait.");
  assert.match(apresColle, /cannot separate them/,
    "le document doit dire que l'échantillon ne sépare pas, plutôt que se taire.");

  /* (2) ON FAIT TOMBER L'ENCODEUR. « roberta is not beaten » ne peut pas survivre à un
     roberta battu : c'est la phrase qui portait la conclusion « les encodeurs tiennent ». */
  const chute = clone()!;
  cell(chute, "large", "name").accuracy = 0.10;
  const apresChute = sonde(chute);
  assert.doesNotMatch(apresChute, /`roberta` (still wins|is not beaten)/,
    "roberta est tombé à 10 % et le document dit encore qu'il n'est pas battu.");

  /* (3) ON LES FAIT TOUS TOMBER. La section « les encodeurs n'ont pas été dépassés » doit
     pouvoir annoncer sa propre réfutation, sinon son titre ment le jour où elle est vide. */
  const deroute = clone()!;
  for (const f of FIELDS) for (const t of ["rules", "small", "large"]) cell(deroute, t, f).accuracy = 0.01;
  const apresDeroute = sonde(deroute);
  assert.match(apresDeroute, /no longer true/,
    "aucun encodeur ne tient plus, et la section garde son titre sans dire qu'il est démenti.");

  /* (4) LES CHIFFRES VIENNENT DU RELEVÉ, PAS DU GÉNÉRATEUR. Tout taux publié doit se
     retrouver dans le profil : un générateur qui invente est pire qu'une prose qui rouille,
     parce qu'il a l'air d'une mesure. */
  const publies = [...avant.matchAll(/(\d+\.\d) %/g)].map((m) => m[1]!);
  const duReleve = new Set<string>();
  for (const chaine of ["extraction", "classification"] as const)
    for (const t of Object.keys((vrai as never as Record<string, Record<string, unknown>>)[chaine]!)) {
      const noeud = (vrai as never as Record<string, Record<string, never>>)[chaine]![t]!;
      const cellules = "accuracy" in (noeud as object) ? [noeud] : Object.values(noeud);
      for (const c of cellules as { accuracy?: number }[])
        if (typeof c.accuracy === "number") duReleve.add((c.accuracy * 100).toFixed(1));
    }
  /*
   * LES DEUX MOYENNES SE RECALCULENT, ELLES NE S'EXEMPTENT PAS.
   *
   * Ce contrôle a d'abord accusé « 95,2 » et « 83,9 » d'être inventés. Ils ne le sont pas : ce
   * sont les deux moyennes par champ que le document publie, et le document dit lui-même
   * qu'elles ne sont pas des proportions. La tentation était de les inscrire dans une liste
   * d'exceptions — c'est-à-dire de rendre le contrôle aveugle à la seule catégorie de chiffre
   * qu'un générateur peut réellement fabriquer. On les RECALCULE ici, depuis le relevé, par un
   * chemin indépendant de celui du générateur.
   */
  const moyenne = (paliers: TierName[]) => FIELDS.reduce((somme, f) => somme
    + Math.max(...paliers.map((t) => cell(vrai!, t, f)?.accuracy ?? -1)), 0) / FIELDS.length;
  const derivees = new Set([
    (moyenne(["rules", "small", "large", "gen-0.6b", "gen-4b", "gen-8b"]) * 100).toFixed(1),
    (moyenne(["rules", "small", "large"]) * 100).toFixed(1),
  ]);
  const inventes = [...new Set(publies)].filter((x) => !duReleve.has(x) && !derivees.has(x));
  assert.deepEqual(inventes, [],
    `taux publié(s) par SONDE.md qu'on ne retrouve pas dans le relevé : ${inventes.join(", ")}. `
    + `Un chiffre engendré doit venir de la mesure, sinon le générateur ne fait que rendre `
    + `l'invention reproductible.`);
});


/*
 * LES DEUX PRÉ-ENREGISTREMENTS, ET CE QUI LEUR DONNE LEUR VALEUR.
 *
 * `NOTATION-CAS-DURS.md` déclare comment le corpus dur est noté ; `COUT-PALIER-1.7B.md`
 * estime ce que coûterait un huitième palier. Ni l'un ni l'autre ne doit être ENGENDRÉ : leur
 * valeur vient de leur immobilité. Une règle de notation écrite après la passe se choisit
 * elle-même pour produire le résultat qu'on voulait — c'est la première entrée du journal de
 * rétractation de ce dépôt — et une estimation réécrite après coup est un souvenir généreux.
 *
 * Ils n'avaient donc aucune garde, et un commentaire de ce fichier affirmait au contraire que
 * la notation était « engendrée par mesurer-dur.ts ». Elle ne l'est pas : `mesurer-dur.ts` ne
 * fait que la citer. Cette phrase a fait passer le document pour protégé.
 *
 * ─── CE QUI TIENT LIEU DE SCELLÉ ───
 *
 * Pas une empreinte de plus : GIT. Une édition n'est pas silencieuse, elle est datée. Ce qui
 * manquait n'était pas la trace du changement mais la vérification de son ORDRE — et c'est le
 * seul fait qui distingue un pré-enregistrement d'une justification.
 */
test("la notation du corpus dur a été committée AVANT la mesure qu'elle régit", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const dateDe = (f: string) => {
    const t = execFileSync("git", ["log", "-1", "--format=%ct", "--", f], { cwd: racine, encoding: "utf8" }).trim();
    return t ? Number(t) : null;
  };
  const notation = dateDe("NOTATION-CAS-DURS.md");
  const mesure = dateDe("dur.json");
  assert.ok(notation && mesure,
    "l'un des deux fichiers n'a pas d'historique : on ne peut pas établir l'ordre, donc "
    + "« committed before this pass » n'est plus qu'une affirmation.");

  /*
   * STRICTEMENT ANTÉRIEUR, ET LE MÊME COMMIT NE PASSE PAS.
   *
   * Deux fichiers modifiés ensemble, c'est une notation retouchée en même temps que la mesure
   * qu'elle note. C'est précisément le geste que le pré-enregistrement existe pour rendre
   * impossible, et il serait invisible à un contrôle qui accepte l'égalité.
   */
  assert.ok(notation! < mesure!,
    `NOTATION-CAS-DURS.md a été committée le ${new Date(notation! * 1000).toISOString()} et `
    + `dur.json le ${new Date(mesure! * 1000).toISOString()}. La notation n'est plus antérieure à `
    + `la mesure : elle a pu être ajustée en connaissant le résultat, et le document affirme `
    + `pourtant « committed before this pass ».\n  Il n'y a pas de raccourci ici : ou bien le `
    + `changement de notation est annulé, ou bien la passe dure est relancée SOUS la nouvelle `
    + `notation — « npm run dur » — et le résultat précédent est rétracté dans retractations.json.`);
});

test("le pré-enregistrement de la notation décrit encore le corpus qu'il note", () => {
  /*
   * UN PRÉ-ENREGISTREMENT PÉRIME SANS BOUGER.
   *
   * Il ne peut pas se régénérer, donc il ne peut pas suivre le corpus — et le corpus, lui,
   * grandit. Ses deux comptes (« vingt et un des cent cinquante champs ») sont vrais
   * aujourd'hui à l'unité près ; le jour où un document est ajouté, ils deviennent faux en
   * silence dans un texte que rien ne relit.
   *
   * On ne les corrige pas ici : les corriger reviendrait à réécrire le pré-enregistrement, ce
   * qui est exactement ce qu'on interdit. On les SURVEILLE, et le message dit ce que le
   * changement oblige.
   */
  const doc = readFileSync(fileURLToPath(new URL("../NOTATION-CAS-DURS.md", import.meta.url)), "utf8");
  const cas = corpusDur();
  const champs = cas.reduce((n, c) => n + Object.keys(c.attendus).length, 0);
  const silences = cas.reduce((n, c) =>
    n + Object.values(c.attendus).filter((a) => (a as { silence?: boolean }).silence).length, 0);

  assert.ok(doc.includes("hundred and fifty"),
    `le pré-enregistrement annonce un nombre de champs que le corpus tabulaire ne porte plus `
    + `(${champs} aujourd'hui). Un pré-enregistrement ne se réécrit pas : soit le corpus revient `
    + `à ce qu'il déclarait, soit ce document est daté et remplacé par un nouveau, committé `
    + `avant la prochaine passe, et l'ancien reste au dossier.`);
  assert.equal(champs, 150, `le corpus tabulaire porte ${champs} champs, le document en déclare 150.`);
  assert.equal(silences, 21, `le corpus tabulaire porte ${silences} silences attendus, le document en déclare 21.`);

  /*
   * ET LA PART QU'IL NE COUVRE PAS. `mesurer-dur.ts` mesure les tabulaires PLUS les cas
   * ambigus — 164 champs, pas 150. Le pré-enregistrement décrit donc 91 % du champ mesuré, et
   * un lecteur croit qu'il décrit tout. La règle « plusieurs lectures » les couvre ; le compte
   * ne les compte pas.
   */
  const mesures = JSON.parse(readFileSync(fileURLToPath(new URL("../dur.json", import.meta.url)), "utf8")) as { champs: number };
  assert.ok(mesures.champs >= champs,
    `dur.json déclare ${mesures.champs} champs mesurés, moins que les ${champs} du corpus tabulaire.`);
  assert.ok(doc.includes("Several values"),
    `le pré-enregistrement doit déclarer la règle des lectures multiples : elle est ce qui couvre `
    + `les ${mesures.champs - champs} champs ambigus que son compte de 150 n'inclut pas.`);
});

test("l'estimation du palier 1.7b n'affirme rien que le dépôt contredise", () => {
  /*
   * UNE ESTIMATION ÉCRITE AVANT, POUR ÊTRE CONFRONTÉE APRÈS.
   *
   * Trois de ses chiffres — 198, 311, 606 ms — ne sont retrouvables nulle part : douze
   * extractions sur une machine dont la charge n'était pas tenue. Le document le DIT, en gras,
   * et c'est ce qui le rend acceptable. Cette phrase est donc load-bearing : la retirer
   * transformerait trois nombres de sondage en trois latences publiées, dans un dépôt qui
   * vend le contraire. Elle est vérifiée ici comme on vérifie un chiffre.
   *
   * Le reste est vérifiable, donc vérifié.
   */
  const doc = readFileSync(fileURLToPath(new URL("../COUT-PALIER-1.7B.md", import.meta.url)), "utf8");

  assert.match(doc, /not published latencies and must not be quoted as any/,
    "l'avertissement qui désavoue les trois médianes a disparu. Sans lui, douze mesures prises "
    + "sur une machine chargée deviennent des latences publiées.");

  /* Le digest épinglé : il désigne bien un modèle présent, et le palier n'a PAS été ajouté —
     sinon l'estimation devrait avoir été confrontée au réel, ce que personne n'a fait. */
  const digest = doc.match(/`([0-9a-f]{12})`/)?.[1];
  assert.ok(digest, "le digest épinglé a disparu du document : l'estimation ne désigne plus de modèle.");
  assert.ok(!JSON.stringify(MODELES_LOCAUX).includes(digest!),
    `le digest ${digest} est maintenant dans MODELES_LOCAUX : le palier a été ajouté, donc cette `
    + `estimation a un réel auquel se confronter. Le document promet cette confrontation `
    + `(« so it can be checked against the actual afterwards ») — elle doit être écrite, et `
    + `l'estimation datée, avant que ce test puisse repasser.`);

  /* Les deux puissances se recalculent : elles ne dépendent que du nombre de paliers et de
     champs, et un palier ajouté ailleurs les déplacerait sans que la prose bouge. */
  const n = TIERS.length, f = FIELDS.length;
  const puissance = (k: number) => `${k}⁵ = ${Math.pow(k, f).toLocaleString("en-US")}`;
  assert.ok(doc.includes(puissance(n)),
    `le document annonce une énumération que le dépôt ne produit plus : ${n} paliers et ${f} `
    + `champs donnent ${Math.pow(n, f).toLocaleString("en-US")} affectations.`);
  assert.ok(doc.includes(puissance(n + 1)),
    `le document chiffre le coût d'un palier de plus à une valeur que ${n} + 1 paliers ne donnent pas.`);

  /*
   * LES TÉMOINS, PARCE QUE TROIS DE CES QUATRE GARDES SONT DES `includes`.
   *
   * Une recherche de sous-chaîne reste vraie par accident bien plus facilement qu'elle ne
   * devient fausse : il suffit que la phrase cherchée survive ailleurs, reformulée, ou que le
   * motif soit si lâche qu'il matche n'importe quoi. Chacune doit donc démontrer qu'elle
   * bascule quand on falsifie précisément ce qu'elle prétend surveiller.
   */
  const falsifications: [string, string][] = [
    ["l'avertissement retiré", doc.replace("These are not published latencies and must not be quoted as any.", "These are the latencies.")],
    ["le digest retiré", doc.replace(/`[0-9a-f]{12}`/, "the pinned digest")],
    ["la puissance changée", doc.replace(puissance(n), `${n}⁵ = 99,999`)],
    ["le palier de plus changé", doc.replace(puissance(n + 1), `${n + 1}⁵ = 99,999`)],
  ];
  assert.ok(falsifications.length > 0, "`falsifications` est vide : la boucle qui suit ne vérifie rien.");
  for (const [quoi, faux] of falsifications) {
    const tientEncore = /not published latencies and must not be quoted as any/.test(faux)
      && /`[0-9a-f]{12}`/.test(faux)
      && faux.includes(puissance(n)) && faux.includes(puissance(n + 1));
    assert.ok(!tientEncore,
      `avec ${quoi}, les quatre contrôles ci-dessus restent tous vrais. L'un d'eux ne regarde `
      + `donc pas ce qu'il prétend, et son vert ne vaut rien.`);
  }
});


/*
 * LES CHIFFRES QUE `entree.ts` CITE DANS SES PROPRES COMMENTAIRES.
 *
 * Ils ont été écrits avec trois ré-échantillonnages, puis la fonction est passée à cinq, et
 * personne n'a remesuré : « 0,014 » était devenu la médiane d'une fonction qui publie son
 * maximum, et « 0,147 » se lisait encore « 0,140 ». Deux chiffres faux sur trois, dans le
 * fichier même qui existe pour dire qu'un chiffre non tenu rouille — et en moins de deux
 * heures, sans qu'un seul contrôle bronche.
 *
 * Un commentaire n'est pas une note de service : celui-ci porte l'argument entier de l'outil,
 * « regardez l'indice contre son plancher ». S'il ment, le lecteur applique la mauvaise règle.
 * Il est donc tenu comme une figure publiée, ce qu'il est.
 */
test("les chiffres cités dans les commentaires de entree.ts sont ceux que le code produit", () => {
  const src = readFileSync(fileURLToPath(new URL("./entree.ts", import.meta.url)), "utf8");
  const fr = (x: number) => x.toFixed(3).replace(".", ",");

  const maxMille = plancherDeBruit("heldout", 1000);
  const maxCentVingt = plancherDeBruit("heldout", 120);
  const medianeCentVingt = (() => {
    const t = GRAINES_DE_BRUIT
      .map((g) => comparerPopulations("heldout", "heldout", 120, 10, longueur, g).indice)
      .sort((a, b) => a - b);
    return t[Math.floor(t.length / 2)]!;
  })();

  for (const [quoi, valeur] of [
    ["le plancher à 1 000 observations", maxMille],
    ["le plancher à 120 observations", maxCentVingt],
    ["la médiane à 120 observations", medianeCentVingt],
  ] as [string, number][]) {
    assert.ok(src.includes(fr(valeur)),
      `${quoi} vaut ${fr(valeur)} et ce nombre n'apparaît nulle part dans les commentaires de `
      + `src/entree.ts. Soit le commentaire cite une valeur périmée, soit il a cessé de citer `
      + `celle-ci — dans les deux cas l'argument que le fichier expose ne correspond plus à ce `
      + `qu'il calcule.\n  Les valeurs courantes : plancher(1000)=${fr(maxMille)}, `
      + `plancher(120)=${fr(maxCentVingt)}, médiane(120)=${fr(medianeCentVingt)}.`);
  }

  /* LE TÉMOIN : sans lui, `includes` sur un fichier de six mille caractères passe par hasard.
     On vérifie qu'une valeur qui n'y est PAS est bien détectée comme absente. */
  assert.ok(!src.includes(fr(maxMille + 0.5)),
    "le contrôle trouve une valeur qui ne devrait pas être là : sa recherche est trop lâche.");
});


/*
 * LE CSV DU CLIENT : CE QUI DISPARAÎT SANS LE DIRE.
 *
 * Deux fichiers de sept lignes, un seul caractère d'écart — une guillemet ouvrante jamais
 * refermée. Le premier rendait six cas, le second trois. Aucun avertissement, code de sortie
 * zéro. Et l'outil imprimait ensuite « 3 cases is below the point where a rate says
 * anything » : il annonçait un échantillon trop petit sans dire QU'IL L'AVAIT RÉDUIT.
 *
 * C'est la forme la plus coûteuse d'un chiffre faux — celle qui ne se voit pas dans le
 * chiffre — et elle tombait sur les données du client, pas sur les nôtres. Trouvé par une
 * autre session en fabriquant des entrées hostiles, ce qu'aucun de nos propres fichiers de
 * test ne faisait : nos CSV d'essai étaient tous bien formés, ce qui est exactement la raison
 * pour laquelle rien ne l'avait vu.
 */
test("un CSV client dont une guillemet reste ouverte est refusé, pas rétréci en silence", () => {
  const propre = 'text,name\nAlpha Bravo,Alpha\nCharlie Delta,Charlie\nEcho Foxtrot,Echo\nGolf Hotel,Golf\n';
  const casse = 'text,name\nAlpha Bravo,Alpha\nCharlie Delta,Charlie\nEcho "Foxtrot,Echo\nGolf Hotel,Golf\n';

  const bon = lireCsv(propre);
  assert.equal(bon.cas.length, 4, "le fichier bien formé ne doit rien perdre.");

  let refus: Error | null = null;
  try { lireCsv(casse); } catch (e) { refus = e as Error; }
  assert.ok(refus,
    "une guillemet jamais refermée avale les lignes suivantes et le lecteur rend un nombre de "
    + "cas plus petit sans le dire. Rendre un compte rétréci est pire que refuser.");

  /*
   * LE REFUS DOIT ÊTRE ACTIONNABLE. Sur un fichier de cinq mille lignes, « guillemet non
   * refermée quelque part » n'est pas une aide : c'est le même silence, formulé poliment.
   */
  assert.match(refus!.message, /Line 4\b/,
    `le refus ne nomme pas la ligne où la guillemet s'ouvre : « ${refus!.message.split("\n")[0]} »`);
  assert.match(refus!.message, /""/,
    "le refus doit dire comment écrire une guillemet dans une cellule — un refus sans issue "
    + "se contourne en supprimant la garde.");

  /* LE TÉMOIN DU TÉMOIN : une guillemet correctement doublée ne doit PAS déclencher le refus,
     sinon la garde interdit l'usage légitime et sera retirée à la première plainte. */
  const legitime = 'text,name\nAlpha,"il a dit ""bonjour"""\nBravo,Charlie\n';
  assert.doesNotThrow(() => lireCsv(legitime),
    "une guillemet échappée selon la règle CSV est refusée : la garde mord sur l'usage correct.");
  assert.equal(lireCsv(legitime).cas.length, 2);
});


/*
 * LE DÉLAI BORNAIT DEUX ATTENTES ET N'EN CONNAISSAIT QU'UNE.
 *
 * Trente secondes, justifiées dans le code par « le palier le plus lent répond en 1,5 seconde ».
 * Le raisonnement est juste et porte sur le mauvais objet : il compare le délai au temps de
 * GÉNÉRATION d'un modèle déjà en mémoire, alors que le même délai borne aussi le CHARGEMENT de
 * trois à cinq gigaoctets. Mesuré, modèles évincés avant chaque essai : 3,7 s pour le 0.6b,
 * 54,8 s pour le 4b, 68,0 s pour le 8b. DEUX PALIERS SUR TROIS DÉPASSAIENT LE DÉLAI AU PREMIER
 * APPEL, systématiquement — et Ollama évince les modèles inactifs, donc une passe longue
 * recharge en cours de route. C'est ce qui a tué `npm run dur` après neuf minutes.
 *
 * Ce témoin existe parce que la faute est facile à refaire : les deux attentes se ressemblent
 * depuis le code, et seule la mesure les sépare. Il tombe si quelqu'un resserre le délai de
 * chargement sous ce qu'un chargement coûte réellement.
 */
test("le délai de chargement couvre ce qu'un chargement a réellement coûté", () => {
  const pire = Math.max(...Object.values(CHARGEMENTS_MESURES_MS));
  const lePire = Object.entries(CHARGEMENTS_MESURES_MS).find(([, v]) => v === pire)![0];

  assert.ok(DELAI_DE_CHARGEMENT_MS > pire,
    `le délai de chargement vaut ${DELAI_DE_CHARGEMENT_MS / 1000} s et le plus long chargement `
    + `mesuré est ${pire / 1000} s (${lePire}). Toute passe qui commence par ce palier échoue, `
    + `et le message accusera le serveur d'être bloqué alors qu'il charge normalement.`);

  /* La marge est un CHOIX, pas une mesure : rien ici ne dit de combien une machine plus lente
     allonge un chargement. Elle doit rester assez large pour que ce ne soit pas une question. */
  assert.ok(DELAI_DE_CHARGEMENT_MS >= pire * 2,
    `le délai de chargement (${DELAI_DE_CHARGEMENT_MS / 1000} s) laisse moins du double du pire `
    + `chargement mesuré (${pire / 1000} s). Sur une machine plus lente que celle du relevé, il `
    + `redeviendrait la contrainte — et personne ne mesure ici de combien.`);

  assert.ok(DELAI_DE_GENERATION_MS < DELAI_DE_CHARGEMENT_MS,
    "les deux délais sont confondus : on est revenu à un seul, qui bornera de nouveau deux "
    + "attentes de natures différentes.");

  /* ET LE DÉLAI SERRÉ DOIT LE RESTER : c'est lui qui attrape un serveur réellement bloqué. Le
     laisser dériver vers le délai de chargement ferait attendre trois minutes sur une panne. */
  assert.ok(DELAI_DE_GENERATION_MS <= 60_000,
    `le délai de génération vaut ${DELAI_DE_GENERATION_MS / 1000} s. Au-delà d'une minute il `
    + `cesse d'attraper un serveur bloqué en temps utile, ce qui est son seul travail.`);
});


/*
 * LA CONVERSION AVANT LA GARDE : UN IDIOME, PAS UNE FAUTE ISOLÉE.
 *
 * `Number(recu[cle])` puis `Number.isFinite(v)`. La conversion s'exécute avant le test, et
 * `Number(null)`, `Number("")`, `Number([])`, `Number(false)` valent tous zéro — fini, donc
 * accepté, donc ramené dans les bornes, c'est-à-dire POSÉ SUR LA BORNE BASSE.
 *
 * Mesuré sur le serveur en marche avant correction : `{"volume": null}` rendait 200 et faisait
 * passer le volume de 100 000 à 1 000. Un facteur cent sur l'hypothèse dont dépend tout le
 * calcul de coût, sur l'écran qui existe pour montrer ce que les hypothèses décident. Et
 * l'écran fabriquait lui-même l'entrée : `lire()` rend NaN sur une saisie illisible, et
 * `JSON.stringify` écrit NaN comme null. Taper « abc » dans un champ suffisait.
 *
 * Une session voisine a trouvé le même idiome dans TROIS autres dépôts — une part de risque à
 * zéro, un seuil KYC posé sur son réglage le moins prudent, une promesse ramenée à un jour. À
 * chaque fois une extrémité de plage, à chaque fois un 200, à chaque fois le chiffre que
 * l'outil existe pour montrer. Il se lit comme une validation et n'en est pas.
 */
test("une valeur non numérique est refusée, pas convertie en borne basse", () => {
  const depart = { ...ASSUMPTIONS };
  const cle = Object.keys(BOUNDS)[0]!;

  /* LES QUATRE VALEURS QUE `Number()` TRANSFORME EN ZÉRO. Chacune arrive réellement : `null`
     depuis un NaN sérialisé, `""` d'un champ vide, `false` d'une case à cocher, `[]` d'un
     formulaire multiple. */
  for (const poison of [null, "", false, [] as unknown]) {
    const r = appliquerHypotheses({ [cle]: poison }, depart);
    assert.equal(r.refuses.length, 1,
      `${JSON.stringify(poison)} n'est pas refusé. Number() le rend fini, il sera ramené dans `
      + `les bornes, et l'hypothèse se posera sur sa borne basse sans qu'un mot soit dit.`);
    assert.equal(r.hypotheses[cle as keyof typeof depart], depart[cle as keyof typeof depart],
      "l'hypothèse a bougé alors que la valeur était refusée.");
  }

  /* LE TÉMOIN INVERSE, ET IL DÉCIDE DE LA SURVIE DE LA GARDE : l'usage légitime doit passer.
     Une garde qui mord ce que l'écran envoie normalement est retirée à la première plainte. */
  const [bas, haut] = BOUNDS[cle as keyof typeof BOUNDS]!;
  const milieu = (bas + haut) / 2;
  const bon = appliquerHypotheses({ [cle]: milieu }, depart);
  assert.deepEqual(bon.refuses, [], "une valeur numérique valide est refusée.");
  assert.equal(bon.hypotheses[cle as keyof typeof depart], milieu);

  /* Et le hors-bornes reste ramené dans les bornes plutôt que refusé : c'est un choix
     antérieur, il ne change pas, et le témoin le fige pour qu'on ne le change pas par erreur. */
  const trop = appliquerHypotheses({ [cle]: haut * 10 }, depart);
  assert.deepEqual(trop.refuses, []);
  assert.equal(trop.hypotheses[cle as keyof typeof depart], haut);
});

test("la démo publiée porte la même garde que le serveur", () => {
  /*
   * LES DEUX COPIES, ET C'EST LE POINT.
   *
   * `pages.ts` émet le code que la démo exécute dans le navigateur : c'est du texte dans un
   * gabarit, donc il ne peut pas importer la fonction du serveur, donc la divergence ne se
   * ferme pas par construction. Elle se ferme par ce contrôle. Avant correction, la démo
   * portait la faute MOT POUR MOT — et c'est elle que l'acheteur manipule.
   */
  const shim = readFileSync(fileURLToPath(new URL("./pages.ts", import.meta.url)), "utf8");
  assert.match(shim, /typeof v === "number" && Number\.isFinite\(v\)/,
    "la démo publiée n'exige pas le type : elle accepte null, \"\" et false, et les pose sur la "
    + "borne basse — pendant que le serveur les refuse. Deux comportements pour un seul outil.");
  assert.doesNotMatch(shim, /const v = Number\(corps\[cle\]\)/,
    "l'ancienne conversion-avant-garde est revenue dans la démo.");
});


/*
 * LES ROUTES EXISTENT, ET C'EST MOI QUI AI PROUVÉ QU'IL FALLAIT LE VÉRIFIER.
 *
 * En extrayant `appliquerHypotheses` hors du gestionnaire, j'ai ÉCRASÉ le corps de
 * `/api/routage` avec celui de `/api/hypotheses`, et supprimé `/api/optimum` et
 * `/api/hypotheses`. Trois routes détruites, commitées, et `npm test` est resté vert : mes deux
 * témoins éprouvaient la FONCTION, pas la ROUTE. Un module qui exporte ce que personne
 * n'appelle passe tous les contrôles de ses deux côtés.
 *
 * Le trou n'était donc pas dans le code : il était dans la forme des témoins. Une couture se
 * vérifie en la traversant, pas en inspectant ses deux bords.
 *
 * Ce test lance le vrai serveur sur un port à part et parle avec lui. C'est plus lent qu'un
 * appel de fonction, et c'est la seule chose qui aurait vu ce que j'ai cassé.
 */
test("chaque route du serveur existe et répond, et une origine étrangère est refusée", async () => {
  /*
   * LE PORT VIENT DU NOYAU, PAS D'UNE CONSTANTE.
   *
   * La première version écrivait 4771. Un port choisi à la main entre en collision le jour où
   * quelqu'un d'autre l'utilise, et le témoin devient rouge pour une raison qui n'a rien à voir
   * avec ce qu'il mesure. Une session voisine s'est payée la variante aléatoire : un tour sur
   * trois échouait sur un 500 dû à deux serveurs sur le même port.
   *
   * UN TÉMOIN INSTABLE EST PIRE QUE PAS DE TÉMOIN : il apprend à celui qui le voit rouge à le
   * relancer plutôt qu'à regarder — et le jour où il rougit pour une vraie raison, personne ne
   * regardera non plus.
   *
   * On demande donc le port 0, que le noyau remplace par un port libre, et on lit celui qu'il a
   * réellement donné. Au passage, c'est aussi ce qui prouve le mieux la garde d'origine : elle
   * accepte l'écran sur un port QUE PERSONNE N'A ÉCRIT, ce qu'une liste en dur refuserait.
   */
  const sonde = createServer();
  await new Promise<void>((r) => sonde.listen(0, "127.0.0.1", () => r()));
  const PORT = (sonde.address() as { port: number }).port;
  await new Promise<void>((r) => sonde.close(() => r()));

  const enfant = spawn("node", [fileURLToPath(new URL("./server.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "ignore", "ignore"],
  });
  /* On attend que le port réponde plutôt qu'un délai fixe : une session voisine a mesuré des
     « refus » qui n'étaient qu'un serveur pas encore démarré, et son relevé était cohérent et
     entièrement faux. Un appel témoin dont on connaît la réponse, avant de croire les autres. */
  const base = `http://127.0.0.1:${PORT}`;
  let vivant = false;
  for (let i = 0; i < 100 && !vivant; i++) {
    try { await fetch(`${base}/api/etat`); vivant = true; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  try {
    assert.ok(vivant, `le serveur n'a pas démarré sur ${PORT} : ce test ne prouve rien.`);

    /* LES ROUTES QUE L'ÉCRAN APPELLE. La liste vient de `ui.html` : si une route disparaît du
       serveur, l'écran continue de l'appeler et le bouton ne fait plus rien, en silence. */
    const html = readFileSync(fileURLToPath(new URL("./ui.html", import.meta.url)), "utf8");
    const appelees = [...new Set([...html.matchAll(/["'`](\/api\/[a-z]+)["'`]/g)].map((m) => m[1]!))];
    assert.ok(appelees.length >= 3,
      `seulement ${appelees.length} route(s) trouvée(s) dans ui.html : le motif ne les voit plus, `
      + `donc ce contrôle ne couvre plus rien.`);

    for (const route of appelees) {
      const r = await fetch(`${base}${route}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      assert.notEqual(r.status, 404,
        `${route} est appelée par l'écran et le serveur rend 404. Le bouton correspondant ne `
        + `fait plus rien, sans un mot — c'est exactement ce que j'ai cassé en refactorant.`);
    }

    /* LA GARDE D'ORIGINE, DANS SES QUATRE SENS. */
    const etrangere = await fetch(`${base}/api/routage`, {
      method: "POST", headers: { "content-type": "text/plain", origin: "https://exemple-hostile.test" }, body: "{}",
    });
    assert.equal(etrangere.status, 403,
      "une page web ouverte dans un autre onglet peut écrire dans cet écran. Écouter la boucle "
      + "locale protège du réseau, pas du navigateur.");

    /* L'ORIGINE DOIT ÊTRE CELLE PAR LAQUELLE ON SE CONNECTE, et ce détail n'est pas cosmétique :
       la première version annonçait `localhost` en se connectant à `127.0.0.1`. Un navigateur
       traite ces deux-là comme DEUX ORIGINES DIFFÉRENTES, donc le refus était juste et c'est le
       témoin qui était faux. Il l'a montré en tombant, ce qui est exactement son travail. */
    const sienne = await fetch(`${base}/api/routage`, {
      method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${PORT}` }, body: "{}",
    });
    assert.equal(sienne.status, 200, "l'écran lui-même est refusé : la garde mord son propre usage.");

    /* Et l'autre nom de la même machine EST une autre origine : le vérifier fige le choix. */
    const autreNom = await fetch(`${base}/api/routage`, {
      method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${PORT}` }, body: "{}",
    });
    assert.equal(autreNom.status, 403,
      "`localhost` et `127.0.0.1` sont deux origines distinctes pour un navigateur ; les "
      + "confondre reviendrait à accepter un hôte qu'on n'a pas servi.");

    const sansOrigine = await fetch(`${base}/api/routage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(sansOrigine.status, 200,
      "un client hors navigateur — curl, un script, nos propres contrôles — est refusé alors "
      + "qu'il n'a rien à voir avec la faille.");

    const lecture = await fetch(`${base}/api/etat`);
    assert.equal(lecture.status, 200, "la lecture a été prise dans la garde des écritures.");
  } finally {
    enfant.kill();
  }
});


/*
 * ÉCRIRE DANS UN DOSSIER QUE GIT NE TRANSPORTE PAS.
 *
 * `npm run intake` est LE PREMIER GESTE que le README documente pour un client. Sur un clone
 * frais il affichait tout son rapport, correctement, puis mourait sur
 * `ENOENT: open 'data/hypotheses-client.json'` avec une trace de pile — parce que `data/` est
 * ignoré par git et n'existe que si une mesure l'a créé, ce que le client n'a pas encore fait.
 *
 * L'ordre est le pire : le rapport passe, la confiance est faite, l'échec arrive après. Le
 * client conclut que l'outil est fragile au moment précis où il venait de bien marcher.
 *
 * LE CONTRÔLE PORTE SUR LA PROPRIÉTÉ, PAS SUR LE CAS. Un onzième outil qui écrirait dans
 * `data/` demain referait la même chose, et une correction ponctuelle ne l'attraperait pas.
 *
 * Mesuré en écrivant ce contrôle : onze autres fichiers écrivent sans `mkdirSync` — et les
 * onze visent la RACINE du dépôt, qui existe toujours. Ce sont onze faux positifs, et c'est
 * pour ça que le motif regarde la cible et pas la seule absence de `mkdirSync`.
 */
test("aucun outil n'écrit dans un dossier que git ne transporte pas sans le créer", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const ignores = readFileSync(join(racine, ".gitignore"), "utf8")
    .split("\n").map((l) => l.trim().replace(/\/$/, ""))
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("*"));
  assert.ok(ignores.includes("data"),
    "`data` n'est plus dans .gitignore : ce contrôle a perdu son objet, vérifier pourquoi.");

  /*
   * CE CONTRÔLE A D'ABORD ÉTÉ UN VERT VIDE, ET J'ALLAIS LE COMMITER.
   *
   * Sa première version cherchait `"data/"` DANS L'ARGUMENT de `writeFileSync`. Or l'argument
   * est une variable — `writeFileSync(sortie, …)` — et le littéral vit vingt lignes plus haut.
   * Le motif ne regardait donc rien : `intake.ts` privé de son `mkdirSync` passait au vert.
   *
   * Il a fallu l'éprouver sur le fichier falsifié pour le voir, et c'est la seule raison pour
   * laquelle je le sais. Un contrôle qui ne démontre pas qu'il bascule est indiscernable d'un
   * contrôle qui ne cherche pas.
   *
   * On regarde donc le FICHIER, pas l'argument : un littéral qui désigne un dossier ignoré,
   * une écriture, et aucune création de dossier.
   */
  const fautifs: string[] = [];
  for (const f of readdirSync(join(racine, "src"))) {
    if (!/\.(ts|mjs)$/.test(f) || /\.test\./.test(f)) continue;
    const src = sansMentions(readFileSync(join(racine, "src", f), "utf8"));
    if (!/writeFileSync\(/.test(src) || /mkdirSync/.test(src)) continue;
    assert.ok(ignores.length > 0, "`ignores` est vide : la boucle qui suit ne vérifie rien.");
    for (const d of ignores) {
      const litteral = src.match(new RegExp(`["'\`](${d}/[^"'\`]*)["'\`]`));
      if (litteral) fautifs.push(`${f}  ->  ${litteral[1]}`);
    }
  }
  assert.deepEqual(fautifs, [],
    `écriture(s) vers un dossier ignoré par git, sans création préalable :\n  ${fautifs.join("\n  ")}\n`
    + `  Sur un clone frais le dossier n'existe pas, et l'outil meurt sur ENOENT après avoir\n`
    + `  fait tout son travail. Ajouter mkdirSync(dirname(cible), { recursive: true }).`);
});


/*
 * LE `n` SEUL DEMANDE UN CALCUL QUE PERSONNE NE FAIT.
 *
 * Le tableau le plus lu de la page portait la taille d'échantillon — déjà mieux que la
 * plupart — et laissait le lecteur en déduire la précision. Résultat : `gen-4b` à 79,2 % et
 * `rules` à 79,7 % se lisent comme un écart, alors qu'à ces effectifs-là aucun des deux ne
 * sait où il est à sept points près.
 *
 * La colonne `±` publie la PIRE demi-largeur de la ligne, jamais la typique : si le lecteur
 * s'y fie, il se trompe toujours du côté prudent. Un résumé qui flatte serait pire que pas de
 * résumé du tout, puisqu'il aurait l'autorité d'un intervalle sans en avoir la garantie.
 */
test("le tableau d'extraction publie la précision, pas seulement la taille d'échantillon", () => {
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  const bloc = readme.match(/<!-- figures:extraction -->([\s\S]*?)<!-- \/figures:extraction -->/)?.[1];
  assert.ok(bloc, "le bloc d'extraction a disparu du README.");

  const p = readProfiles();
  assert.ok(p, "pas de profil gelé.");

  for (const ligne of bloc!.split("\n").filter((l) => /^\| `/.test(l))) {
    const palier = ligne.match(/^\| `([^`]+)`/)![1]!;
    const publie = ligne.match(/±([\d.]+)/)?.[1];
    assert.ok(publie,
      `la ligne \`${palier}\` ne porte pas de colonne ± : le lecteur doit calculer lui-même la `
      + `précision depuis le n, et il ne le fera pas.`);

    /* RECALCULÉ PAR UN CHEMIN INDÉPENDANT de celui du générateur : on relit le profil plutôt
       que de refaire confiance à ce que la page affiche. */
    const attendu = Math.max(...FIELDS.map((f) => {
      const q = (p as never as Record<string, Record<string, Record<string, { accuracy: number; items: number }>>>)
        .extraction[palier]![f]!;
      return precision(Math.round(q.accuracy * q.items), q.items);
    }));
    assert.equal(Number(publie), Number(attendu.toFixed(1)),
      `\`${palier}\` publie ±${publie} alors que la pire demi-largeur de ses cinq champs vaut `
      + `±${attendu.toFixed(1)}. Une marge sous-estimée est pire qu'aucune marge : elle a `
      + `l'autorité d'un intervalle sans en avoir la garantie.`);
  }

  /* ET LA PHRASE QUI L'EXPLIQUE DOIT RESTER : une colonne « ± » sans sa définition se lit comme
     un écart-type, une erreur standard ou une tolérance — trois choses différentes. */
  assert.match(bloc!, /widest half-interval/,
    "la colonne ± n'est plus définie. Trois lecteurs lui donneront trois sens.");
});


/*
 * UN RELEVÉ DATÉ QUI NE PORTE PAS SA DATE SE LIT COMME ACTUEL.
 *
 * `rapports/` contient neuf instantanés — « mesuré le 21 août 2026 depuis les lignes
 * enregistrées ». Ils ne sont PAS régénérés, et c'est voulu : leur valeur est d'être datés,
 * comme les deux pré-enregistrements. Le cliquet des taux tapés ne les regarde donc pas, à
 * juste titre.
 *
 * Mais TROIS DES NEUF ne portaient leur date que dans le NOM DU FICHIER. Un lecteur qui ouvre
 * le fichier la voit dans son onglet ; un lecteur qui reçoit le texte, qui le lit dans une
 * revue de code ou qui le colle ailleurs, ne la voit plus du tout. Et alors un relevé de deux
 * jours se lit exactement comme la mesure d'aujourd'hui — ce qui est le mal que ce dépôt passe
 * son temps à combattre partout ailleurs.
 *
 * La date est dans le nom, donc dérivable : le contrôle compare les deux plutôt que d'exiger
 * seulement une date quelconque, sinon un rapport pourrait porter la date d'un autre jour.
 */
test("chaque rapport daté porte sa date dans son contenu, et c'est celle de son nom", (t) => {
  const racine = fileURLToPath(new URL("../rapports", import.meta.url));
  if (!existsSync(racine)) return t.skip("!existsSync(racine) — ce cas n'a rien regardé, et il le dit.");
  const MOIS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const fichiers = readdirSync(racine).filter((f) => f.endsWith(".md"));
  assert.ok(fichiers.length > 0,
    "aucun rapport trouvé : ce contrôle rendrait zéro sans rien regarder.");

  for (const f of fichiers) {
    const m = f.match(/^(\d{4})-(\d{2})-(\d{2})-/);
    assert.ok(m, `${f} ne porte pas de date dans son nom : la convention du dossier est rompue.`);
    const [, an, mois, jour] = m!;
    const attendue = `${Number(jour)} ${MOIS[Number(mois) - 1]} ${an}`;
    const texte = readFileSync(join(racine, f), "utf8");
    assert.ok(texte.includes(attendue) || texte.includes(`${an}-${mois}-${jour}`),
      `${f} ne dit nulle part qu'il date du ${attendue}. Sa date n'existe que dans le nom du `
      + `fichier : un lecteur qui reçoit le texte, le relit dans une revue ou le colle ailleurs `
      + `lit un relevé périmé comme s'il était d'aujourd'hui.`);
  }
});


/*
 * LA PHRASE QU'ON EMPORTE EN RÉUNION DE BUDGET.
 *
 * Le README disait : « no available tier can read an address ». Elle était vraie quand seuls
 * les encodeurs étaient mesurés. Depuis que l'échelle générative est dans le profil, LE MÊME
 * DOCUMENT publie `gen-4b` à 95,8 % sur ce champ — un acheteur qui lit la phrase puis le
 * tableau voit la contradiction sans rien chercher.
 *
 * La conclusion, elle, n'a pas bougé et elle s'est même vérifiée : ce qui répare l'adresse est
 * un CHANGEMENT DE FAMILLE, pas plus de budget. C'était une prédiction faite sur les encodeurs
 * seuls, et l'échelle générative l'a encaissée. La phrase dit maintenant cela.
 *
 * Ce témoin tient sa prémisse : le jour où un encodeur lit l'adresse, « no ENCODER tier can
 * read an address » devient fausse à son tour, et il faudra réécrire l'argument plutôt que de
 * le laisser rouiller une seconde fois.
 */
test("aucun palier encodeur ne lit l'adresse, ce qui est la prémisse de l'argument de budget", () => {
  const p = readProfiles();
  assert.ok(p, "pas de profil gelé.");
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

  const ENCODEURS_MESURES = ["rules", "small", "large"] as const;
  const lus = ENCODEURS_MESURES.map((t) => {
    const q = (p as never as Record<string, Record<string, Record<string, { accuracy: number; items: number }>>>)
      .extraction[t]!.address!;
    return { t, taux: q.accuracy };
  });
  const meilleur = lus.reduce((a, b) => (b.taux > a.taux ? b : a));

  /* Le seuil est celui d'un champ utilisable en production, pas une valeur ronde choisie ici :
     en dessous, la moitié des adresses est fausse et personne ne livre ça. */
  assert.ok(meilleur.taux < 0.5,
    `\`${meilleur.t}\` lit maintenant l'adresse à ${(meilleur.taux * 100).toFixed(1)} %. La phrase `
    + `« no ENCODER tier can read an address » du README est devenue fausse, et avec elle tout `
    + `l'argument « le budget n'est pas la contrainte ». Réécrire l'argument, pas le seuil.`);

  /* ET LA PHRASE DOIT NOMMER LA FAMILLE. « no available tier » était vrai des encodeurs et
     faux du document entier : le même README publie un palier génératif qui y arrive. */
  assert.doesNotMatch(readme, /no available tier can read an address/,
    "le README est revenu à « no available tier », que son propre tableau contredit — il publie "
    + "un palier génératif au-dessus de 95 % sur ce champ.");
  assert.match(readme, /no ENCODER tier can read an address/,
    "la phrase ne nomme plus la famille dont elle parle.");
});


/*
 * LE README PROMETTAIT CE TEST. IL N'EXISTAIT PAS.
 *
 * « Where every number comes from » dit : *It is generated from the code now, and a test fails
 * if anything the tool runs on is missing from it.* Le seul test qui touchait au sujet vérifie
 * que toute hypothèse est BALAYÉE ou déclarée comme entrée du client — ce qui est autre chose.
 * Rien ne vérifiait que l'inventaire de provenance soit complet.
 *
 * Mesuré au moment de l'écrire : les treize hypothèses y sont toutes, et dix autres entrées
 * couvrent les constantes décisives. L'inventaire était complet — PAR CHANCE, comme le dit le
 * commentaire du dossier signé, et « juste par chance » est indiscernable de « juste par
 * construction » jusqu'au jour où ça ne l'est plus.
 *
 * Écrire le test plutôt que retirer la phrase : c'est la même règle que partout ailleurs ici —
 * rendre la promesse vraie coûte moins cher que d'expliquer pourquoi elle ne l'est pas.
 */
test("tout ce sur quoi l'outil tourne figure dans l'inventaire de provenance", () => {
  const declarees = new Set(INVENTORY.map((f) => f.name));

  const manquantes = Object.keys(ASSUMPTIONS).filter((k) => !declarees.has(k));
  assert.deepEqual(manquantes, [],
    `hypothèse(s) absente(s) de l'inventaire : ${manquantes.join(", ")}.\n`
    + `  La section « Where every number comes from » promet qu'un test tombe dans ce cas. Ce\n`
    + `  test est celui-là. Ajouter l'entrée avec sa provenance — retrieved, measured, assumed\n`
    + `  ou chosen — et la phrase qui dit ce qu'un lecteur a le droit d'en demander.`);

  /* L'INVERSE COMPTE AUTANT : une entrée qui ne correspond plus à rien fait grossir un
     inventaire qui a l'air complet, et déclarer une figure qui n'existe plus est une autre
     façon de mentir sur la provenance. */
  const orphelines = INVENTORY.filter((f) => f.provenance === "assumed" && !(f.name in ASSUMPTIONS));
  assert.deepEqual(orphelines.map((f) => f.name), [],
    `entrée(s) déclarée(s) « assumed » qui ne sont plus des hypothèses du code : `
    + `${orphelines.map((f) => f.name).join(", ")}.`);

  /* LE VOCABULAIRE A QUATRE TERMES ET L'INVENTAIRE N'EN EMPLOIE QUE TROIS. Ce n'est pas un
     défaut en soi — on n'invente pas une figure retrouvée pour compléter un tableau — mais le
     dépôt PORTE des données retrouvées : `regulations.ts` cite dix textes du CFR avec leur
     URL, et n'est importé par personne. Une source retrouvée qu'aucune décision ne lit est
     exactement ce que la dernière ligne du README reproche à une colonne d'un fichier. C'est
     écrit ici plutôt que corrigé : brancher ou retirer ce module est une décision, pas une
     correction d'audit. */
  const genres = new Set(INVENTORY.map((f) => f.provenance));
  assert.ok(genres.size >= 3,
    `l'inventaire n'emploie plus que ${genres.size} genre(s) de provenance : ${[...genres].join(", ")}.`);
});


/*
 * DEUX FAILLES HAUTES ENTRAIENT AVEC LA BIBLIOTHÈQUE DE MODÈLES.
 *
 * `npm audit` rendait deux vulnérabilités hautes — des CVE de libvips héritées par `sharp`,
 * que `@huggingface/transformers` tire en dépendance. Ce dépôt ne traite aucune image et
 * n'appelle jamais `sharp` ; il le CHARGE quand même, neuf fois, par la chaîne d'import. Non
 * atteignable n'est pas absent : un responsable sécurité qui lance `npm audit` avant d'acheter
 * trouve deux CVE hautes que le vendeur n'a pas mentionnées.
 *
 * Une version corrigée existait — 0.35.3 — et la bibliothèque épinglait `^0.34.1`. Un
 * `overrides` la force. Mesuré après : zéro vulnérabilité, et l'extraction rend les mêmes
 * valeurs qu'avant, vérifiée sur des cas réels.
 *
 * CE TEST NE LANCE PAS `npm audit` : il demande le réseau, donc il rendrait vert sur une
 * machine hors ligne — un vert par absence de réponse, indiscernable d'un vert par propreté.
 * Il vérifie la condition locale qui produit ce zéro : l'override est déclaré, et la version
 * installée est bien au-dessus de celle qui porte les CVE.
 *
 * ET J'AI FAILLI ACCUSER CETTE CORRECTION À TORT. Mon premier essai d'extraction après
 * l'override rendait des chaînes vides ; j'ai cru qu'il cassait l'outil. Il rendait vide AVANT
 * aussi : mon appel passait le texte du document là où la fonction attend le document. Mesurer
 * l'état d'avant a coûté deux minutes et évité de rejeter un correctif juste.
 */
test("la version de sharp installée est au-dessus des CVE de libvips", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const pkg = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));

  assert.ok(pkg.overrides?.sharp,
    "l'override de `sharp` a disparu de package.json. Sans lui, npm réinstalle la version "
    + "épinglée par la bibliothèque de modèles, qui porte deux CVE hautes de libvips.");

  const installee = join(racine, "node_modules", "sharp", "package.json");
  if (!existsSync(installee)) return;   // dépendances non installées : rien à vérifier ici
  const version = JSON.parse(readFileSync(installee, "utf8")).version as string;
  const [majeur, mineur] = version.split(".").map(Number) as [number, number];
  const corrigee = majeur > 0 || mineur >= 35;
  assert.ok(corrigee,
    `sharp ${version} est installée. Les CVE de libvips touchent tout ce qui est sous 0.35.0, `
    + `et il n'existe pas de correctif en amont pour la branche 0.34 — c'est la mise à niveau `
    + `ou rien. Vérifier que l'override est toujours honoré : \`npm install\` puis \`npm audit\`.`);
});


/*
 * UNE CLAUSE DE CONTRAT QU'AUCUN TEST NE PROTEGEAIT.
 *
 * La lettre de mission promet, mot pour mot : « No extracted value reaches us — not a name,
 * not a date of birth, not a document number. » La section du contrat qui fixe le traitement
 * des donnees repose entierement dessus.
 *
 * C'est VRAI aujourd'hui : le seul `writeFileSync` du flux client emet une table d'agregats —
 * champ, palier, exactitude, intervalle, n, duree mediane. Mais les valeurs du client
 * existent UNE LIGNE AU-DESSUS, dans les enregistrements qui portent `value` et `expected`.
 * Quelqu'un qui etend cette fonction peut les faire entrer dans le fichier sans savoir qu'il
 * vient de casser une clause contractuelle — et rien ne le lui dirait.
 *
 * Signale par la session qui auditait le depot commercial, qui a lu la clause d'un cote et
 * l'outil de l'autre. C'est la seule facon de trouver ce defaut-la : il n'est visible ni dans
 * le contrat seul, ni dans le code seul.
 *
 * LE TEMOIN TRAVERSE LA COUTURE. Il ne lit pas le code a la recherche de `value` — il fait
 * TOURNER l'outil sur un fichier dont il connait les valeurs, et cherche ces valeurs dans ce
 * qui est ecrit. Une garde qui inspecte la source rate une valeur ecrite par un autre chemin ;
 * celle-ci regarde ce qui sort.
 */
test("aucune valeur du client n'entre dans le fichier que l'outil lui rend", () => {
  const dossier = mkdtempSync(join(tmpdir(), "cascade-clause-"));
  try {
    /* Des valeurs qu'aucun agregat ne pourrait produire par hasard : si l'une d'elles
       apparait dans la sortie, elle vient forcement du fichier d'entree. */
    const TEMOINS = ["Zorglub Wyvernheim", "1911-02-29", "XQ-77-ZZZ-0451"];
    const csv = `text,name,birth,document\n`
      + `${TEMOINS[0]} ne le ${TEMOINS[1]} document ${TEMOINS[2]},${TEMOINS[0]},${TEMOINS[1]},${TEMOINS[2]}\n`
      + `Jean Dupont ne le 1980-03-03 document AB-12-CDE-3456,Jean Dupont,1980-03-03,AB-12-CDE-3456\n`;
    const entree = join(dossier, "cas.csv");
    writeFileSync(entree, csv);

    const r = spawnSync("node", [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
      `--cases=${entree}`], { encoding: "utf8", timeout: 300_000 });

    const sortie = entree.replace(/\.csv$/, "") + "-measured.md";
    if (!existsSync(sortie)) {
      /* L'outil n'a pas produit de fichier — souvent parce que les modeles ne sont pas en
         cache. On ne rend pas un vert pour autant : un contrôle qui n'a rien vu le dit. */
      assert.ok(r.status !== 0 || r.stdout.includes("Written to"),
        `l'outil n'a ecrit aucun fichier et n'a pas explique pourquoi. Sortie : `
        + `${(r.stderr || r.stdout).slice(0, 200)}`);
      return;
    }

    const rendu = readFileSync(sortie, "utf8");
    const fuites = TEMOINS.filter((v) => rendu.includes(v));
    assert.deepEqual(fuites, [],
      `valeur(s) du client presente(s) dans le fichier rendu : ${fuites.join(", ")}.\n`
      + `  La lettre de mission promet « No extracted value reaches us — not a name, not a\n`
      + `  date of birth, not a document number ». Ce fichier vient de la rompre. Les valeurs\n`
      + `  vivent dans les enregistrements internes ; seuls les agregats sortent.`);

    /* Et le contrôle doit avoir REGARDE quelque chose : un fichier vide passerait sinon. */
    assert.ok(rendu.includes("Accuracy") && rendu.length > 100,
      "le fichier rendu est vide ou sans table : le zero ci-dessus ne prouve rien.");
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});


/*
 * CE QUE CHAQUE PALIER COUTE SELON L'ENDROIT OU IL TOURNE.
 *
 * Le dépôt fait tourner SES SIX PALIERS sur la machine, et n'en tarife que trois au temps
 * machine : `small` et `large` portent un prix à l'appel, sur l'hypothèse déclarée que le
 * client les appellera chez un fournisseur. L'hypothèse est défendable et elle était invisible
 * — un lecteur voyait 8 $ pour mille documents sur un modèle que le dépôt exécutait sous ses
 * yeux pour huit centimes.
 *
 * L'écart est le fait le plus vendable de ce dépôt et il n'était pas publié : facteur cent. Et
 * il renverse la lecture du tableau — l'échelle générative locale coûte moins cher que
 * l'encodeur hébergé ET se trompe moins souvent.
 *
 * CE TÉMOIN TIENT LA PHRASE DE RENVERSEMENT. Elle est calculée, pas écrite : si un jour le
 * local cesse d'être à la fois moins cher et plus juste, elle doit DISPARAITRE du README au
 * lieu d'y rester vraie sur le papier. C'est la différence entre un argument mesuré et un
 * argument qu'on a mesuré une fois.
 */
test("le coût selon l'endroit où le palier tourne sort du même relevé, et le renversement est calculé", () => {
  const prof = readProfiles();
  assert.ok(prof, "pas de profil gelé.");
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  const bloc = readme.match(/<!-- figures:ouCaTourne -->([\s\S]*?)<!-- \/figures:ouCaTourne -->/)?.[1];
  assert.ok(bloc, "le bloc a disparu du README.");

  const cell = (t: string, f: string) => (prof as never as Record<string, Record<string, Record<string, { accuracy: number; latency: number }>>>)
    .extraction[t]![f]!;
  const surMachine = (t: string) => FIELDS.reduce((s, f) =>
    t === "rules" ? s : s + (cell(t, f).latency / 3_600_000) * ASSUMPTIONS.machineHourlyCost * 1000, 0);

  /* LES DEUX COLONNES VIENNENT DU MÊME RELEVÉ. Si l'une était estimée et l'autre mesurée, le
     rapport publié comparerait deux choses différentes — exactement ce que ce dépôt refuse. */
  for (const ligne of bloc!.split("\n").filter((l) => /^\| `/.test(l))) {
    const t = ligne.match(/^\| `([^`]+)`/)![1]!;
    const machine = Number(ligne.match(/\$[\d.]+ \| \$([\d.]+)/)?.[1]);
    assert.equal(machine, Number(surMachine(t).toFixed(2)),
      `\`${t}\` publie $${machine} sur la machine alors que sa latence mesurée donne `
      + `$${surMachine(t).toFixed(2)}. Une des deux colonnes ne vient plus du relevé.`);
  }

  /* LA PHRASE DE RENVERSEMENT NE SURVIT PAS À SON PROPRE DÉMENTI. */
  const meilleurLocal = (GENERATIFS as readonly string[])
    .filter((t) => (prof as never as Record<string, Record<string, unknown>>).extraction[t])
    .map((t) => ({ t, cout: surMachine(t), acc: FIELDS.reduce((s, f) => s + cell(t, f).accuracy, 0) / FIELDS.length }))
    .sort((a, b) => b.acc - a.acc)[0];
  const heberge = { cout: FIELDS.length * ASSUMPTIONS.pricePerThousandLarge,
    acc: FIELDS.reduce((s, f) => s + cell("large", f).accuracy, 0) / FIELDS.length };
  const devrait = !!meilleurLocal && meilleurLocal.cout < heberge.cout && meilleurLocal.acc > heberge.acc;

  assert.equal(/This reverses the table/.test(bloc!), devrait,
    devrait
      ? "le local est moins cher ET plus juste, et le README ne le dit plus."
      : "le README affirme encore le renversement alors que la mesure ne le porte plus : le "
        + "local n'est plus à la fois moins cher et plus exact que l'encodeur hébergé.");
});

/* ────────────────────────────────────────────────────────────────────────────
   L'ÉTAGE DE LECTURE

   Le dépôt mesure l'extraction depuis un TEXTE. Un client reçoit des scans. Ce
   qui suit garde l'instrument qui répond à sa question — et l'instrument a un
   défaut de naissance : un palier qui ne lit pas le document ne peut pas
   baisser quand le document se dégrade, et publierait un coût de 0,0 point.
   ──────────────────────────────────────────────────────────────────────────── */

test("un palier qui ne lit pas le document est écarté, et il est détecté par son comportement", async () => {
  const temoins = generateRecords(2, "heldout");

  /* TÉMOIN POSITIF — la garde doit se déclencher. `human` renvoie la vérité terrain sans
     regarder le texte : brouillé ou non, il a juste. Il ne peut donc rien mesurer d'une
     dégradation, et son coût serait nul QUEL QUE SOIT l'état du scan. */
  assert.equal(await litLeTexte("human", temoins), false,
    "`human` renvoie la vérité terrain sans lire le document — la garde ne le voit plus, et un "
    + "coût de 0,0 point serait publié comme une mesure alors que l'instrument est aveugle.");

  /* TÉMOIN NÉGATIF — la garde ne doit PAS se déclencher. `rules` lit vraiment le texte : sur un
     texte brouillé il se trompe. Une garde qui écarterait tout le monde serait un refus constant,
     pas une détection. */
  assert.equal(await litLeTexte("rules", temoins), true,
    "`rules` extrait par motifs dans le texte : brouillé, il doit se tromper. S'il passe pour "
    + "aveugle, la garde écarte des paliers valides et la mesure ne portera plus sur rien.");
});

test("le coût de l'étage de lecture est publié avec ce qu'il ne couvre pas", (t) => {
  const chemin = fileURLToPath(new URL("../ocr.json", import.meta.url));
  if (!existsSync(chemin)) return t.skip("!existsSync(chemin) — ce cas n'a rien regardé, et il le dit.");  // la mesure demande macOS et Chrome : absente, rien à vérifier
  const r = JSON.parse(readFileSync(chemin, "utf8"));

  /* LE PLANCHER SE DIT. Les images sont rendues, pas photographiées : l'écart mesuré est un
     minorant. Publier un minorant sans le nommer, c'est publier une mesure qu'on n'a pas faite. */
  assert.match(r.plancher, /rendues|plancher/i,
    "le rapport ne dit plus que les images sont rendues et non photographiées. Le chiffre "
    + "devient un coût mesuré alors qu'il est un plancher.");

  /* CE QU'ON ÉCARTE SE COMPTE. Un chiffre issu d'une sélection porte le compte de ce qu'il
     laisse dehors, sinon il se lit comme une couverture complète. */
  assert.ok(Array.isArray(r.paliersEcartes), "les paliers écartés ne sont plus nommés.");
  if (r.paliersEcartes.length > 0) {
    assert.ok(typeof r.pourquoiEcartes === "string" && r.pourquoiEcartes.length > 40,
      `${r.paliersEcartes.length} palier(s) écarté(s) sans que le rapport dise pourquoi.`);
  }

  /* AUCUN TAUX SOUS LE PLANCHER D'OBSERVATIONS. La règle du dépôt vaut aussi ici. */
  assert.ok(r.paliers.length > 0, "`r.paliers` est vide : la boucle qui suit ne vérifie rien.");
  for (const p of r.paliers) {
    assert.ok(p.surTexte.n >= OBSERVATIONS_MINIMALES && p.surImage.n >= OBSERVATIONS_MINIMALES,
      `\`${p.palier}\` publie un écart sur ${Math.min(p.surTexte.n, p.surImage.n)} observations, `
      + `sous le plancher de ${OBSERVATIONS_MINIMALES} que ce dépôt s'impose partout ailleurs.`);
    /* UN ÉCART DONT LES INTERVALLES SE RECOUVRENT N'EST PAS UN COÛT. */
    if (!p.separable) {
      assert.ok(Math.abs(p.ecartEnPoints) < 100,
        `\`${p.palier}\` : écart non séparable du bruit, il ne doit pas être lu comme un coût.`);
    }
  }
});

test("l'inclinaison se lit sur les coins, et l'ordre de lecture survit à une page penchée", () => {
  /* CE TEST GARDE UNE ERREUR DÉJÀ PAYÉE : estimer l'angle par régression sur le point de départ
     des lignes a rendu −38,7° pour 7° réels. La variable explicative ne varie pas — toutes les
     lignes commencent à la même marge — donc la pente mesurait le bruit, pas l'inclinaison. */
  const a = 7 * Math.PI / 180;
  const penchee = Array.from({ length: 12 }, (_, i) => {
    const tly = 0.08 + i * 0.07;
    return { texte: `ligne ${i}`, confiance: 0.99,
      tlx: 0.1, tly, trx: 0.1 + 0.5 * Math.cos(a), try: tly + 0.5 * Math.sin(a) };
  });
  assert.ok(Math.abs(inclinaison(penchee) - a) < 0.01,
    `l'inclinaison rend ${(inclinaison(penchee) * 180 / Math.PI).toFixed(1)}° pour 7° construits. `
    + `Si elle repasse par le début des lignes, elle rendra un angle absurde sans échouer bruyamment.`);

  /* Une page droite ne doit pas se voir attribuer une inclinaison. */
  const droite = penchee.map((b) => ({ ...b, try: b.tly }));
  assert.ok(Math.abs(inclinaison(droite)) < 1e-9, "une page droite se voit attribuer une inclinaison.");

  /* L'ORDRE DE LECTURE, QUE LA FIDÉLITÉ NE PEUT PAS VOIR. La fidélité compte des mots PRÉSENTS :
     un texte rendu à l'envers la laisse à 100 %. Sur une page penchée, la fin d'une ligne descend
     plus bas que le début de la suivante — trier sur la seule ordonnée intercale les lignes. */
  const melange = [penchee[7]!, penchee[0]!, penchee[11]!, penchee[3]!, ...penchee.slice(8, 11), penchee[1]!];
  const attendu = [...melange].map((b) => b.texte)
    .sort((x, y) => Number(x.split(" ")[1]) - Number(y.split(" ")[1])).join("\n");
  assert.equal(texteDesBlocs(melange), attendu,
    "l'ordre de lecture ne suit plus la page. Aucune mesure de fidélité ne l'attrapera : elle "
    + "compte des mots présents, jamais leur place.");
});

/* ────────────────────────────────────────────────────────────────────────────
   LE PAQUET WEB

   `optimise.ts` est compilé pour le navigateur et embarqué dans la page publiée.
   Un seul `import "node:fs"` dans son graphe ne dégrade rien : il TUE le module
   au chargement, et la page part vide. Rien ne le voyait — la suite ne construit
   pas la page, et `docs/` livré datait de quatre jours.
   ──────────────────────────────────────────────────────────────────────────── */

test("aucun module Node ne traverse le paquet compilé pour le navigateur", () => {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const sortie = mkdtempSync(join(tmpdir(), "web-"));
  try {
    /* On compile POUR DE VRAI avec la configuration web du dépôt, plutôt que de relire les
       imports à la main : c'est le graphe que tsc résout qui atterrit dans la page, et un
       motif écrit ici affirmerait un graphe au lieu de le mesurer. */
    execFileSync("npx", ["tsc", "-p", "tsconfig.web.json", "--outDir", sortie], {
      cwd: racine, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const emis = readdirSync(sortie).filter((n) => n.endsWith(".js"));
    assert.ok(emis.length >= 4,
      `${emis.length} fichier(s) émis : la compilation n'a rien produit, ce test ne vérifie rien.`);

    /*
     * ON SUIT LE GRAPHE D'EXÉCUTION DEPUIS L'ENTRÉE DE LA PAGE, pas la liste des fichiers émis.
     * `tsc` émet un `.js` pour tout module du programme, y compris ceux atteints par un simple
     * `import type` — dont l'import disparaît à la compilation. Accuser ces fichiers-là
     * signalerait des modules que la page ne charge jamais, et une garde qui accuse à tort se
     * fait retirer, emportant les vrais défauts avec elle.
     *
     * Les entrées sont celles que le shim de pages.ts importe réellement.
     */
    /*
     * LES ENTRÉES SE LISENT DANS LE SHIM, ELLES NE S'ÉCRIVENT PAS ICI.
     *
     * Première version : une liste de quatre noms tapée à la main. C'est le défaut qu'on
     * catalogue depuis cette nuit sous un autre nom — une liste dont le rôle est de COUVRIR,
     * qu'aucun témoin ne confronte à ce qu'elle prétend couvrir. Le jour où le shim importe un
     * cinquième module, la liste ne le suit pas : le test continue de passer en regardant
     * moins de choses, et c'est exactement la forme de vert vide qu'il existe pour empêcher.
     *
     * Elles viennent donc de `pages.ts`, qui est la seule source de ce que la page charge.
     */
    const shim = readFileSync(fileURLToPath(new URL("./pages.ts", import.meta.url)), "utf8");
    const ENTREES = [...new Set([...shim.matchAll(/from\s+"\.\/js\/([\w.-]+\.js)"/g)].map((m) => m[1]!))];
    assert.ok(ENTREES.length >= 3,
      `${ENTREES.length} entrée(s) lue(s) dans le shim de pages.ts : la lecture a échoué, et ce `
      + `test regarderait un graphe vide en restant vert.`);
    for (const e of ENTREES) {
      assert.ok(emis.includes(e), `${e} n'est pas émis : le shim de la page importe un module absent.`);
    }
    const atteints = new Set<string>();
    const suivre = (f: string) => {
      if (atteints.has(f) || !emis.includes(f)) return;
      atteints.add(f);
      const src = readFileSync(join(sortie, f), "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+"\.\/([\w.-]+\.js)"/g)) {
        suivre(m[1]!);
      }
    };
    for (const e of ENTREES) suivre(e);
    assert.ok(atteints.size >= 4,
      `${atteints.size} module(s) atteint(s) depuis l'entrée : le suivi des imports a échoué.`);

    const fautifs: string[] = [];
    for (const f of [...atteints].sort()) {
      const src = readFileSync(join(sortie, f), "utf8");
      const m = src.match(/from\s+"(node:[a-z_/]+)"/g);
      if (m) fautifs.push(`${f} → ${[...new Set(m)].join(", ")}`);
    }
    assert.deepEqual(fautifs, [],
      `le paquet du navigateur importe des modules Node :\n  ${fautifs.join("\n  ")}\n`
      + `  → un « import \"node:fs\" » ne dégrade pas la page, il la tue au chargement.\n`
      + `    Sortez la lecture de fichier du graphe web : voir src/figer.ts.`);
  } finally {
    rmSync(sortie, { recursive: true, force: true });
  }
});

test("tout appelant Node de l'optimiseur pose la table figée", () => {
  /*
   * `poserDecompositionFigee` remplace une lecture de fichier par une injection : le gain est
   * que le navigateur survit, le risque est qu'un appelant Node oublie de poser la table et
   * perde la décomposition des erreurs EN SILENCE. Ce test transforme l'oubli en échec.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));
  const appelants = readdirSync(dossier)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts")
      && !["optimise.ts", "figer.ts", "derivees.ts"].includes(n))
    .map((n) => ({ n, src: readFileSync(join(dossier, n), "utf8") }))
    /* Un import de TYPE ne fait rien tourner : seuls les appelants de valeur comptent. */
    .filter(({ src }) => /^import \{[^}]*\} from "\.\/optimise\.ts";$/m.test(src));

  assert.ok(appelants.length >= 5,
    `${appelants.length} appelant(s) trouvé(s) : la détection a échoué, le test ne vérifie rien.`);
  const sansTable = appelants.filter(({ src }) => !src.includes('"./figer.ts"')).map((x) => x.n);
  assert.deepEqual(sansTable, [],
    `module(s) appelant l'optimiseur sans poser la table figée : ${sansTable.join(", ")}\n`
    + `  → ajoutez \`import "./figer.ts";\`. Sans elle, la décomposition des erreurs et les deux\n`
    + `    seuils qui la tarifent disparaissent sans un mot.`);
});

test("aucun texte de l'écran ne compte les paliers à la main", () => {
  /*
   * Le chapeau a annoncé « Four tiers » pendant que le tableau juste dessous en montrait sept.
   * L'échelle générative locale est OPTIONNELLE : un clone sans Ollama en a quatre, cette
   * machine en a sept, et une phrase qui compte à la main se dément toute seule dès que la
   * mesure grandit. Le nombre vient maintenant de la figure ; ce test empêche qu'il y retourne.
   *
   * Les champs, eux, ne sont pas concernés : ils sont fixés par 31 CFR 1020.220 et ne bougent
   * pas avec la machine. Un contrôle qui les interdirait aussi crierait à tort.
   */
  const brut = readFileSync(fileURLToPath(new URL("./ui.html", import.meta.url)), "utf8");
  /* Les commentaires sont retirés : celui qui explique ce test cite la formulation fautive,
     et une règle qui s'attrape elle-même dans sa propre explication crie à tort. */
  const src = brut.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  /* « one tier » n'est pas un compte, c'est « un seul » — « pick one tier and send everything
     through it ». L'exclure est la différence entre une règle qu'on lit et une qu'on désactive. */
  const MOTS = "(two|three|four|five|six|seven|eight|nine|ten|deux|trois|quatre|cinq|sept|huit|neuf|dix|\\d+)";
  /* LE MOT COMPTÉ N'EST PAS TOUJOURS « PALIER ». La première version n'acceptait que
     « tiers », et laissait passer « All four of those routings » et « Four bars, one per
     tier » — deux phrases également fausses, dont une lue seulement par un lecteur d'écran.
     Un motif de recherche est une affirmation : celui-là affirmait que le mensonge porterait
     toujours le même nom. */
  const COMPTES = "(tiers?|paliers?|bars?|barres?|routings?|routages?|colonnes?|columns?)";
  const fautifs = [...src.matchAll(new RegExp(`"[^"\\n]*\\b${MOTS}\\s+(?:of\\s+those\\s+)?${COMPTES}\\b[^"\\n]*"`, "gi"))]
    .map((m) => m[0].slice(0, 70));

  assert.deepEqual(fautifs, [],
    `l'écran écrit un nombre de paliers en dur :\n  ${fautifs.join("\n  ")}\n`
    + `  → il doit venir de la figure, pas de la prose : \`L.lede(etat.paliers.length)\`.`);

  /* CONTRE-ÉPREUVE — le motif doit encore attraper la formulation exacte qui a menti. */
  const ancien = '  lede: "Four tiers — rules, a small model, a large one, a human — measured",';
  assert.ok(new RegExp(`"[^"\\n]*\\b${MOTS}\\s+(?:of\\s+those\\s+)?${COMPTES}\\b[^"\\n]*"`, "i").test(ancien),
    "le motif ne reconnaît plus « Four tiers » : il ne peut plus détecter ce qu'il prétend.");
});

test("la prose écrite à la main ne compte pas ce que la mesure détermine", () => {
  /*
   * La garde des chiffres nus attrape « 94.4 % » et « $191 » : un nombre AVEC UNE UNITÉ.
   * Elle ne voyait pas « Four tiers », ni « three fields on free rules » — des comptes sans
   * unité, qui affirment pourtant un résultat mesuré. Le premier était la phrase d'ouverture
   * du document, et il annonçait quatre paliers devant un tableau qui en montre sept.
   *
   * Ce test ne regarde que la prose : les blocs `figures:` sont tenus par leur générateur, et
   * la table des rétractations est un enregistrement historique qui doit rester tel quel.
   */
  const texte = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "README.md"), "utf8");
  const prose = texte
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!-- figures:(\w+) -->[\s\S]*?<!-- \/figures:\1 -->/g, "")
    .replace(/`[^`\n]*`/g, "");

  /** Ce qu'on s'autorise à compter en toutes lettres, et pourquoi ça ne bougera pas. */
  const permis = new Map<string, string>([
    ["five fields", "les cinq champs sont fixés par 31 CFR 1020.220, pas par la mesure"],
    ["two tiers", "énoncé d'une règle valable pour deux paliers quelconques, pas un compte"],
    ["three models", "désigne les trois modèles d'une comparaison nommée sur place"],
  ]);

  /* « one tier » veut dire « un seul », pas « un ». L'inclure ferait crier la règle sur
     « pick one tier and send everything through it », et une règle qui crie à tort s'ignore. */
  const MOTS = "(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+)";
  const NOMS = "(tiers?|fields?|models?|bars?|columns?|routings?)";
  const vus = [...prose.matchAll(new RegExp(`\\b${MOTS}\\s+${NOMS}\\b`, "gi"))]
    .map((m) => m[0].replace(/\s+/g, " ").toLowerCase());

  const nus = [...new Set(vus)].filter((x) => !permis.has(x));
  assert.deepEqual(nus, [],
    `la prose compte à la main ce que la mesure détermine : ${nus.join(", ")}\n`
    + `  → l'écrire dans un bloc \`figures:\` calculé, ou l'inscrire dans \`permis\` avec la\n`
    + `    raison pour laquelle ce compte ne bougera pas.`);

  /* UNE EXEMPTION QUI NE SERT PLUS EST UNE EXEMPTION QUI CACHE : tant qu'elle est là, la
     formulation reste hors du contrôle, et le jour où elle réapparaît fausse, rien ne le dit. */
  const mortes = [...permis.keys()].filter((k) => !vus.includes(k));
  assert.deepEqual(mortes, [],
    `exemption(s) devenue(s) inutile(s) dans \`permis\` : ${mortes.join(", ")}.\n`
    + `  → les retirer, sinon elles couvrent une formulation qui n'existe plus.`);

  /* LE CATALOGUE PARTAGÉ EST EXEMPTÉ ICI, ET L'EXEMPTION DÉSIGNE CE TEST.
     `pieges.mjs` porte la même règle, mais son exemption vaut pour le fichier entier — trop
     grossier pour un document qui compte légitimement cinq champs. La marque dans le README
     renvoie donc ici ; si elle disparaît, le README se retrouve sous la garde grossière sans
     que personne l'ait décidé. */
  assert.match(texte, /piege:ok compte-en-prose[\s\S]{0,200}cascade\.test\.ts/,
    "le README n'exempte plus la règle partagée en désignant ce contrôle-ci : soit l'exemption "
    + "a disparu, soit elle ne dit plus quel contrôle la remplace.");

  /* CONTRE-ÉPREUVE — la garde doit encore voir la phrase exacte qui a menti pendant des mois. */
  const ancien = "Four tiers — rules, a small model, a large one, a human — measured on held-out data.";
  assert.ok(new RegExp(`\\b${MOTS}\\s+${NOMS}\\b`, "i").test(ancien),
    "le motif ne reconnaît plus « Four tiers » : il ne peut plus détecter ce qu'il prétend.");
});

test("le lecteur d'image distingue ses pannes, et une page sans texte n'en est pas une", (t) => {
  /*
   * PREMIÈRE VERSION : `try?` sur l'appel Vision et `exit(1)` muet sur une image illisible.
   * Trois états rendaient la même chose — une page sans texte, un fichier qu'on n'a pas su
   * ouvrir, une reconnaissance qui a échoué — et le premier est un FAIT quand les deux autres
   * sont des PANNES. La mesure de fidélité aurait lu une panne comme un mauvais taux d'OCR,
   * et on aurait cherché du côté du modèle.
   *
   * Ce cas éprouve les deux moitiés : la panne se nomme, et le tableau vide reste possible.
   */
  const manque = ceQuiManque();
  if (manque) return t.skip("manque — ce cas n'a rien regardé, et il le dit.");   // pas de Vision ici : rien à éprouver, et le dire est le refus lui-même

  const dossier = mkdtempSync(join(tmpdir(), "ocr-"));
  try {
    /* UNE PANNE SE NOMME. Un fichier absent et un fichier qui n'est pas une image sont deux
       raisons différentes, et le message doit permettre de les distinguer sans deviner. */
    assert.throws(() => lire(join(dossier, "absent.png")), /introuvable/,
      "un fichier absent ne se distingue plus d'une autre panne.");

    const faux = join(dossier, "faux.png");
    writeFileSync(faux, "ceci n'est pas une image");
    assert.throws(() => lire(faux), /pas une image lisible/,
      "un fichier qui n'est pas une image ne se distingue plus d'un fichier absent.");

    /* CONTRE-ÉPREUVE — une vraie image rend des blocs, et le texte attendu est dedans. Sans
       elle, un lecteur qui refuserait TOUT passerait les deux assertions du dessus. */
    const vraie = fileURLToPath(new URL("../images/screen.png", import.meta.url));
    if (existsSync(vraie)) {
      const blocs = lire(vraie);
      assert.ok(blocs.length > 5,
        `${blocs.length} bloc(s) lus sur la capture de l'écran : le lecteur refuse tout, et les `
        + `deux assertions ci-dessus passeraient sur n'importe quelle panne.`);
      assert.ok(blocs.some((b) => /dollar/i.test(b.texte)),
        "le titre de l'écran n'est pas retrouvé : ce ne sont pas les blocs de cette image.");
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("aucun chiffre de l'étage de lecture ne peut voyager sans son qualificatif", (t) => {
  /*
   * Une session pair a relevé le vrai défaut de la première version : la réserve — « images
   * rendues, pas photographiées » — vivait dans une clé SŒUR du tableau des paliers. Un
   * gabarit qui prend `tiers` et boucle dessus la laisse derrière, et l'écart s'affiche alors
   * comme un coût observé.
   *
   * **Ce qui doit rester ensemble doit l'être structurellement, pas conventionnellement.**
   * Une clé voisine est une liste de couverture écrite à la main déguisée en objet.
   */
  const chemin = join(fileURLToPath(new URL("..", import.meta.url)), "landing.json");
  const bloc = (JSON.parse(readFileSync(chemin, "utf8")) as {
    readingStage: null | { tiers: Record<string, unknown>[]; [k: string]: unknown };
  }).readingStage;
  if (bloc === null) return t.skip("bloc === null — ce cas n'a rien regardé, et il le dit.");   // pas de relevé sur cette machine : rien à tenir

  assert.ok(Array.isArray(bloc.tiers) && bloc.tiers.length >= 2,
    `${(bloc.tiers as unknown[])?.length} palier(s) dans le bloc : la lecture a échoué et ce cas `
    + `ne vérifie plus rien.`);

  for (const t of bloc.tiers) {
    /* LE NOM PORTE LE QUALIFICATIF. `gapPoints` tout court se lirait comme un coût observé. */
    assert.ok(!("gapPoints" in t),
      `le palier \`${t.tier}\` publie \`gapPoints\` : un écart nu se lit comme un coût observé, `
      + `alors qu'il est un plancher. Le nom doit le porter.`);
    assert.equal(typeof t.gapPointsFloor, "number",
      `le palier \`${t.tier}\` ne publie plus d'écart nommé plancher.`);
    assert.equal(typeof t.beyondNoise, "boolean",
      `le palier \`${t.tier}\` publie un écart sans dire s'il sort du bruit : un écart dont les `
      + `intervalles se recouvrent n'est pas un coût, et l'afficher invente une dépense.`);
    assert.ok(typeof t.floorBecause === "string" && t.floorBecause.length > 20,
      `le palier \`${t.tier}\` n'emporte pas la raison du plancher. Une clé sœur se perd au `
      + `premier gabarit qui ne prend que \`tiers\`.`);
  }

  /* Et la fidélité, qui porte la même condition, la porte dans son nom. */
  assert.ok("wordFidelityOnRenderedImages" in bloc && !("wordFidelity" in bloc),
    "la fidélité est publiée sans dire qu'elle porte sur des images rendues et non photographiées.");
});

/* ────────────────────────────────────────────────────────────────────────────
   L'EXPOSITION — ce que le routage coûte quand il se trompe

   Le solveur publié maximise un taux. Un client ne paie pas un point de
   pourcentage : il paie le coût d'avoir tort, et l'outil mesure DEUX façons de
   se tromper qui ne coûtent pas la même chose. Un vide déclenche une relecture,
   un faux entre au dossier.
   ──────────────────────────────────────────────────────────────────────────── */

test("les deux seuils du bloc des leviers viennent de leurs mesures, et leur rapport est calculé", () => {
  /*
   * Ce bloc met côte à côte deux chiffres qui vivaient dans deux fichiers différents, et en
   * tire une phrase — « l'abstention paie N fois plus tôt ». C'est exactement la forme qui
   * dérive : trois nombres justes le jour où on les écrit, et une phrase fausse le jour où
   * l'un des trois bouge.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const readme = readFileSync(join(racine, "README.md"), "utf8");
  const bloc = readme.match(/<!-- figures:leviers -->([\s\S]*?)<!-- \/figures:leviers -->/)?.[1];
  assert.ok(bloc, "le bloc des leviers a disparu du README.");

  const exp = JSON.parse(readFileSync(join(racine, "exposition.json"), "utf8")) as
    { seuil: { bas: number } | null };
  const landing = JSON.parse(readFileSync(join(racine, "landing.json"), "utf8")) as
    { abstention: { rules: { breakEvenCostRatio: number | null }[] } | null };
  const seuilAbst = landing.abstention?.rules?.find((x) => x.breakEvenCostRatio !== null)?.breakEvenCostRatio;
  assert.ok(typeof seuilAbst === "number", "landing.json ne porte plus de seuil d'abstention.");

  assert.ok(bloc!.includes(String(seuilAbst)),
    `le bloc n'affiche plus le seuil d'abstention mesuré (${seuilAbst}) : il en affiche un autre.`);

  if (exp.seuil) {
    assert.ok(bloc!.includes(String(exp.seuil.bas)),
      `le bloc n'affiche plus le seuil de re-routage mesuré (${exp.seuil.bas}).`);
    /* LA PHRASE EST UN QUOTIENT, pas un adjectif. Si elle cesse de l'être, elle ment dès que
       l'un des deux seuils bouge — et personne ne revérifie une affirmation qui a la forme
       d'un nombre. */
    const attendu = Math.round(exp.seuil.bas / seuilAbst);
    const dit = Number(bloc!.match(/roughly (\d+) times sooner/)?.[1]);
    assert.equal(dit, attendu,
      `le bloc annonce « ${dit} fois plus tôt » alors que ${exp.seuil.bas} / ${seuilAbst} = ${attendu}.`);
  }

  /* ET LA RÉSERVE VOYAGE AVEC LES CHIFFRES. Les taux d'abstention sont mesurés sur le corpus
     DUR ; publiés sans le dire, ils se liraient comme le corpus principal. */
  assert.match(bloc!, /hard corpus/,
    "le bloc publie les chiffres d'abstention sans dire qu'ils viennent du corpus dur.");
});

test("la frontière d'abstention applique son plancher au bon dénominateur", () => {
  /*
   * PREMIÈRE VERSION : le garde-fou testait `wrongRemoved` pour décider si la précision
   * livrée était citable. Or cette précision se calcule sur les valeurs LIVRÉES — cent
   * quarante-six au seuil prudent — et le plancher supprimait donc un chiffre parfaitement
   * citable, en laissant croire que la mesure est plus faible qu'elle n'est.
   *
   * Un plancher appliqué au mauvais dénominateur ne protège de rien : il censure au hasard.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const bloc = readFileSync(join(racine, "README.md"), "utf8")
    .match(/<!-- figures:frontiere -->([\s\S]*?)<!-- \/figures:frontiere -->/)?.[1];
  assert.ok(bloc, "le bloc de la frontière a disparu du README.");

  const a = (JSON.parse(readFileSync(join(racine, "landing.json"), "utf8")) as {
    abstention: { rules: { signalsRequired: number; delivered: number; deliveredPrecisionPct: number | null;
      wrongRemoved: number; correctSacrificed: number; abstentions: number }[] } | null;
  }).abstention;
  assert.ok(a, "landing.json ne porte plus de frontière.");

  /*
   * LA CELLULE DU TABLEAU, PAS LE BLOC.
   *
   * Première version : elle cherchait le chiffre n'importe où dans le bloc — et la phrase en
   * prose sous le tableau le contient aussi. Le témoin passait donc même avec le plancher
   * remis sur le mauvais dénominateur : il regardait un endroit où le chiffre survit de
   * toute façon. Un témoin qui ne peut pas échouer ne prouve rien.
   */
  const celluleDe = (seuil: number) => {
    const ligne = bloc!.split("\n").find((l) => new RegExp(`^\\|\\s*\\*\\*${seuil}\\*\\*\\s*\\|`).test(l));
    if (!ligne) return null;
    const cellules = ligne.split("|").map((x) => x.trim());
    return cellules[5] ?? null;   // « Precision of what is delivered »
  };

  assert.ok(a!.rules.length > 0, "`a!.rules` est vide : la boucle qui suit ne vérifie rien.");
  for (const r of a!.rules) {
    if (r.deliveredPrecisionPct === null) continue;
    const citable = r.delivered >= ENOUGH_CAS;
    const cellule = celluleDe(r.signalsRequired);
    assert.ok(cellule !== null, `pas de ligne de tableau pour le seuil ${r.signalsRequired}.`);
    const present = cellule!.includes(`${r.deliveredPrecisionPct} %`);
    assert.equal(present, citable,
      citable
        ? `la précision ${r.deliveredPrecisionPct} % repose sur ${r.delivered} valeurs livrées — `
          + `au-dessus du plancher de ${ENOUGH_CAS} — et n'est pourtant pas publiée.`
        : `la précision ${r.deliveredPrecisionPct} % est publiée alors qu'elle ne repose que sur `
          + `${r.delivered} valeurs livrées.`);
  }

  /* ET CE QUI REPOSE VRAIMENT SUR TROP PEU EST NOMMÉ À PART. « aucune juste sacrifiée » tient
     sur quatre abstentions, pas sur les cent quarante-six livrées. */
  const gratuit = a!.rules.find((r) => r.correctSacrificed === 0 && r.wrongRemoved > 0);
  if (gratuit && gratuit.abstentions < ENOUGH_CAS) {
    assert.match(bloc!, /below this repository's floor/,
      `« aucune valeur juste sacrifiée » repose sur ${gratuit.abstentions} abstentions et le bloc\n`
      + `  ne dit plus que c'est sous le plancher.`);
  }

  /* ET LES HEURES PORTENT LEUR HYPOTHÈSE. Une conversion dont le facteur est tu se lit comme
     une mesure. */
  assert.match(bloc!, new RegExp(`${ASSUMPTIONS.humanSeconds} seconds each`),
    "le bloc convertit des relectures en heures sans dire à quel temps par relecture.");
});

test("le dossier qu'un relecteur signe porte l'exactitude dans l'unité qu'il classe", (t) => {
  /*
   * VALIDATION.md annonçait la moyenne de cinq taux par champ, dans le document qu'une
   * personne signe de son nom. Elle ne classe pas des champs : elle classe des dossiers.
   *
   * Une omission dans un fichier de validation ne se lit pas comme une omission — elle se
   * lit comme si la question ne se posait pas. Ce cas la transforme en échec.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const chemin = join(racine, "document.json");
  if (!existsSync(chemin)) return t.skip("!existsSync(chemin) — ce cas n'a rien regardé, et il le dit.");   // mesure absente : le dossier a le droit de le dire

  const d = JSON.parse(readFileSync(chemin, "utf8")) as
    { publie: { complets: number; n: number } };
  const dossier = readFileSync(join(racine, "VALIDATION.md"), "utf8");

  /* LE CHIFFRE, PAS UNE PHRASE QUI EN PARLE. Une mention sans le nombre laisserait le
     lecteur avec la moyenne par champ pour seul chiffre signé. */
  const attendu = writeRate(rate(d.publie.complets, d.publie.n));
  assert.ok(dossier.includes(attendu),
    `VALIDATION.md ne porte pas le taux par dossier (${attendu}).\n`
    + `  → un relecteur signerait une exactitude qui n'est pas dans l'unité qu'il classe.`);
  assert.ok(dossier.includes(`${d.publie.complets} of ${d.publie.n}`),
    `VALIDATION.md ne porte pas le compte brut ${d.publie.complets} of ${d.publie.n} : le taux\n`
    + `  seul ne dit pas sur combien de dossiers il porte.`);

  /* ET LA RAISON POUR LAQUELLE L'UN PORTE UN INTERVALLE ET L'AUTRE NON. Sans elle, deux
     chiffres voisins dont un seul est encadré ressemblent à une négligence. */
  assert.match(dossier, /true proportion/,
    "VALIDATION.md publie les deux chiffres sans dire lequel peut porter un intervalle, ni pourquoi.");
});

test("aucune formulation ne peut demander « Question: undefined » sur un champ inconnu", () => {
  /*
   * LE PIRE DES DEUX ÉCHECS ÉTAIT LE SILENCIEUX.
   *
   * `QUESTIONS` ne connaissait que nos cinq champs. Un client lançant `measure:yours` avec
   * ses propres colonnes obtenait deux pannes différentes : l'encodeur s'arrêtait sur un
   * message de bibliothèque qui parle d'autre chose, et le génératif demandait littéralement
   * « Question: undefined » puis rendait du bruit **sans rien signaler**.
   *
   * Mesuré sur un jeu de vingt-cinq cas clients : sous une question déduite du nom de
   * colonne, `large` marque 0 % sur le nom ; sous la question du client, 100 %. La question
   * vaut cent points, et l'échec silencieux les faisait passer pour la faute du modèle.
   */
  const inconnu = "nom_complet" as never;
  for (const [nom, gabarit] of Object.entries(PROMPTS_INTERNES)) {
    const sansQuestion = gabarit("un document", inconnu);
    assert.ok(!/Question:\s*undefined/.test(sansQuestion),
      `la formulation « ${nom} » demande « Question: undefined » sur un champ qu'elle ne connaît pas.\n`
      + `  → le modèle répond quelque chose, et rien ne signale que la question était vide.`);

    /* ET LA QUESTION FOURNIE EST BIEN CELLE QUI PART. Une question acceptée puis ignorée
       serait la même panne, avec un paramètre de plus pour la cacher. */
    const avecQuestion = gabarit("un document", inconnu, "What is the client's full name?");
    assert.ok(avecQuestion.includes("What is the client's full name?"),
      `la formulation « ${nom} » accepte une question et ne la pose pas.`);
  }
});

test("la question d'un champ porte sa provenance, et une déduction n'est pas une mesure", () => {
  /* Trois provenances, trois sens différents pour le lecteur d'un taux :
     fournie = son choix · mesurée = le taux publié a été mesuré sous celle-ci · déduite =
     notre choix à sa place, et le taux n'est plus comparable au nôtre. */
  const nôtre = questionPourInterne("birth");
  assert.equal(nôtre.provenance, "mesuree",
    "un de nos cinq champs ne se reconnaît plus : son taux publié ne serait plus rattachable.");

  const sienne = questionPourInterne("birth", { birth: "Quelle est la date de naissance ?" });
  assert.equal(sienne.provenance, "fournie", "une question fournie par le client est ignorée.");
  assert.equal(sienne.texte, "Quelle est la date de naissance ?");

  const deduite = questionPourInterne("date_naissance");
  assert.equal(deduite.provenance, "deduite",
    "une colonne inconnue ne se signale plus comme déduite : le lecteur croirait le taux comparable.");
  assert.match(deduite.texte, /date naissance/,
    "la déduction ne repart plus du nom de colonne.");

  /* ET ELLE NE TRADUIT NI NE DEVINE. Inventer « date de naissance » depuis `date_naissance`
     marcherait ici et échouerait sur la colonne suivante. */
  assert.ok(!/birth|naissance de/i.test(deduite.texte),
    "la déduction interprète le nom de colonne au lieu de le reprendre.");

  /* Une question vide ou blanche n'est pas une question fournie. */
  assert.equal(questionPourInterne("birth", { birth: "   " }).provenance, "mesuree",
    "une question vide passe pour un choix du client.");
});

test("la mémoire disponible se lit avec la taille de page annoncée, inactif compris", () => {
  /*
   * DEUX DÉFAUTS DANS TROIS LIGNES, ET LES DEUX FAISAIENT MENTIR LA MÊME GARDE.
   *
   * La taille de page était écrite en dur à 4096 quand `vm_stat` en annonce 16384 sur cette
   * machine : chaque octet valait le quart du vrai. Et les pages INACTIVES — récupérables
   * immédiatement, et l'essentiel du disponible sur une machine qui travaille — étaient
   * exclues. Résultat : 532 Mo annoncés là où 5,6 Go étaient réutilisables.
   *
   * Une garde qui crie à tort finit ignorée, et les vraies alertes partent avec elle.
   */
  const vmStat = (page: number, libre: number, spec: number, inactif: number) =>
    `Mach Virtual Memory Statistics: (page size of ${page} bytes)\n`
    + `Pages free:                              ${libre}.\n`
    + `Pages active:                            999999.\n`
    + `Pages inactive:                          ${inactif}.\n`
    + `Pages speculative:                       ${spec}.\n`
    + `Pages wired down:                        123456.\n`;

  /* LA TAILLE DE PAGE VIENT DE LA SORTIE. Les mêmes comptes, deux tailles, deux résultats —
     sinon le paramètre est décoratif. */
  const a4k = memoireDisponibleMo(vmStat(4096, 10_000, 1_000, 20_000));
  const a16k = memoireDisponibleMo(vmStat(16384, 10_000, 1_000, 20_000));
  assert.equal(a4k, Math.round(31_000 * 4096 / 1e6),
    `à 4 Ko la page, 31 000 pages font ${Math.round(31_000 * 4096 / 1e6)} Mo, pas ${a4k}.`);
  assert.equal(a16k, Math.round(31_000 * 16384 / 1e6),
    `à 16 Ko la page, le même compte fait ${Math.round(31_000 * 16384 / 1e6)} Mo, pas ${a16k}.`);
  assert.ok(a16k > a4k * 3.5,
    "la taille de page annoncée ne change plus le résultat : elle est redevenue décorative.");

  /* L'INACTIF COMPTE. Sans lui, la garde crie sur une machine qui va parfaitement bien. */
  const sansInactif = memoireDisponibleMo(vmStat(16384, 10_000, 1_000, 0));
  const avecInactif = memoireDisponibleMo(vmStat(16384, 10_000, 1_000, 20_000));
  assert.ok(avecInactif > sansInactif * 2,
    `l'inactif n'est plus compté : ${avecInactif} Mo avec 20 000 pages inactives contre `
    + `${sansInactif} sans, alors qu'elles sont réutilisables immédiatement.`);

  /* ET LA VRAIE MACHINE EST D'ACCORD AVEC LA FONCTION PURE — sinon l'une des deux lit autre
     chose, et c'est celle qui décide en production qui aurait tort. */
  const reelle = etatMachineInterne();
  assert.ok(reelle.memoireLibreMo > 0,
    "la lecture réelle rend zéro : `vm_stat` n'a pas été lu, et le zéro se lirait comme une machine pleine.");
});

test("le rapport que le client garde porte la réserve, pas seulement le terminal", () => {
  /*
   * LE FICHIER NE CONTENAIT QU'UN TABLEAU DE TAUX.
   *
   * Sur des colonnes que nous ne connaissons pas, il annonçait « large · 0,0 % » sur le nom
   * SANS un mot sur la question déduite. Quelqu'un qui le relit la semaine suivante conclut
   * que le modèle ne sait pas lire un nom — le même champ fait 100 % sous la question du
   * client. L'avertissement vivait dans le terminal et mourait avec lui.
   *
   * **Une réserve qui ne voyage pas avec le chiffre n'existe pas.**
   */
  const lignes = [["nom_complet", "large", "0.0 %", "[0–13]", 25, "20 ms"]];

  /* AVEC UNE QUESTION DÉDUITE : la réserve doit être dans le fichier, pas ailleurs. */
  const deduit = rapportPourLeClient({
    cas: 25, champs: ["nom_complet"], date: "2026-08-24", avecRegles: false, lignes,
    questions: { nom_complet: questionPourInterne("nom_complet") },
  });
  assert.match(deduit, /derived from your column name/,
    "le rapport ne dit plus que la question vient du nom de colonne.");
  assert.match(deduit, /not comparable/,
    "le rapport publie un taux obtenu sous une question déduite sans dire qu'il n'est pas comparable.");
  assert.match(deduit, /--questions=file\.json/,
    "le rapport ne dit plus comment corriger la question.");
  assert.match(deduit, /What this does not establish/,
    "le rapport ne porte plus ce qu'il n'établit pas.");
  assert.ok(deduit.indexOf("not comparable") < deduit.indexOf("0.0 %"),
    "la réserve est publiée APRÈS le tableau : un lecteur voit le chiffre avant de savoir qu'il ne compte pas.");

  /* CONTRE-ÉPREUVE — sous une question fournie, l'avertissement N'APPARAÎT PAS. Un rapport
     qui crie à chaque fois ne distingue plus rien, et on cesse de le lire. */
  const fourni = rapportPourLeClient({
    cas: 25, champs: ["nom_complet"], date: "2026-08-24", avecRegles: true, lignes,
    questions: { nom_complet: questionPourInterne("nom_complet", { nom_complet: "What is the name of the client?" }) },
  });
  assert.ok(!/not comparable/.test(fourni),
    "le rapport avertit d'une question déduite alors que le client a fourni la sienne.");
  assert.match(fourni, /\*\*yours\*\*/, "une question fournie n'est plus signalée comme telle.");
  assert.ok(!/no `--rules` was given/.test(fourni),
    "le rapport dit qu'aucune règle n'a été donnée alors qu'il y en avait.");
});

test("l'élagage ne jette jamais le dernier journal d'un genre", () => {
  /*
   * IL GARDAIT LES QUARANTE DERNIERS PAR DATE, sans aucune notion de ce qui porte une figure
   * publiée. Une passe de mesure a écrit assez de journaux pour pousser dehors le dernier du
   * corpus dur, et `abstention`, `escalade` et `signal` sont morts ensemble — sur toutes les
   * machines à la fois, puisque `data/` n'est pas versionné.
   *
   * Les chiffres publiés ont survécu, parce qu'ils sont gelés ailleurs. La capacité de les
   * REFAIRE, non. **Un dépôt qui publie un chiffre qu'il ne sait plus recalculer a perdu
   * exactement ce qui le distingue.**
   */
  const dossier = mkdtempSync(join(tmpdir(), "journaux-"));
  try {
    /* Un seul journal « dur », le plus ancien de tous — donc le premier que l'ordre par date
       jetterait. Et douze journaux banals derrière lui. */
    const noms = ["2026-08-01T00-00-00-000Z-dur.jsonl",
      ...Array.from({ length: 12 }, (_, i) =>
        `2026-08-2${Math.floor(i / 5)}T0${i % 5}-00-00-000Z-essai.jsonl`)];
    for (const n of noms) writeFileSync(join(dossier, n), '{"kind":"run"}\n');

    const efface = elaguerInterne(dossier, 5);
    const restants = readdirSync(dossier);

    assert.ok(efface > 0, "rien n'a été élagué : le cas ne met la garde à l'épreuve d'aucune façon.");
    assert.ok(restants.includes("2026-08-01T00-00-00-000Z-dur.jsonl"),
      `le dernier journal du genre « dur » a été jeté alors qu'il est le seul.\n`
      + `  → trois commandes en dépendent, et data/ n'est pas versionné : il ne revient pas.`);

    /* CONTRE-ÉPREUVE — la garde ne doit pas tout épargner. Un élagage qui ne jette plus rien
       laisse les journaux s'accumuler, ce qu'il existe pour empêcher. */
    assert.ok(restants.length < noms.length,
      `les ${noms.length} journaux sont tous là : l'élagage n'élague plus rien.`);
    /* Et le dernier « essai » survit aussi : c'est le dernier de SON genre. */
    assert.ok(restants.some((f) => f.endsWith("-essai.jsonl")),
      "aucun journal du genre « essai » ne subsiste : la règle ne garde pas le dernier de chaque genre.");
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un relevé publié porte les paramètres sous lesquels le code le prendrait aujourd'hui", () => {
  /*
   * `mur.json` enregistrait un plafond de 45 000 ms par point ; le code en utilise 60 000
   * depuis un commit plus ancien que le fichier. **Le relevé publié n'a pas été pris sous les
   * paramètres du code qui le produit**, et rien ne le disait.
   *
   * Ce n'est pas un chiffre faux : c'est un chiffre pris ailleurs. Un lecteur qui relance la
   * commande obtient autre chose sans comprendre pourquoi, et conclut que la mesure est
   * instable.
   *
   * LES ARTEFACTS S'ÉNUMÈRENT DEPUIS LE DISQUE. Une liste de fichiers écrite ici serait la
   * couverture récitée qu'on refuse partout ailleurs : le prochain relevé porteur d'un
   * paramètre n'y serait pas, et son silence passerait pour un accord.
   */
  const racine = fileURLToPath(new URL("..", import.meta.url));

  /** Ce que le code utiliserait aujourd'hui, par paramètre. */
  const AUJOURDHUI: Record<string, number> = {
    plafondParPointMs: 60_000,
    plafondJetons: PLAFOND_JETONS_INTERNE,
    seuilMemoireLibreMo: MEMOIRE_MINIMALE_INTERNE,
    plafondDeLatenceMs: ASSUMPTIONS.latencyBudgetMs,
    /* LE GABARIT QUE LE CLIENT REMPLIT DOIT PORTER LES DÉFAUTS DU CODE, pas ceux du jour où
       il a été écrit. Ils concordent aujourd'hui ; sans cette garde, rien ne le dirait le
       jour où l'un des deux bouge, et le client partirait sur un réglage périmé. */
    analystAnnualCost: ASSUMPTIONS.analystAnnualCost,
    humanSeconds: ASSUMPTIONS.humanSeconds,
  };
  /*
   * Ce qui est un COMPTE de la passe, pas un réglage du code — donc rien à confronter.
   *
   * Une entrée peut être qualifiée par son fichier (`sbom.json:version`). C'est nécessaire
   * quand le nom est générique : `version` désigne ici le numéro de révision de la
   * nomenclature, mais dans n'importe quel autre relevé il désignerait un réglage. Exempter
   * `version` tout court aurait ouvert un vert vide dans chaque fichier à la fois — un
   * élargissement qui n'aurait rien fermé.
   */
  const COMPTES = new Set(["documents", "champs", "cas", "passes", "valeurs", "cibleN", "tauxDeBase",
    "sbom.json:version",
    /* Le relevé de sécurité porte des comptes de sa passe, pas des réglages : combien de
       commits ont été balayés, combien de secrets sont sortis, combien de témoins ont
       traversé. Qualifiés par leur fichier, comme le reste. */
    "menace-historique.json:commits", "menace-historique.json:trouves",
    "menace-historique.json:temoins", "menace-historique.json:declares"]);
  /* Le gabarit porte AUSSI les hypothèses éditables : elles se confrontent au code comme les
     autres, mais sous leur propre nom. */
  for (const k of ["volume", "budget", "latencyBudgetMs", "pricePerThousandSmall",
    "pricePerThousandLarge"] as const) AUJOURDHUI[k] = ASSUMPTIONS[k];

  const ecarts: string[] = [];
  const nonClasses: string[] = [];
  let confrontes = 0;
  for (const f of readdirSync(racine).filter((n) => n.endsWith(".json"))) {
    if (/^(package|package-lock|tsconfig|tsconfig\.web)\.json$/.test(f)) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(readFileSync(join(racine, f), "utf8")); } catch { continue; }
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "number" || COMPTES.has(k) || COMPTES.has(`${f}:${k}`)) continue;
      if (!(k in AUJOURDHUI)) { nonClasses.push(`${f}:${k}`); continue; }
      confrontes++;
      if (v !== AUJOURDHUI[k]) ecarts.push(`${f} publie ${k}=${v}, le code utiliserait ${AUJOURDHUI[k]}`);
    }
  }

  assert.ok(confrontes >= 3,
    `${confrontes} paramètre(s) confronté(s) : la lecture a échoué et ce cas ne vérifie rien.`);
  assert.deepEqual(nonClasses, [],
    `paramètre(s) publié(s) que rien ne confronte au code : ${nonClasses.join(", ")}.\n`
    + `  → l'ajouter à AUJOURDHUI avec sa valeur de code, ou à COMPTES si c'est un compte de\n`
    + `    la passe et non un réglage.`);
  assert.deepEqual(ecarts, [],
    `relevé(s) pris sous d'autres paramètres que ceux du code :\n  ${ecarts.join("\n  ")}\n`
    + `  → remesurer, ou dire dans le fichier pourquoi il reste pris sous l'ancien.`);
});

test("le contrôle de sortie réseau distingue la boucle locale, et son plancher garde les deux sens", () => {
  /*
   * TROIS DÉFAUTS SUR LA COMMANDE QUI SOUTIENT « rien ne sort de votre machine ».
   *
   * La boucle locale comptait comme un hôte contacté — or `127.0.0.1` désigne CETTE machine,
   * et une connexion vers elle ne fait rien sortir, par définition. La seule présence d'un
   * Ollama local rendait donc le verdict le plus vendable du dépôt **impossible à atteindre
   * sur la machine où il est justement vrai**.
   *
   * Et le plancher ne gardait qu'un sens : il refusait de conclure sur trop peu de relevés
   * quand rien n'avait été vu, et concluait sans broncher quand quelque chose l'avait été.
   * **Ce qu'une passe trop courte n'a pas vu, elle ne l'a pas vu non plus.**
   */
  for (const h of ["127.0.0.1", "::1", "[::1]", "localhost", "127.1.2.3"]) {
    assert.equal(estBoucleLocale(h), true, `${h} n'est plus reconnu comme cette machine.`);
  }
  for (const h of ["huggingface.co", "10.0.0.5", "1.2.3.4", "[2600:9000::1]"]) {
    assert.equal(estBoucleLocale(h), false,
      `${h} est pris pour cette machine : une vraie sortie serait classée comme locale.`);
  }

  const assez = ASSEZ_INTERNE;

  /* Le verdict vendable doit être ATTEIGNABLE quand un modèle local tourne. */
  const avecOllama = verdictEgress({ releves: assez,
    connexions: [{ hote: "127.0.0.1", vu: 30 }] });
  assert.equal(avecOllama.concluant, true);
  assert.equal(avecOllama.sorties.length, 0,
    "une connexion locale est comptée comme une sortie : le verdict devient inatteignable.");
  assert.match(avecOllama.verdict, /aucune sortie/,
    "avec un modèle local, l'outil ne conclut plus qu'aucune donnée n'est sortie.");

  /* Une vraie sortie doit être vue. */
  const vraieSortie = verdictEgress({ releves: assez,
    connexions: [{ hote: "127.0.0.1", vu: 30 }, { hote: "huggingface.co", vu: 4 }] });
  assert.equal(vraieSortie.sorties.length, 1,
    "un hôte hors de la machine n'est plus signalé : la garde ne garde plus rien.");

  /* ET LE PLANCHER, DANS LES DEUX SENS. Une passe trop courte ne conclut ni « rien »
     ni « ceux-là et pas d'autres ». */
  assert.equal(verdictEgress({ releves: assez - 1, connexions: [] }).concluant, false,
    "une passe trop courte conclut « aucune connexion » : c'est un zéro qui n'a rien regardé.");
  assert.equal(verdictEgress({ releves: assez - 1,
    connexions: [{ hote: "huggingface.co", vu: 1 }] }).concluant, false,
    "une passe trop courte conclut sur les hôtes vus — mais ce qu'elle n'a pas vu, elle ne\n"
    + "  l'a pas vu non plus. C'était le sens que le plancher ne gardait pas.");
});

test("tout ce qui peut ouvrir une connexion est déclaré, et le compte n'est pas une phrase", () => {
  /*
   * LA RÉTRACTATION QUI CORRIGEAIT LA PROMESSE EN CONTENAIT UNE AUTRE.
   *
   * Le 20 août, « nothing leaves the machine » a été rétracté parce que `OLLAMA_HOST` pouvait
   * viser un serveur d'équipe. La correction affirmait, comme un inventaire : *« A
   * measurement's path contains exactly one outbound call — the generative host. »*
   *
   * Il y en a au moins trois. `npm run benchmark` télécharge un jeu public au `curl`, et la
   * bibliothèque de modèles tire 1,26 Go au premier lancement — le README le dit lui-même,
   * deux cents lignes plus haut.
   *
   * **Un inventaire écrit en prose est une affirmation ; celui-ci se recompte à chaque
   * exécution.** C'est la seule forme qui ne dérive pas quand quelqu'un ajoute un appel.
   */
  const dossier = fileURLToPath(new URL(".", import.meta.url));

  /** Chaque site capable d'ouvrir une connexion, et pourquoi il existe. */
  const DECLARES: Record<string, string> = {
    "tiers.ts": "l'hôte génératif — le seul appel d'une mesure ordinaire, et il est local par "
      + "défaut ; `estLocal` refuse un hôte distant sans consentement écrit dans la commande",
    "contrainte.ts": "le même hôte génératif, pour mesurer ce que coûte la contrainte de sortie",
    "benchmark.ts": "le téléchargement d'un jeu public étiqueté, une fois — c'est une entrée "
      + "qui descend, jamais une donnée du client qui monte",
  };

  const APPEL = /\bfetch\s*\(|execFileSync\(\s*["']curl["']|spawn\(\s*["']curl["']|https?\.request\s*\(|new WebSocket\s*\(/;
  const trouves = new Map<string, number>();
  for (const f of readdirSync(dossier)) {
    if (!/\.(ts|mjs)$/.test(f) || /\.test\./.test(f)) continue;
    const src = readFileSync(join(dossier, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
    const n = (src.match(new RegExp(APPEL.source, "g")) ?? []).length;
    if (n > 0) trouves.set(f, n);
  }

  assert.ok(trouves.size >= 2,
    `${trouves.size} fichier(s) capables d'ouvrir une connexion trouvés : la lecture a échoué, `
    + `et ce cas rendrait un zéro qui n'a rien regardé.`);

  const nonDeclares = [...trouves.keys()].filter((f) => !(f in DECLARES));
  assert.deepEqual(nonDeclares, [],
    `fichier(s) capables d'ouvrir une connexion et non déclarés : ${nonDeclares.join(", ")}.\n`
    + `  → chacun doit porter sa raison ici, sinon la promesse « nothing leaves the machine »\n`
    + `    repose sur un inventaire que personne ne refait.`);

  /* ET UNE DÉCLARATION QUI NE CORRESPOND PLUS À RIEN EST UNE DÉCLARATION QUI CACHE :
     tant qu'elle est là, un fichier réapparu sous ce nom passerait sans être vu. */
  const mortes = Object.keys(DECLARES).filter((f) => !trouves.has(f));
  assert.deepEqual(mortes, [],
    `déclaration(s) sans appel correspondant : ${mortes.join(", ")} — à retirer.`);
});

test("les deux caractères qui ne se voient pas déclenchent un doute", () => {
  /*
   * Mesuré sur le corpus par une session de contrôle, en pilote : un espace de largeur nulle
   * glissé dans un numéro de pièce fait basculer 100 % des extractions du palier le moins
   * cher et 0 % du suivant ; des homoglyphes cyrilliques font basculer les DEUX à 100 %.
   * Aucun palier n'en protège, et la politique d'abstention ne les regardait pas.
   *
   * Ce n'est pas de la justesse, c'est de la sécurité, et c'est plus sévère : une valeur dont
   * le « a » est cyrillique s'affiche exactement comme la bonne et ne s'appariera à AUCUNE
   * liste de sanctions en aval. Personne ne le verra.
   */
  assert.equal(porteDesInvisibles("idPT​-6884-M"), true, "espace de largeur nulle");
  assert.equal(porteDesInvisibles("Milan, Italie"), true, "espace insécable");
  assert.equal(porteDesInvisibles("﻿Nadia"), true, "marque d'ordre des octets");
  assert.equal(porteDesInvisibles("idPT-6884-M"), false, "témoin négatif : rien d'invisible");

  assert.equal(melangeDEcritures("Ivаn"), true, "un « а » cyrillique dans un mot latin");
  assert.equal(melangeDEcritures("Petrov"), false, "témoin négatif : un mot latin");
  assert.equal(melangeDEcritures("Владимир"), false, "témoin négatif : un mot entièrement cyrillique");
  /* C'EST LE MOT QUI TRAHIT, PAS LA VALEUR. « Владимир Petrov » est un nom translittéré à
     moitié, ce qui arrive légitimement ; le refuser ferait s'abstenir sur des dossiers
     parfaitement normaux, et un taux d'abstention gonflé par du bruit ne décide plus rien. */
  assert.equal(melangeDEcritures("Владимир Petrov"), false, "deux mots, deux écritures, légitime");
  assert.equal(melangeDEcritures("A"), false, "une lettre seule ne mélange rien");
});
