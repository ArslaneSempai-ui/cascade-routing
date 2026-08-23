import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PREMIER_COMMIT_MULTI_FORMULATION } from "./landing.ts";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { generateRecords, generateAlerts, FIELDS, TYPOLOGIES } from "./corpus.ts";
import { correct, TIERS, estLocal, OLLAMA, MODELES_LOCAUX, digestsQuiDivergent,
  DELAI_DE_GENERATION_MS, DELAI_DE_CHARGEMENT_MS, CHARGEMENTS_MESURES_MS } from "./tiers.ts";
import type { TierName } from "./paliers.ts";
import { classify, empreinteDesEntrees, modulesAtteints, cleDeLaGalerieLivree, cleDuFichierLivre } from "./failures.ts";
import { comparer } from "./diff.ts";
import { sonde } from "./sonde.ts";
import { appliquerHypotheses } from "./server.ts";
import { lireCsv } from "./your-cases.ts";
import { corpusDur } from "./corpus-dur.ts";
import { comparerPopulations, plancherDeBruit, longueur, GRAINES_DE_BRUIT } from "./entree.ts";
import { SEUIL_DE_L_INDUSTRIE, OBSERVATIONS_MINIMALES } from "./psi.ts";
import { readProfiles, empreinteDuReleve, RELEVE_DE_REFERENCE, type Profile, type ProvenanceDuPalier, type Provenance } from "./measure.ts";
import { optimiseExtraction, optimiseClassification, budgetShadowPrice, latenceRepresentative, paliersMesures, evaluer, pricePerThousandDocuments } from "./optimise.ts";
import { ASSUMPTIONS, UNITS, BOUNDS, pricePerThousandExtractions, accuracy } from "./assumptions.ts";
import { wilson, rate, distinguishable } from "./interval.ts";
import { PLAUSIBLE, bands, ETIQUETTE, advise } from "./sensitivity.ts";

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

test("un document coûte cinq champs, et ce n'est pas cinq fois le prix d'un champ", () => {
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
  if (!p) return;   // pas de profil gelé : rien à comparer, et ce n'est pas une faute

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

test("aucun palier local ne coûte le même prix sur tous les champs", () => {
  /*
   * Le test précédent ne mord que si un palier au temps machine existe réellement dans le
   * profil avec des latences inégales. Sans celui-ci, un jour où toutes les latences
   * deviendraient égales, « cinq fois » redeviendrait vrai partout et l'erreur repasserait
   * sans que rien ne tombe.
   */
  const p = readProfiles();
  if (!p) return;

  const locaux = paliersMesures(p).filter((t) => t.startsWith("gen-"));
  if (locaux.length === 0) return;   // échelle générative non mesurée : rien à tenir ici

  for (const t of locaux) {
    const prix: number[] = FIELDS.map((c) => pricePerThousandExtractions(t, ASSUMPTIONS, p.extraction[t][c].latency));
    assert.ok(Math.max(...prix) - Math.min(...prix) > 1e-9,
      `${t} est facturé au temps machine : ses cinq champs ne peuvent pas coûter le même prix`);
  }
});

/* ── the optimiser ── */

test("the routing never exceeds the budget", () => {
  const p = readProfiles();
  if (!p) return;                       // nothing measured yet; not a failure of this test
  for (const budget of [50, 200, 4_000, 100_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (s) assert.ok(s.cost <= budget, `routing costs ${s.cost} on a budget of ${budget}`);
  }
});

test("a larger budget never produces a worse routing", () => {
  const p = readProfiles();
  if (!p) return;
  let previous = -1;
  for (const budget of [200, 1_000, 10_000, 100_000, 1_000_000]) {
    const s = optimiseExtraction(p, { ...ASSUMPTIONS, budget });
    if (!s) continue;
    assert.ok(s.accuracy >= previous - 1e-9, "more money bought a worse answer");
    previous = s.accuracy;
  }
});

test("the shadow price reports a step, not a slope", () => {
  const p = readProfiles();
  if (!p) return;
  const f = budgetShadowPrice(p, ASSUMPTIONS);
  assert.ok(f);
  if (f.step) {
    // The next gain must genuinely be a gain, and cost genuinely more.
    assert.ok(f.step.gainPoints > 0);
    assert.ok(f.step.extra > 0);
    assert.ok(f.step.budgetNeeded > f.currentCost);
  }
});

test("the two chains do not want the same tier", () => {
  const p = readProfiles();
  if (!p) return;
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

test("le routage optimal traverse plusieurs familles de paliers", () => {
  /*
   * C'est la trouvaille centrale, et elle serait invisible sans le test.
   *
   * Un encodeur spécialisé garde le nom, des règles gratuites gardent trois champs, un
   * modèle génératif prend l'adresse. Si un jour une seule famille rafle tout, ce n'est pas
   * un progrès : c'est le signe qu'un palier a disparu du profil ou qu'une mesure a viré, et
   * la page dirait alors le contraire de ce qu'elle démontre.
   */
  const p = readProfiles();
  if (!p || !p.extraction["gen-4b"]) return;   // profil encodeurs seuls : rien à tenir ici
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

test("les règles gratuites gardent au moins trois champs sur cinq", () => {
  /*
   * La phrase du titre et de la première ligne du README. Elle a déjà été fausse une fois —
   * « le grand modèle est pire que le petit sur deux champs sur cinq » — et publiée nulle
   * part uniquement parce qu'un contrôle l'a rattrapée à temps. Celle-ci est tenue.
   */
  const p = readProfiles();
  if (!p) return;
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

test("un palier plus gros n'est pas supposé meilleur", () => {
  /*
   * Sur l'adresse, gen-8b est sous gen-4b — et sur les encodeurs à 1 000 cas, `large` est
   * sous `small`. Un test qui ne tiendrait que « l'ordre monte » aurait empêché de voir la
   * seule chose intéressante de ce projet.
   */
  const p = readProfiles();
  if (!p || !p.extraction["gen-8b"]) return;
  const inversions = FIELDS.filter((c) =>
    p.extraction["gen-8b"][c].accuracy < p.extraction["gen-4b"][c].accuracy
    || p.extraction["large"][c].accuracy < p.extraction["small"][c].accuracy);
  assert.ok(inversions.length > 0,
    "plus aucune inversion : soit la mesure a changé, soit la page raconte autre chose");
});

test("l'optimiseur ne route jamais vers un palier absent du profil", () => {
  /*
   * L'échelle est passée de quatre paliers à sept et l'optimiseur a lu `undefined` sur un
   * profil qui n'en contenait que quatre. Quiconque clone ce dépôt et lance `npm run measure`
   * sans Ollama est exactement dans ce cas.
   */
  const p = readProfiles();
  if (!p) return;
  const dispo = new Set(paliersMesures(p));
  const s = optimiseExtraction(p, ASSUMPTIONS);
  for (const c of FIELDS) assert.ok(dispo.has(s!.routing[c]),
    `${c} est routé vers ${s!.routing[c]}, absent du profil gelé`);
});

test("le budget de temps mord avant le budget d'argent", () => {
  /*
   * La latence était mesurée et ne jouait aucun rôle : l'optimiseur envoyait volontiers un
   * champ temps réel sur le palier le plus lent. Serrer le plafond doit maintenant changer
   * le routage, sinon la contrainte est décorative et le README ment.
   */
  const p = readProfiles();
  if (!p) return;
  const large = optimiseExtraction(p, { ...ASSUMPTIONS, latencyBudgetMs: 100_000 });
  const serre = optimiseExtraction(p, { ...ASSUMPTIONS, latencyBudgetMs: 40 });
  assert.ok(large && serre, "un des deux plafonds ne laisse aucune solution");
  assert.ok(serre!.latencyPerItem <= 40, "le routage serré dépasse son propre plafond");
  assert.ok(serre!.accuracy < large!.accuracy,
    "serrer le temps ne coûte rien en justesse : la contrainte ne mord pas");
});

test("à écart non significatif, le moins cher est retenu", () => {
  /*
   * La règle qui a rattrapé une affirmation fausse. Deux paliers indiscernables sur un
   * champ : payer le plus cher, c'est acheter du bruit — et c'est la première chose qu'un
   * validateur de modèles demandera.
   */
  const p = readProfiles();
  if (!p) return;
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
  for (const [quoi, empoisonne] of poisons) {
    assert.ok(chiffresNus(empoisonne, permis).nus.length > 0,
      `la garde ne voit pas un chiffre inventé ajouté ${quoi}. Elle ne prouve donc rien, et `
      + `son zéro plus haut ne vaut rien.`);
  }
});

test("le routage est exhaustif, pas heuristique", () => {
  /*
   * La page l'affirme en gras : « The routing is exhaustive, not heuristic. » C'est une
   * promesse forte — elle garantit l'optimum, ce qu'aucune heuristique ne fait — et rien ne
   * la tenait. Elle se vérifie en comptant : le nombre d'affectations examinées doit valoir
   * exactement paliers^champs, sans quoi une branche est élaguée quelque part.
   */
  const p = readProfiles();
  if (!p) return;
  const paliers = paliersMesures(p);
  const attendu = Math.pow(paliers.length, FIELDS.length);

  /* Budget et plafond de temps hors de portée : aucune solution ne doit être écartée, donc
     tout ce qui est énumérable doit être énuméré. */
  const large = { ...ASSUMPTIONS, budget: Number.MAX_SAFE_INTEGER, latencyBudgetMs: Number.MAX_SAFE_INTEGER };
  let vues = 0;
  const compter = (i: number, courant: Record<string, string>) => {
    if (i === FIELDS.length) { vues++; return; }
    for (const e of paliers) compter(i + 1, { ...courant, [FIELDS[i]!]: e });
  };
  compter(0, {});
  assert.equal(vues, attendu,
    `l'énumération couvre ${vues} affectations sur ${attendu} possibles`);
  assert.ok(optimiseExtraction(p, large), "aucune solution sans contrainte : l'énumération est cassée");
});

test("le budget d'argent mord dès que le volume monte", () => {
  /*
   * La page dit : « Not "the budget does not matter." It does not bind *here*, at this
   * volume, with these prices. Multiply the volume by fifty and it binds immediately. »
   * C'est une affirmation vérifiable, et elle ne l'était pas.
   */
  const p = readProfiles();
  if (!p) return;
  const ici = optimiseExtraction(p, ASSUMPTIONS);
  const gros = optimiseExtraction(p, { ...ASSUMPTIONS, volume: ASSUMPTIONS.volume * 50 });
  assert.ok(ici, "aucun routage au volume de référence");
  assert.ok(ici!.budgetShare < 1, "le budget mord déjà au volume de référence");
  assert.ok(!gros || gros.accuracy < ici!.accuracy || gros.budgetShare >= ici!.budgetShare,
    "multiplier le volume par cinquante ne change rien : la phrase de la page est fausse");
});

test("les gestes du pilote de capture mènent à l'optimum courant", () => {
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
  if (!p) return;
  type Script = { images: { sortie: string; scenes?: string[][] }[] };
  const script: Script = JSON.parse(readFileSync(fileURLToPath(new URL("../captures.json", import.meta.url)), "utf8"));
  const gif = script.images.find((i) => i.sortie.endsWith(".gif"));
  if (!gif?.scenes) return;   // pas de GIF piloté : rien à tenir

  /* L'écran démarre avec tous les champs sur `large` — voir pages.ts. */
  const etat: Record<string, string> = Object.fromEntries(FIELDS.map((c) => [c, "large"]));
  const paliers = paliersMesures(p);

  for (const scene of gif.scenes) {
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

test("chaque rétractation nomme un test qui existe vraiment", () => {
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
  if (!existsSync(f)) return;
  const journal = JSON.parse(readFileSync(f, "utf8")) as {
    entries: { claimed: string; heldBy: string | null; notHeld?: string }[] };

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
    assert.ok(noms.has(e.heldBy),
      `une rétractation dit être tenue par le test « ${e.heldBy} », qui n'existe pas.\n`
      + `  → soit le test a été renommé et l'entrée doit suivre,\n`
      + `    soit le contrôle a disparu et l'erreur peut revenir sans que rien ne tombe.`);
  }
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

test("un relevé régénéré porte le commit qui l'a produit", () => {
  const p = readProfiles();
  if (!p) return;   // pas de profil : un clone frais n'a pas encore mesuré

  if (p.measuredAt === RELEVE_HISTORIQUE) {
    console.warn(`  ⚠ le profil gelé du ${RELEVE_HISTORIQUE} est antérieur à l'enregistrement du commit.\n`
      + `    Il est toléré par sa date, et par elle seule. \`npm run measure\` le rendra dur.`);
    return;
  }

  assert.ok(p.code && typeof p.code.commit === "string" && p.code.commit.length > 0,
    `le relevé du ${p.measuredAt} ne porte pas de commit.\n`
    + `  → un relevé qu'on ne peut pas rattacher à une révision n'est pas un relevé :\n`
    + `    rien ne dit quel code a produit ces chiffres, ni s'il est encore là.`);
  assert.equal(typeof p.code!.sale, "boolean",
    "le relevé doit dire si l'arbre était sale au moment de la mesure — un chiffre produit "
    + "sur des modifications non committées n'est pas reproductible");
});

test("un relevé régénéré garde les réussites par cas, pour que McNemar puisse tourner", () => {
  /*
   * Sans ces bits, `memeChamp` retombe sur le recouvrement d'intervalles de Wilson — un test
   * qui traite deux paliers notés sur les *mêmes* cas comme deux échantillons indépendants.
   * Il est valable mais trop prudent : il déclare « indiscernables » des paires qu'un test
   * apparié sépare, et le routage retient alors le moins cher sur une égalité qui n'en est
   * pas une. `pairedVerdict` attend ces bits et existait, inutilisé, depuis le premier jour.
   */
  const p = readProfiles();
  if (!p) return;

  if (p.measuredAt === RELEVE_HISTORIQUE) {
    console.warn(`  ⚠ le profil gelé du ${RELEVE_HISTORIQUE} ne conserve pas les réussites par cas :\n`
      + `    toutes ses égalités viennent du recouvrement d'intervalles, pas de McNemar.`);
    return;
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

test("toute hypothèse qui tarife un palier sélectionnable est balayée", () => {
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
  if (!p) return;

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

test("les deux balayages de prix ne peuvent pas se contredire", () => {
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
  if (!p) return;

  const optimum = optimiseExtraction(p, ASSUMPTIONS);
  if (!optimum) return;
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

test("un palier mesuré porte sa propre provenance", () => {
  /*
   * `code` décrivait une passe en prétendant décrire un fichier que `sauver` fusionne. Le
   * relevé a ainsi porté `sale: true` pour sept paliers dont trois venaient d'une passe sur
   * arbre propre. La provenance est maintenant écrite avec le palier ; ce test interdit qu'un
   * palier mesuré après ce changement reparte sans elle.
   */
  const p = readProfiles();
  if (!p) return;
  if (p.measuredAt === RELEVE_HISTORIQUE) return;

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

test("les deux fichiers classent une absence de seuil de la même façon", () => {
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
  if (!p) return;
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;

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

test("chaque latence enregistrée dit sous quelle charge elle a été prise", () => {
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
  if (!p) return;

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

test("la décomposition des erreurs recompose l'exactitude du palier", () => {
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
  if (!p) return;
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
  const l = JSON.parse(readFileSync(f, "utf8")) as {
    errorSplit: { perThousand: Record<string, { tier: string; blank: number | null; wrong: number | null }> } | null;
    cleanPerDocument: { pct: number; n: number; clean: number } | null;
  };
  if (!l.errorSplit || !l.cleanPerDocument) return;

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

test("chaque rétractation porte son résumé et dit si quelqu'un l'a vue", () => {
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
  if (!existsSync(f)) return;
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
test("l'égalité d'exactitude sous charge ne porte que sur les paliers réellement remesurés", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
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
test("le balayage vers le bas essaie des prix, et le dit", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
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
test("la composition des latences est nommée, et son écart au total réel est chiffré", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
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
test("chaque seuil publié porte son unité, dénominateur compris", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
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
test("l'appel génératif impose une sortie structurée, sinon le prix publié est faux d'un facteur huit", () => {
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
test("la prose du plafond nomme l'exception que ses chiffres portent", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
  const bloc = (JSON.parse(readFileSync(f, "utf8")) as {
    latencySpread: { escalationCeiling: null | {
      perField: { field: string; overCeiling: boolean }[];
      everyFieldOverCeiling: boolean; fieldsOverCeiling: string[]; fieldsUnderCeiling: string[];
      note: string } };
  }).latencySpread.escalationCeiling;
  if (!bloc) return;

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
test("toute durée publiée déclare d'où elle vient, et cet endroit porte des percentiles", () => {
  const f = fileURLToPath(new URL("../landing.json", import.meta.url));
  if (!existsSync(f)) return;
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
  const sources = ["tiers.ts", "corpus.ts", "failures.ts"]
    .map((f) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8")).join("\u0000");
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
  for (const f of ["tiers.ts", "corpus.ts", "failures.ts"]) {
    const t = readFileSync(fileURLToPath(new URL("./" + f, import.meta.url)), "utf8");
    assert.ok(t.length > 500,
      "la source " + f + " lue par l'empreinte fait " + t.length + " caractères : la clé ne suit plus le code.");
  }
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
    t = t.replace(/<!-- figures:([a-z0-9-]+) -->[\s\S]*?<!-- \/figures:\1 -->/g, "");
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
  assert.match(refus!.message, /Ligne 4\b/,
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
  const PORT = 4771;
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

    const sienne = await fetch(`${base}/api/routage`, {
      method: "POST", headers: { "content-type": "application/json", origin: `http://localhost:${PORT}` }, body: "{}",
    });
    assert.equal(sienne.status, 200, "l'écran lui-même est refusé : la garde mord son propre usage.");

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
