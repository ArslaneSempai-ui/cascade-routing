/*
 * L'ANALYSEUR QUE LES INCONNUS TOUCHENT EN PREMIER.
 *
 * `measure:yours` est le seul chemin de ce dépôt qu'une personne extérieure exécute sur ses
 * propres données, et son analyseur CSV est écrit à la main pour tenir la promesse « zéro
 * dépendance d'exécution ». C'était donc, jusqu'à ce fichier, le code le plus exposé et le
 * moins couvert du projet.
 *
 * Chaque cas ici vient d'un tableur réel : Excel écrit des fins de ligne Windows et une marque
 * d'ordre d'octets, les exports mettent des guillemets partout, et un champ de texte libre
 * contient des virgules et des retours à la ligne.
 */

import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { lireCsv } from "./your-cases.ts";
import { fileURLToPath } from "node:url";

test("deux colonnes : texte et réponse, sans identifiant", () => {
  const { champs, cas } = lireCsv("text,category\nHow do I find my card?,card_arrival\n");
  assert.deepEqual(champs, ["category"]);
  assert.equal(cas.length, 1);
  assert.equal(cas[0]!.text, "How do I find my card?");
  assert.equal(cas[0]!.truth["category"], "card_arrival");
  assert.equal(cas[0]!.id, "1", "un identifiant est fabriqué quand la colonne manque");
});

test("trois colonnes ou plus : un champ par colonne restante", () => {
  const { champs, cas } = lireCsv("id,text,name,birth\na1,Anna Petrova born 3 May 1990,Anna Petrova,3 May 1990\n");
  assert.deepEqual(champs, ["name", "birth"]);
  assert.equal(cas[0]!.id, "a1");
  assert.equal(cas[0]!.truth["birth"], "3 May 1990");
});

test("une virgule dans une cellule entre guillemets ne coupe pas la ligne", () => {
  const { cas } = lireCsv('id,text,name\n1,"Petrova, Anna — client",Anna Petrova\n');
  assert.equal(cas[0]!.text, "Petrova, Anna — client");
  assert.equal(cas[0]!.truth["name"], "Anna Petrova");
});

test("un guillemet doublé est un guillemet", () => {
  const { cas } = lireCsv('id,text,name\n1,"she said ""hello"" twice",Anna\n');
  assert.equal(cas[0]!.text, 'she said "hello" twice');
});

test("un retour à la ligne dans une cellule ne crée pas un cas", () => {
  const { cas } = lireCsv('id,text,label\n1,"line one\nline two",ok\n');
  assert.equal(cas.length, 1, "la cellule multiligne a été coupée en deux cas");
  assert.match(cas[0]!.text, /line one\nline two/);
});

test("les fins de ligne Windows sont acceptées", () => {
  /* Excel et la plupart des exports bancaires écrivent \r\n. Un \r resté collé à la dernière
     colonne fait échouer chaque comparaison, silencieusement et sur tous les cas. */
  const { cas } = lireCsv("id,text,label\r\n1,hello,ok\r\n2,world,ko\r\n");
  assert.equal(cas.length, 2);
  assert.equal(cas[0]!.truth["label"], "ok", "un retour chariot traîne sur la dernière colonne");
  assert.equal(cas[1]!.truth["label"], "ko");
});

test("une marque d'ordre d'octets ne casse pas le nom de la première colonne", () => {
  /*
   * Excel préfixe ses CSV UTF-8 d'un caractère invisible qui colle au premier nom de colonne.
   * Ici il est inoffensif *par construction* — les noms des deux premières colonnes ne servent
   * à rien, seuls ceux des colonnes de réponses sont lus. Le test ne répare donc rien : il
   * fige la propriété, pour qu'une refonte qui se mettrait à lire l'en-tête de gauche tombe
   * ici plutôt que chez quelqu'un qui exporte depuis un tableur.
   */
  const { champs, cas } = lireCsv("﻿id,text,label\n1,hello,ok\n");
  assert.deepEqual(champs, ["label"]);
  assert.equal(cas[0]!.id, "1", "la marque d'ordre d'octets est restée dans l'identifiant");
});

test("les lignes vides sont ignorées, pas comptées comme des cas", () => {
  const { cas } = lireCsv("id,text,label\n1,hello,ok\n\n\n2,world,ko\n\n");
  assert.equal(cas.length, 2);
});

test("une cellule manquante devient une chaîne vide, pas undefined", () => {
  const { cas } = lireCsv("id,text,name,birth\n1,hello,Anna\n");
  assert.equal(cas[0]!.truth["birth"], "", "une colonne absente doit valoir la chaîne vide");
});

test("un fichier à une seule colonne est refusé, avec une raison", () => {
  assert.throws(() => lireCsv("text\nhello\n"), /needs at least two/,
    "un fichier inutilisable doit lever un message lisible, pas produire zéro cas en silence");
});

/*
 * LA CHAÎNE DU CLIENT : SES SORTIES, JAMAIS SON CODE.
 *
 * Un client fait tourner son extracteur chez lui et nous envoie ce qu'il a rendu. On note son
 * exactitude ici — c'est un calcul, reproductible par lui — et on ne voit ni son coût ni sa
 * latence, qu'il déclare. La distinction décide de l'admissibilité, qui se juge sur un plafond
 * en millisecondes, donc elle doit se lire à chaque ligne et pas seulement dans un en-tête.
 */

test("aucune valeur extraite n'entre : seules les issues sont acceptées", async () => {
  const { chargerSorties } = await import("./your-cases.ts");
  const dossier = mkdtempSync(join(tmpdir(), "sorties-"));
  try {
    /*
     * L'ancienne forme a existé une heure et quelqu'un l'aura copiée. Elle doit être refusée
     * avec sa raison — un fichier de valeurs lu en silence ferait entrer chez nous des noms et
     * des numéros de passeport, dans un outil qui déclare n'en recevoir aucun.
     */
    const ancien = join(dossier, "ancien.json");
    writeFileSync(ancien, JSON.stringify({ nom: "la mienne", valeurs: { name: { d1: "Anna Petrova" } } }));
    assert.throws(() => chargerSorties(ancien), /personal data/,
      "l'ancienne forme, qui porte des valeurs, doit être refusée en disant pourquoi.");

    const vide = join(dossier, "vide.json");
    writeFileSync(vide, JSON.stringify({ nom: "la mienne" }));
    assert.throws(() => chargerSorties(vide), /issues/,
      "un fichier sans `issues` est refusé, pas lu comme vide.");

    /* Une valeur glissée à la place d'une issue est le chemin par lequel une donnée entrerait. */
    const glisse = join(dossier, "glisse.json");
    writeFileSync(glisse, JSON.stringify({ issues: { name: { d1: "Anna Petrova" } } }));
    assert.throws(() => chargerSorties(glisse), /not an outcome|personal data/,
      "une valeur là où une issue est attendue doit être refusée, pas comptée comme fausse.");

    const bon = join(dossier, "bon.json");
    writeFileSync(bon, JSON.stringify({ issues: { name: { d1: "clean", d2: "wrong" } } }));
    const s = chargerSorties(bon);
    assert.equal(s.nom, "your chain", "un fichier sans nom en reçoit un, il ne casse pas.");
    assert.equal(s.declares, undefined);
    assert.equal(s.notePar, undefined,
      "l'absence de `notePar` ne casse pas la lecture — c'est le rapport qui doit la signaler.");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("les identifiants sans correspondance sont comptés et nommés dans les deux sens", async () => {
  const { correspondance } = await import("./your-cases.ts");
  const cas = [
    { id: "d1", text: "", truth: { name: "Anna" } },
    { id: "d2", text: "", truth: { name: "Jan" } },
    { id: "d3", text: "", truth: { name: "Sofia" } },
  ];
  const c = correspondance(cas, ["name", "birth"], {
    nom: "la sienne",
    issues: { name: { d1: "clean", d2: "wrong", d9: "clean" } },
  });

  assert.deepEqual(c.manquants["name"], ["d3"], "un de nos cas absent de son fichier est nommé.");
  assert.deepEqual(c.inconnus["name"], ["d9"], "un des siens que nous n'avons pas est nommé.");
  assert.deepEqual(c.champsSansAucuneValeur, ["birth"],
    "un champ pour lequel il n'a rien fourni doit être dit, pas traité comme zéro sur zéro.");
  assert.equal(c.total, 2 + 3,
    "le compte couvre les deux sens et tous les champs, `birth` compris.");
});

test("le taux du client porte sur les cas appariés, jamais sur les nôtres", async () => {
  const { mesurerVosCas } = await import("./your-cases.ts");
  const cas = [
    { id: "d1", text: "", truth: { name: "Anna" } },
    { id: "d2", text: "", truth: { name: "Jan" } },
    { id: "d3", text: "", truth: { name: "Sofia" } },
  ];
  const releve = await mesurerVosCas(cas, ["name"], [], undefined, false, {
    nom: "la sienne",
    issues: { name: { d1: "clean", d2: "wrong" } },
    declares: { msParDocument: 480 },
  });
  const r = releve["name"]!["la sienne" as never] as { bons: number; sur: number; ms: number };
  assert.equal(r.sur, 2, "d3 n'est pas dans son fichier : il ne compte pas dans son dénominateur.");
  assert.equal(r.bons, 1);
  assert.equal(r.ms, 480, "la latence vient de sa déclaration.");
});

test("une durée déclarée porte sa marque, et une durée absente ne devient pas zéro", async () => {
  const { ecrireMs } = await import("./your-cases.ts");
  assert.equal(ecrireMs(480, true), "480 ms (déclaré)");
  assert.equal(ecrireMs(480, false), "480 ms");
  assert.equal(ecrireMs(Number.NaN, true), "durée non déclarée",
    "une latence non déclarée doit se dire, jamais s'afficher comme instantanée —\n"
    + "  zéro milliseconde est faux dans la seule direction qui avantage le client.");
});

test("« déclaré » n'entre pas dans le vocabulaire de provenance, copié dans tout le portfolio", async () => {
  const { ORDER } = await import("./provenance.ts");
  const { PROVENANCE_DES_DECLARES } = await import("./your-cases.ts");

  /*
   * LE TITRE DISAIT « CINQ DÉPÔTS », ET LE MESSAGE AUSSI. IL Y EN A ONZE.
   *
   * Un compte dans un titre de cas dérive exactement comme un compte dans une prose, et pour
   * la même raison : rien ne le recalcule. Celui-ci était faux depuis assez longtemps pour que
   * personne ne sache depuis quand — le fichier a été semé dans six dépôts de plus sans que la
   * phrase bouge. On le compte donc, et le compte sert à quelque chose : il vérifie que les
   * copies sont encore identiques, ce que la phrase se contentait d'affirmer.
   */
  const voisins = fileURLToPath(new URL("../../", import.meta.url));
  const ici = readFileSync(fileURLToPath(new URL("./provenance.ts", import.meta.url)), "utf8");
  const porteurs: string[] = [];
  const divergents: string[] = [];
  for (const d of readdirSync(voisins, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    for (const sous of ["", "src/"]) {
      const chemin = `${voisins}${d.name}/${sous}provenance.ts`;
      if (!existsSync(chemin)) continue;
      porteurs.push(`${d.name}/${sous}provenance.ts`);
      if (readFileSync(chemin, "utf8") !== ici) divergents.push(d.name);
    }
  }

  if (porteurs.length > 1) {          // un clone isolé n'a pas de voisins à comparer
    assert.deepEqual(divergents, [],
      `le vocabulaire de provenance a divergé dans : ${divergents.join(", ")}.\n`
      + `  → il est copié à l'identique dans ${porteurs.length} fichiers ; une divergence veut dire\n`
      + `    qu'un rang de plus chez l'un n'est pas un rang chez les autres.`);
  }

  assert.deepEqual([...ORDER], ["retrieved", "measured", "assumed", "chosen"],
    `le vocabulaire a changé. Il est copié à l'identique dans ${porteurs.length} fichier(s) du\n`
    + "  portfolio : en ajouter un rang ici les fait diverger.");
  assert.ok(ORDER.includes(PROVENANCE_DES_DECLARES.provenance),
    "un chiffre déclaré par le client doit se ranger dans le vocabulaire existant.");
  assert.equal(PROVENANCE_DES_DECLARES.provenance, "assumed");
  assert.ok(PROVENANCE_DES_DECLARES.declarePar.length > 0,
    "le vocabulaire ne dit pas qui a posé l'hypothèse : ça se dit à côté, pas dedans.");
});

/*
 * Sans version de correcteur, l'exactitude du client n'est plus mesurée mais crue.
 *
 * Les issues sont produites par notre correcteur, exécuté sur sa machine sur sa clé — c'est
 * une mesure, et c'est ce qui permet de dire « exactitude mesurée, coût déclaré ». Mais un
 * fichier qui ne dit pas quelle version l'a notée est indiscernable d'un fichier saisi à la
 * main, et le second n'est pas une mesure. C'est le défaut du `null` qui vaut deux choses.
 */
test("le mode de notation du client est annoncé, et son absence dégrade le rang du chiffre", async () => {
  const src = readFileSync(fileURLToPath(new URL("./your-cases.ts", import.meta.url)), "utf8");

  assert.match(src, /notePar\?\.version/,
    "rien ne regarde la version du correcteur qui a produit les issues.");
  assert.match(src, /indiscernables/,
    "l'absence de version doit être dite au lecteur, pas seulement constatée.");

  /* Et aucune valeur extraite ne doit pouvoir traverser le chargeur. */
  const { ISSUES_VALIDES } = await import("./your-cases.ts");
  assert.deepEqual([...ISSUES_VALIDES], ["clean", "wrong", "blank"],
    "les issues acceptées ont changé : tout élargissement ici est un chemin par lequel une\n"
    + "  donnée personnelle peut entrer, et l'outil déclare n'en recevoir aucune.");
  assert.ok(!/sorties\.valeurs/.test(src),
    "le code lit encore une clé `valeurs` : les valeurs extraites ne doivent plus entrer.");
});

test("aucun message que le client peut voir n'est en français", () => {
  /*
   * Le chemin client mélangeait les deux langues. Une banque américaine qui donne un CSV mal
   * formé recevait « Ligne 2 de votre CSV ouvre une guillemet qui n'est jamais refermée » —
   * un message par ailleurs excellent, qui dit la ligne, la raison du refus et comment
   * trouver la faute, et que le lecteur ne comprend pas.
   *
   * Les commentaires du dépôt restent en français : ils s'adressent à celui qui maintient.
   * Ce que le client voit ne s'y adresse pas.
   */
  const src = readFileSync(new URL("./your-cases.ts", import.meta.url), "utf8");
  const FRANCAIS = /\b(votre|vos|aucun|n'est|n'a|qui|pour|dans|à la|ne se|données|refuse|fichier|ligne|colonne)\b/i;

  const messages: string[] = [];
  for (const m of src.matchAll(/(?:throw new Error\(|console\.error\()\s*([`"][\s\S]{10,400}?)\);/g)) {
    messages.push(m[1]!);
  }
  assert.ok(messages.length >= 5,
    `${messages.length} message(s) trouvé(s) : le motif ne lit plus les messages, et ce cas ne vérifie rien.`);

  const fautifs = messages
    .filter((t) => FRANCAIS.test(t.replace(/\$\{[^}]*\}/g, " ")))
    .map((t) => t.replace(/\s+/g, " ").slice(0, 70));
  assert.deepEqual(fautifs, [],
    `message(s) en français sur le chemin d'un client anglophone :\n`
    + fautifs.map((x) => `  - ${x}`).join("\n"));
});
