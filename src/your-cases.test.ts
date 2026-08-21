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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { lireCsv } from "./your-cases.ts";

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
  assert.throws(() => lireCsv("text\nhello\n"), /at least two columns/,
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

test("un fichier de sorties malformé est refusé avec la forme attendue", async () => {
  const { chargerSorties } = await import("./your-cases.ts");
  const dossier = mkdtempSync(join(tmpdir(), "sorties-"));
  try {
    const f = join(dossier, "vide.json");
    writeFileSync(f, JSON.stringify({ nom: "la mienne" }));
    assert.throws(() => chargerSorties(f), /valeurs/,
      "un fichier sans `valeurs` doit être refusé, pas lu comme vide.");
    try { chargerSorties(f); } catch (e) {
      assert.match((e as Error).message, /\{ "nom"/,
        "le refus doit montrer la forme attendue, pas seulement la nommer.");
    }

    const bon = join(dossier, "bon.json");
    writeFileSync(bon, JSON.stringify({ valeurs: { name: { d1: "Anna" } } }));
    const s = chargerSorties(bon);
    assert.equal(s.nom, "votre chaîne", "un fichier sans nom en reçoit un, il ne casse pas.");
    assert.equal(s.declares, undefined);
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
    valeurs: { name: { d1: "Anna", d2: "J.", d9: "Inconnu" } },
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
    valeurs: { name: { d1: "Anna", d2: "faux" } },
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

test("« déclaré » n'entre pas dans le vocabulaire de provenance, qui est copié dans cinq dépôts", async () => {
  const { ORDER } = await import("./provenance.ts");
  const { PROVENANCE_DES_DECLARES } = await import("./your-cases.ts");

  assert.deepEqual([...ORDER], ["retrieved", "measured", "assumed", "chosen"],
    "le vocabulaire a changé. Il est copié à l'identique dans cinq dépôts : en ajouter un rang\n"
    + "  ici les fait diverger, et un rang de plus chez nous n'est pas un rang chez eux.");
  assert.ok(ORDER.includes(PROVENANCE_DES_DECLARES.provenance),
    "un chiffre déclaré par le client doit se ranger dans le vocabulaire existant.");
  assert.equal(PROVENANCE_DES_DECLARES.provenance, "assumed");
  assert.ok(PROVENANCE_DES_DECLARES.declarePar.length > 0,
    "le vocabulaire ne dit pas qui a posé l'hypothèse : ça se dit à côté, pas dedans.");
});
