/**
 * LE REFUS DE LIRE QUAND LE PREMIER MAILLON MANQUE — SUR LES DEUX PLATEFORMES.
 *
 * `lire()` refuse plutôt que de mesurer une chaîne dont l'étage de lecture n'a pas pu être
 * compilé. Le refus a survécu à un balayage qui le retirait, et la première explication était
 * fausse : je l'avais donné pour inatteignable après avoir mesuré que `ceQuiManque()` compile
 * le binaire à la demande — vrai de cette machine, faux de celle qui décide.
 *
 * **L'intégration publique tourne sur `ubuntu-latest`**, et `ceQuiManque()` rend un message
 * dès que la plateforme n'est pas macOS. Le refus y est donc pleinement atteignable, et c'est
 * là que la vérification publiée se fait.
 *
 * Un seul cas, sans saut, qui affirme dans les deux états. Pas de branche muette : la
 * plateforme décide laquelle des deux propriétés est vraie ici, et les deux sont éprouvées là
 * où elles ont un sens. Un cas sauté occuperait la place du contrôle qui aurait pu exister —
 * et la chaîne publique refuse tout saut, à raison.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, copyFileSync, writeFileSync, statSync, rmSync, existsSync, readdirSync } from "node:fs";
import { ceQuiManque, lire } from "./ocr.ts";

test("le lecteur d'images refuse en nommant ce qui manque, ou nomme ses pannes", () => {
  const manque = ceQuiManque();

  if (manque !== null) {
    /* CHEMIN DE L'INTÉGRATION PUBLIQUE — ubuntu, pas de lecteur macOS.
       Le refus doit porter LA raison du manque, pas un « command failed » : c'est elle qui
       dit quoi installer, et un refus sans issue se contourne. */
    assert.throws(() => lire("/tmp/cascade-temoin.png"), (e: unknown) => {
      assert.equal((e as Error).message, manque,
        "le refus doit reprendre mot pour mot ce que `ceQuiManque()` a diagnostiqué");
      return true;
    });
    return;
  }

  /* CHEMIN DE LA MACHINE OUTILLÉE — le lecteur existe, donc on éprouve ce qu'il fait de deux
     entrées impossibles. Un tableau vide se lirait comme « pas de texte », qui est un FAIT ;
     ces deux-là sont des pannes, et les deux ne doivent pas se rapporter pareil. */
  for (const [chemin, motif] of [
    ["/tmp/cascade-temoin-absent.png", /introuvable/],
    ["/etc/hosts", /pas une image/],
  ] as const) {
    assert.throws(() => lire(chemin), motif,
      `${chemin} doit produire un refus nommé, jamais un tableau vide`);
  }
});

/*
 * TROIS DÉFAUTS DANS LA COMPILATION À LA DEMANDE, ET ILS SE PAIENT SUR UN CLONE FRAIS.
 *
 * `src/ocr/lire` est ignoré par git, donc absent après un clone. `node --test src/*.test.ts`
 * lance les fichiers en processus PARALLÈLES et trois d'entre eux appellent `ceQuiManque()` :
 * deux compilations écrivaient le MÊME fichier en même temps, `swiftc -o` tronquant sa cible
 * avant d'écrire. `existsSync` acceptait ensuite un binaire de zéro octet POUR TOUJOURS — la
 * commande échouait plus tard sur « cannot execute », très loin de la cause. Et le `catch`
 * rebaptisait toute panne en « swiftc introuvable », envoyant le lecteur lancer
 * `xcode-select --install`, qui ne répare pas une erreur de compilation.
 */
test("un binaire de zéro octet est recompilé, pas accepté pour toujours", { timeout: 120_000 }, (t) => {
  if (process.platform !== "darwin") return t.skip("la compilation Swift n'existe que sur macOS");
  const bac = mkdtempSync(join(tmpdir(), "ocr-vide-"));
  try {
    const src = join(bac, "lire.swift"), bin = join(bac, "lire");
    copyFileSync(fileURLToPath(new URL("./ocr/lire.swift", import.meta.url)), src);

    /* Ce que laisse une compilation tuée, ou deux qui se marchent dessus. */
    writeFileSync(bin, "");
    assert.equal(statSync(bin).size, 0, "le montage est faux : le binaire n'est pas vide.");

    assert.equal(ceQuiManque(bin, src), null, "la recompilation a échoué pour une autre raison.");
    assert.ok(statSync(bin).size > 0,
      "un binaire de zéro octet est accepté tel quel. Rien ne le régénérera jamais, et la\n"
      + "  commande échouera plus tard sur « cannot execute », loin de la cause.");
  } finally { rmSync(bac, { recursive: true, force: true }); }
});

test("une compilation qui échoue ne se fait pas passer pour un swiftc absent", { timeout: 120_000 }, (t) => {
  if (process.platform !== "darwin") return t.skip("la compilation Swift n'existe que sur macOS");
  const bac = mkdtempSync(join(tmpdir(), "ocr-casse-"));
  try {
    const src = join(bac, "lire.swift"), bin = join(bac, "lire");
    writeFileSync(src, "ceci n'est pas du Swift\n");

    const r = ceQuiManque(bin, src);
    assert.ok(r, "une source qui ne compile pas est acceptée : ce cas ne garde plus rien.");
    /* On vise ce que le message AFFIRME, pas un mot qu'il contient : le refus corrigé cite
       `xcode-select` précisément pour dire qu'il ne répare RIEN ici. Ma première assertion
       cherchait la chaîne et accusait le bon message. */
    assert.doesNotMatch(r!, /introuvable/,
      "une erreur de COMPILATION est annoncée comme un `swiftc` absent : le lecteur va installer\n"
      + "  des outils qu'il a déjà. Un diagnostic qui désigne la mauvaise cause coûte plus cher\n"
      + "  qu'aucun diagnostic.");
    assert.match(r!, /compilation/,
      "le refus ne dit pas que c'est la compilation qui a échoué.");
    assert.equal(existsSync(bin), false,
      "un binaire est laissé derrière une compilation ratée : il serait accepté à l'appel suivant.");
  } finally { rmSync(bac, { recursive: true, force: true }); }
});

test("trois compilations simultanées laissent UN binaire entier, et rien d'autre", { timeout: 180_000 }, async (t) => {
  if (process.platform !== "darwin") return t.skip("la compilation Swift n'existe que sur macOS");
  const bac = mkdtempSync(join(tmpdir(), "ocr-course-"));
  try {
    const src = join(bac, "lire.swift"), bin = join(bac, "lire");
    copyFileSync(fileURLToPath(new URL("./ocr/lire.swift", import.meta.url)), src);

    const un = () => new Promise<number>((r) => {
      const p = spawn(process.execPath, ["--input-type=module", "-e",
        `const m = await import(${JSON.stringify(fileURLToPath(new URL("./ocr.ts", import.meta.url)))});\n`
        + `const v = m.ceQuiManque(${JSON.stringify(bin)}, ${JSON.stringify(src)});\n`
        + `process.exit(v === null ? 0 : 1);`], { stdio: "ignore" });
      p.on("exit", (c) => r(c ?? -1));
    });
    /*
     * CE QUE CE CAS TIENT, ET CE QU'IL NE TIENT PAS — dit ici plutôt que laissé à supposer.
     *
     * IL TIENT : trois compilations simultanées rendent toutes 0, laissent un binaire entier,
     * et aucun fichier provisoire derrière elles.
     *
     * IL NE TIENT PAS l'écriture atomique. J'ai essayé de l'éprouver en observant la cible
     * toutes les cinq millisecondes pendant les trois compilations : avec la version qui
     * compile DIRECTEMENT sur la cible, **aucune taille intermédiaire n'a jamais été vue**.
     * `swiftc` publie apparemment sa sortie d'un coup. La troncature que la trouvaille
     * décrivait n'est donc pas reproductible ici, et compiler à côté puis renommer ferme une
     * CLASSE de défauts plutôt qu'un défaut mesuré. L'observation reste dans le cas : si un
     * jour un `swiftc` écrit en plusieurs fois, elle le verra.
     */
    const tailles = new Set<number>();
    const oeil = setInterval(() => {
      try { tailles.add(statSync(bin).size); } catch { /* absente : c'est l'état attendu */ }
    }, 5);
    const codes = await Promise.all([un(), un(), un()]);
    clearInterval(oeil);
    assert.deepEqual(codes, [0, 0, 0], `trois compilations simultanées : codes ${codes.join(", ")}.`);

    const finale = statSync(bin).size;
    const partielles = [...tailles].filter((t) => t > 0 && t !== finale);
    assert.deepEqual(partielles, [],
      `la cible a été vue à ${partielles.join(", ")} octets alors qu'elle en fait ${finale}.\n`
      + "  Un processus qui lance le binaire pendant ce temps — et trois fichiers de cas le font\n"
      + "  en parallèle — trouverait un fichier coupé. Compiler à côté puis renommer ferme ça,\n"
      + "  `rename` étant atomique. (Cette assertion n'a jamais rougi, même en compilant\n"
      + "  directement sur la cible : elle guette, elle ne prouve pas.)");
    assert.ok(statSync(bin).size > 0,
      "le binaire est vide après trois compilations simultanées : `swiftc -o` tronque sa cible\n"
      + "  avant d'écrire, donc l'un vide le fichier que l'autre vient de finir.");
    assert.deepEqual(readdirSync(bac).filter((f) => f.startsWith("lire.")).sort(), ["lire.swift"],
      "un fichier provisoire est resté : la prochaine compilation partirait d'un état inconnu.");
  } finally { rmSync(bac, { recursive: true, force: true }); }
});
