import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { refuserDrapeauxInconnus } from "./cli.ts";

/*
 * UN DRAPEAU INCONNU AVALÉ EN SILENCE EST UN SUCCÈS QUI MENT SUR CE QU'IL A FAIT.
 *
 * Mesuré en lançant les 37 commandes avec `--nimportequoi` : `optimise` et `dossier`
 * tournaient entièrement, réglages par défaut, et sortaient 0. Un acheteur qui écrit
 * `--fields` au lieu de `--field` obtient un résultat complet, juste, qui ne répond pas à sa
 * question — puis il le cite. Ça coûte plus cher qu'un plantage, parce que rien ne le dit.
 *
 * Ce cas ne vérifie pas une liste écrite à la main : il PART de package.json et confronte
 * chaque commande à son fichier. Une commande neuve arrive donc non couverte, et ce cas le
 * dit — au lieu de la laisser entrer par la porte que la liste ne regardait pas.
 */

const dossier = fileURLToPath(new URL(".", import.meta.url));
const racine = join(dossier, "..");

/** Commandes dont la garde n'est pas encore posée. Ce compte ne doit que baisser. */
const PAS_ENCORE = [
  /* Mesuré, pas récité : c'est exactement la liste que ce cas produit aujourd'hui.
     `escalade.ts` et `readme.ts` appartiennent à une autre session, d'où leur présence. */
  "measure.ts", "sensibilite-prompt.ts", "regler-prompt.ts", "apparier-prompt.ts",
  "departager-reglage.ts", "mesurer-dur.ts", "your-cases.ts",
  /* `egress` surveille une AUTRE commande : `egress --every=250 script.ts --cases=x.csv`.
     Les drapeaux qui suivent le nom de script appartiennent à la commande observée, et les
     refuser ici réintroduirait le défaut qui empêchait `egress` de regarder le chemin
     client. Couverte dès que la garde acceptera une borne haute. */
  "egress.ts",
  "clone-neuf.mjs", "mesurer-ocr.ts", "licences.ts", "menace.ts",
];

test("une commande qui lit des drapeaux refuse ceux qu'elle ne connaît pas", () => {
  const scripts = JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).scripts as Record<string, string>;
  const fichiers = new Map<string, string[]>();
  for (const [nom, cmd] of Object.entries(scripts)) {
    const f = cmd.match(/src\/([\w.-]+\.(?:ts|mjs))/)?.[1];
    if (!f || !existsSync(join(dossier, f))) continue;
    fichiers.set(f, [...(fichiers.get(f) ?? []), nom]);
  }
  assert.ok(fichiers.size >= 20,
    `${fichiers.size} commande(s) trouvée(s) dans package.json : le relevé ne lit plus rien, `
    + "et un zéro d'ici ne voudrait rien dire.");

  const nus: string[] = [];
  for (const [f, noms] of fichiers) {
    const s = readFileSync(join(dossier, f), "utf8");
    const litDesDrapeaux = /argv[\s\S]{0,80}?(startsWith\(\s*["'`]--|includes\(\s*["'`]--)/.test(s);
    if (!litDesDrapeaux) continue;
    /*
     * L'APPEL, PAS LE NOM. Une première version cherchait `refuserDrapeauxInconnus` dans le
     * fichier — la ligne d'`import` suffisait à la satisfaire. En retirant l'appel de
     * `mur.ts` pour éprouver ce cas, il est resté vert : il vérifiait une forme, pas une
     * propriété. C'est le défaut que ce fichier existe pour empêcher, écrit dans ce fichier.
     */
    const appelle = s.split("\n")
      .filter((l) => !/^\s*import\b/.test(l))
      .some((l) => /refuserDrapeauxInconnus\s*\(/.test(l));
    if (appelle) continue;
    nus.push(`${f} (${noms.join(", ")})`);
  }

  const inattendus = nus.filter((x) => !PAS_ENCORE.some((p) => x.startsWith(p + " ")));
  assert.deepEqual(inattendus, [],
    "commande(s) qui lisent des drapeaux sans refuser les inconnus, et qui ne sont pas "
    + `déclarées :\n${inattendus.map((x) => "  - " + x).join("\n")}\n`
    + "  → poser `refuserDrapeauxInconnus([...])` en tête du bloc isMain, ou l'inscrire "
    + "dans PAS_ENCORE avec sa raison.");

  assert.ok(nus.length <= PAS_ENCORE.length,
    `${nus.length} commande(s) sans garde pour ${PAS_ENCORE.length} déclarée(s) — le compte `
    + "ne doit que baisser. S'il monte, une commande neuve lit des drapeaux sans les refuser.");
});

test("témoins : la garde accepte ce qu'elle connaît et refuse le reste", () => {
  /*
   * Sans ces deux-là, la règle ci-dessus pourrait être incapable de se déclencher : elle
   * cherche un NOM de fonction dans un fichier, ce qui ne prouve rien de son comportement.
   */
  const argvInitial = process.argv;
  const sorties: number[] = [];
  const exitInitial = process.exit;
  const ecrit: string[] = [];
  const writeInitial = process.stderr.write.bind(process.stderr);
  (process as unknown as { exit: (n: number) => void }).exit = (n: number) => { sorties.push(n); };
  process.stderr.write = ((l: string) => { ecrit.push(String(l)); return true; }) as typeof process.stderr.write;
  try {
    process.argv = ["node", "x.ts", "--cases=20", "--llm"];
    refuserDrapeauxInconnus(["--cases", "--llm"]);
    assert.deepEqual(sorties, [], "un drapeau connu ne doit pas faire sortir la commande");

    process.argv = ["node", "x.ts", "--llm", "--fields"];
    refuserDrapeauxInconnus(["--cases", "--llm"]);
    assert.deepEqual(sorties, [2], "un drapeau inconnu doit faire sortir en 2");
    assert.match(ecrit.join(""), /--fields/, "le refus doit NOMMER le drapeau fautif");
    assert.doesNotMatch(ecrit.join("").split("This command accepts")[0]!, /--llm/,
      "le refus ne doit pas accuser un drapeau qui est connu");
    assert.match(ecrit.join(""), /--cases/, "le refus doit lister ce qui existe : sinon le lecteur devine");

    /* Le compteur est remis à zéro : sans ça, `deepEqual(sorties, [2])` passait que `--`
       ait déclenché ou non, puisqu'un 2 y était déjà. Un témoin qui ne peut pas échouer
       n'est pas un témoin. */
    sorties.length = 0;
    process.argv = ["node", "x.ts", "--"];
    refuserDrapeauxInconnus(["--cases"]);
    assert.deepEqual(sorties, [], "`--` seul est le séparateur de npm, pas un drapeau");
  } finally {
    process.argv = argvInitial;
    (process as unknown as { exit: typeof exitInitial }).exit = exitInitial;
    process.stderr.write = writeInitial;
  }
});
