/*
 * LA COUTURE ENTRE LE GABARIT LIVRÉ ET L'OUTIL QUI LE LIT.
 *
 * Le type `Reponses` et le contrôle des clés inconnues étaient chacun corrects, et
 * personne ne les faisait se regarder : le type déclarait `chaine`, `residence`,
 * `replisiPalierIndisponible` et `quiSigne`, le contrôle ne les connaissait pas.
 *
 * Le résultat était le pire possible pour un premier contact : **le gabarit que ce
 * dépôt livre était REFUSÉ par son propre outil**, quatre de ses clés annoncées
 * « not a key of this questionnaire ». Un acheteur remplit le fichier qu'on lui
 * donne, lance la commande qu'on lui indique, et le premier mot qu'il lit est
 * REFUSED — il en conclut que rien de ce dépôt n'a jamais été essayé.
 *
 * Ces cas traversent la couture au lieu d'en inspecter les deux bords : le fichier
 * livré est passé à la commande livrée, et le code de sortie est lu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lire } from "./intake.ts";

const ICI = fileURLToPath(new URL(".", import.meta.url));
const RACINE = fileURLToPath(new URL("..", import.meta.url));

const lancer = (fichier: string) =>
  spawnSync("node", [join(ICI, "intake.ts"), `--file=${fichier}`],
            { encoding: "utf8", cwd: RACINE, timeout: 60_000 });

test("le gabarit livré passe l'outil livré", () => {
  const r = lancer(join(RACINE, "intake-template.json"));
  assert.equal(r.status, 0,
    `le gabarit de ce dépôt est refusé par sa propre commande :\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /REFUSED/,
    "aucune clé du gabarit ne doit être annoncée inconnue");
  /* Le témoin de non-vacuité : un gabarit vide passerait le cas ci-dessus. */
  assert.match(r.stdout, /SUPPLIED BY THE CLIENT \((\d+)\)/);
  const n = Number(/SUPPLIED BY THE CLIENT \((\d+)\)/.exec(r.stdout)?.[1]);
  assert.ok(n >= 5, `seulement ${n} valeur(s) lue(s) du gabarit`);
});

test("toute clé du gabarit est une clé que l'outil connaît", () => {
  /* La même couture, prise par l'autre bout et sans lancer de processus : si
     quelqu'un ajoute une clé au gabarit sans l'ajouter aux clés connues, ce cas
     tombe avant que le premier acheteur ne le découvre. */
  const gabarit = JSON.parse(readFileSync(join(RACINE, "intake-template.json"), "utf8"));
  const r = lancer(join(RACINE, "intake-template.json"));
  for (const cle of Object.keys(gabarit)) {
    assert.doesNotMatch(r.stdout, new RegExp(`"${cle}" is not a key`),
      `"${cle}" est dans le gabarit livré et inconnue de l'outil`);
  }
});

test("un refus sort en code non nul, un succès en zéro", () => {
  const dossier = mkdtempSync(join(tmpdir(), "intake-"));
  try {
    const hors = join(dossier, "hors-bornes.json");
    writeFileSync(hors, JSON.stringify({ volume: -5000 }));
    const r = lancer(hors);
    assert.equal(r.status, 3,
      "REFUSED sortait en 0 : seul un humain qui lit distinguait un refus d'un succès");
    assert.match(r.stdout, /REFUSED/);

    /* Contre-témoin : sans lui, une commande qui refuserait tout passerait ce cas. */
    const bon = join(dossier, "bon.json");
    writeFileSync(bon, JSON.stringify({ volume: 100_000 }));
    assert.equal(lancer(bon).status, 0);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un JSON illisible se dit sans trace d'appel", () => {
  const dossier = mkdtempSync(join(tmpdir(), "intake-"));
  try {
    for (const [nom, contenu, attendu] of [
      ["vide.json", "", /is empty/],
      ["bom.json", "﻿" + JSON.stringify({ volume: 100_000 }), null],
      ["casse.json", '{"volume": 100000,', /not valid JSON/],
      ["liste.json", "[1,2,3]", /holds a list/],
    ] as const) {
      const f = join(dossier, nom);
      writeFileSync(f, contenu);
      const r = lancer(f);
      const tout = r.stdout + r.stderr;
      if (attendu === null) {
        /* Le BOM est ce qu'un éditeur Windows ajoute : il doit passer, pas échouer. */
        assert.equal(r.status, 0, `un BOM ne doit pas casser la lecture :\n${tout}`);
        continue;
      }
      assert.equal(r.status, 2, `${nom} : ${tout.slice(0, 160)}`);
      assert.match(tout, attendu);
      assert.doesNotMatch(tout, /at JSON\.parse|at Object\.|\.ts:\d+:\d+/,
        `${nom} montre une trace d'appel à un acheteur`);
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

/*
 * UNE CHAÎNE A UNE LONGUEUR, ET C'EST COMME ÇA QU'ON CONTOURNAIT LE BLOCAGE.
 *
 * `"paliersDisponibles": "rules"` — la faute de frappe naturelle, sans les crochets — vaut
 * cinq caractères, donc `length < 2` est faux, donc « un seul palier appelable » ne se
 * déclenchait pas. Le client répond honnêtement qu'il n'a qu'un palier, et le questionnaire
 * lui répond que tout va bien.
 */
test("un palier écrit comme une chaîne est refusé, pas compté en caractères", () => {
  const chaine = lire({ paliersDisponibles: "rules" } as never);
  assert.equal(chaine.bloquant.length, 0,
    "le blocage se déclenche sur une valeur de forme inconnue : il dirait la bonne chose pour\n"
    + "  la mauvaise raison, et un `\"a\"` le déclencherait aussi.");
  assert.ok(chaine.refus.some((x: string) => /paliersDisponibles/.test(x)),
    "« rules » écrit comme une chaîne passe sans un mot. Cinq caractères ne sont pas cinq\n"
    + "  paliers, et le client qui n'en a qu'un s'entend dire que son routage est optimisable.");
  assert.ok(chaine.refus.some((x: string) => /\["rules", "small"\]/.test(x)),
    "le refus ne montre pas la forme attendue : un refus sans issue se fait contourner.");

  /* Les autres formes tordues, toutes silencieuses avant. */
  for (const v of [42, true, { rules: 1 }, ["rules", 7]]) {
    const r = lire({ paliersDisponibles: v } as never);
    assert.ok(r.refus.some((x: string) => /paliersDisponibles/.test(x)),
      `${JSON.stringify(v)} traverse la lecture sans être signalé.`);
  }

  /* TÉMOINS POSITIFS, dans les deux sens : la bonne forme passe, et le blocage reste
     atteignable — une garde qui refuserait tout serait retirée avec ce qu'elle gardait. */
  const deux = lire({ paliersDisponibles: ["rules", "small"] });
  assert.deepEqual(deux.refus.filter((x: string) => /paliersDisponibles/.test(x)), []);
  assert.equal(deux.bloquant.length, 0);

  const un = lire({ paliersDisponibles: ["rules"] });
  assert.deepEqual(un.refus.filter((x: string) => /paliersDisponibles/.test(x)), []);
  assert.ok(un.bloquant.some((x: string) => /one callable tier/.test(x)),
    "un seul palier ne bloque plus : c'est la situation que ce champ existe pour attraper.");
});
