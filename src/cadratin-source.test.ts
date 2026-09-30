/*
 * F11 (2026-09-30): THE STATIC GUARD, BECAUSE A RUNTIME GUARD ONLY SEES THE BRANCHES IT RUNS.
 *
 * The end-to-end guard of F10 (cadratin-sorties.test.ts) fired on the integration, on a
 * sentence measure:yours prints only when a local tier answers out of shape: this machine
 * has no weights, so the branch never ran here, and the survey had missed the file. Second
 * time a runtime guard missed a branch it never executed. This one does not execute anything:
 * it walks the import graph of measure:yours and grade, every module they reach, statically
 * or through a dynamic import, and reads every string and template literal with the
 * TypeScript scanner, comments left aside. Any U+2014 in one of them fails, with file:line.
 *
 * What it leaves, each named with its reason and each checked to still be needed: the
 * synthetic corpora the published figures were measured on (a dash inside a document is the
 * document's, and a changed corpus is a changed measurement); the shared comparison module,
 * a copy of identite that is fixed at the source; and the two modules of the failures
 * gallery's hashed import closure, whose rewrite is prepared and waits for `npm run figures`
 * on a machine with the weights. An entry whose module no longer carries a dash in a string
 * is stale, and the guard says so: a list that outlives its reason is the empty green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const CADRATIN = "\u2014";
const RACINE = fileURLToPath(new URL("..", import.meta.url));

type Trouvee = { fichier: string; ligne: number; texte: string };

function lire(chemin: string): ts.SourceFile {
  const genre = /\.(ts|mts)$/.test(chemin) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(chemin, readFileSync(chemin, "utf8"), ts.ScriptTarget.Latest, true, genre);
}

/** The relative modules a file imports: static, re-exported, or through `import("...")`. */
function importsDe(sf: ts.SourceFile, chemin: string): string[] {
  const cibles: string[] = [];
  const ajouter = (spec: string): void => {
    if (!spec.startsWith(".")) return;
    const base = resolve(dirname(chemin), spec);
    for (const c of [base, `${base}.ts`, `${base}.mts`, `${base}.mjs`, `${base}.js`]) {
      if (existsSync(c) && /\.(ts|mts|mjs|js)$/.test(c)) { cibles.push(c); return; }
    }
  };
  const visiter = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) ajouter(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) ajouter(n.arguments[0].text);
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return cibles;
}

/** Every module reachable from the roots, the roots included, in import order. */
export function modulesAtteignables(racines: readonly string[]): string[] {
  const vus = new Set<string>();
  const file = racines.map((r) => resolve(r));
  while (file.length > 0) {
    const c = file.shift()!;
    if (vus.has(c)) continue;
    vus.add(c);
    for (const i of importsDe(lire(c), c)) if (!vus.has(i)) file.push(i);
  }
  return [...vus];
}

/** The string and template literals of one module that carry an em dash, with their line. */
export function cadratinsDansLesChaines(chemin: string): Trouvee[] {
  const sf = lire(chemin);
  const trouvees: Trouvee[] = [];
  const noter = (n: ts.Node, texte: string): void => {
    if (!texte.includes(CADRATIN)) return;
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    trouvees.push({ fichier: chemin, ligne: line + 1, texte: texte.trim().slice(0, 100) });
  };
  const visiter = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) noter(n, n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) noter(n, n.text);
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return trouvees;
}

const RACINES = ["src/your-cases.ts", "src/grade.ts"].map((r) => join(RACINE, r));

/**
 * Reached, read, and left as they are: the reason, and the remedy where one is ours.
 * Checked below to still carry a dash in a string; an entry that no longer does must go.
 */
const LAISSES: Record<string, string> = {
  "src/corpus.ts": "the synthetic documents the published figures were measured on; a dash inside a document is the document's, and a changed corpus is a changed measurement",
  "src/corpus-dur.ts": "the hard corpus, measured and published the same way",
  "src/comparaison-appariee.ts": "shared, a copy of identite (couche-identite.test.ts): its three sentences are fixed at the source, then recopied",
  "src/tiers.ts": "in the failures gallery's hashed import closure (failures.ts, modulesAtteints): the rewrite of its seven messages is prepared (f11-closure-rewrites.patch) and needs `npm run figures` with the weights in the same commit; EXEMPLE_DOC stays, it is prompt data",
  "src/journal.ts": "in the same closure: four messages, same patch, same remedy",
};

test("F11: no string literal in any module measure:yours or grade can reach carries an em dash, the named modules aside", () => {
  const modules = modulesAtteignables(RACINES);
  assert.ok(modules.length >= 20, `${modules.length} module(s) reached: the walk did not follow the imports`);
  for (const attendu of ["src/tiers.ts", "src/poids.ts", "src/comparaison-appariee.ts", "src/forme-rendue.ts", "src/vendors.ts"]) {
    assert.ok(modules.includes(join(RACINE, attendu)), `${attendu} is not reached: the walk misses a module measure:yours or grade imports`);
  }
  const parFichier = new Map<string, Trouvee[]>();
  for (const m of modules) {
    const t = cadratinsDansLesChaines(m);
    if (t.length > 0) parFichier.set(relative(RACINE, m).split("\\").join("/"), t);
  }
  const aCorriger = [...parFichier.entries()].filter(([f]) => !(f in LAISSES))
    .flatMap(([f, t]) => t.map((x) => `${f}:${x.ligne}: ${x.texte}`));
  assert.deepEqual(aCorriger, [], `${aCorriger.length} string(s) a reader of measure:yours or grade can see carry an em dash:\n  ${aCorriger.join("\n  ")}\n  Rewrite the sentence: a colon or a full stop, never a hyphen in the dash's place.`);
  for (const [f, raison] of Object.entries(LAISSES)) {
    assert.ok(modules.includes(join(RACINE, f)), `${f} is listed as left aside but is no longer reached: remove the entry (${raison.slice(0, 40)}...)`);
    assert.ok((parFichier.get(f)?.length ?? 0) > 0, `${f} is listed as left aside but no longer carries a dash in a string: remove the entry, the reason has expired`);
  }
});

test("F11: the static guard bites: a dash planted in a string of a reachable module is named with its line, one in a comment is not, one in a module nobody imports is not seen", () => {
  const d = mkdtempSync(join(tmpdir(), "cadratin-source-"));
  try {
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "a.ts"), [
      `import { b } from "./b.ts";`,
      `export { c } from "./sub/c.ts";`,
      `export async function tout() { const m = await import("./d.mjs"); return [b, m.d]; }`,
      `// a comment with a dash ${CADRATIN} stays a comment`,
      `/* and a block one ${CADRATIN} too */`,
      `export const propre = "no dash here";`,
    ].join("\n"));
    writeFileSync(join(d, "b.ts"), [
      `/* the dash below is in a string, on line 3 */`,
      `export const b = 1;`,
      `export const phrase = "a sentence ${CADRATIN} with a dash";`,
    ].join("\n"));
    writeFileSync(join(d, "sub", "c.ts"), [
      `export const c = \`head \${1} middle ${CADRATIN} tail\`;`,
    ].join("\n"));
    writeFileSync(join(d, "d.mjs"), [
      `// dynamic import, JavaScript: ${CADRATIN} in this comment only`,
      `export const d = 'plain';`,
      `export const e = 'dash ${CADRATIN} in a JavaScript string';`,
    ].join("\n"));
    writeFileSync(join(d, "orphan.ts"), `export const o = "${CADRATIN} nobody imports this module";`);

    const modules = modulesAtteignables([join(d, "a.ts")]).map((m) => relative(d, m).split("\\").join("/")).sort();
    assert.deepEqual(modules, ["a.ts", "b.ts", "d.mjs", "sub/c.ts"], "static, re-exported and dynamic imports are followed; the orphan is not");

    const trouvees = modules.flatMap((m) => cadratinsDansLesChaines(join(d, m))).map((t) => `${relative(d, t.fichier).split("\\").join("/")}:${t.ligne}`);
    assert.deepEqual(trouvees.sort(), ["b.ts:3", "d.mjs:3", "sub/c.ts:1"],
      "the planted dashes in strings are named with their line; the ones in comments are not");
    /* And the same scanner sees nothing where there is nothing: the counter-proof. */
    writeFileSync(join(d, "b.ts"), `export const b = 1;\nexport const phrase = "a sentence: with a colon"; // ${CADRATIN} comment`);
    assert.deepEqual(cadratinsDansLesChaines(join(d, "b.ts")), []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
