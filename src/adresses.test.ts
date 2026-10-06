/**
 * LES ADRESSES NE SE RETAPENT PAS, ET LES ANCIENNES NE REVIENNENT PAS.
 *
 * Le 5 octobre 2026, cascade-routing.com devient crusetra.com, et le dépôt devient
 * crusetra-routing. Une adresse tapée à deux endroits change à un seul la fois suivante ;
 * une ancienne qui revient envoie un client vers une page qui ne répond plus. Les adresses
 * vivent dans `adresses.ts`, le README dit les mêmes, et la page publiée aussi.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTACT, DEPOT, PAGES, PAGE_ENGAGEMENT, SITE } from "./adresses.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel: string): string => readFileSync(join(racine, rel), "utf8");

/** Toute adresse publique de l'outil, ancienne ou neuve, telle qu'elle s'écrirait en clair. */
const ADRESSE = /(?:crusetra|cascade-routing)\.com|github\.com\/ArslaneSempai-ui\/(?:crusetra|cascade)-routing|arslanesempai-ui\.github\.io\/(?:crusetra|cascade)-routing/i;
const ANCIENNE = /cascade-routing\.com|github\.com\/ArslaneSempai-ui\/cascade-routing|arslanesempai-ui\.github\.io\/cascade-routing/i;
/** Une ligne de commentaire : elle peut citer une adresse, elle ne l'émet pas. */
const commentaire = (l: string): boolean => /^\s*(?:\*|\/\/|\/\*)/.test(l);

test("les adresses sont celles du nom neuf", () => {
  assert.equal(SITE, "https://crusetra.com");
  assert.equal(PAGE_ENGAGEMENT, "https://crusetra.com/engagement.html");
  assert.equal(CONTACT, "contact@crusetra.com");
  assert.equal(DEPOT, "https://github.com/ArslaneSempai-ui/crusetra-routing");
  assert.equal(PAGES, "https://arslanesempai-ui.github.io/crusetra-routing/");
  for (const a of [SITE, CONTACT, DEPOT, PAGES]) assert.doesNotMatch(a, ANCIENNE);
});

test("aucun module ne retape une adresse : il l'importe d'adresses.ts", () => {
  const modules = readdirSync(join(racine, "src")).filter((n) => /\.(ts|mjs|js|html)$/.test(n) && !/\.test\.(ts|mjs)$/.test(n) && n !== "adresses.ts");
  assert.ok(modules.length > 50, `${modules.length} fichiers lus : le balayage ne regarde pas le dépôt`);
  const fautes: string[] = [];
  for (const n of modules) {
    lire(`src/${n}`).split("\n").forEach((l, i) => {
      if (!commentaire(l) && ADRESSE.test(l)) fautes.push(`src/${n}:${i + 1}  ${l.trim()}`);
    });
  }
  assert.deepEqual(fautes, [], "une adresse est tapée en clair dans le code au lieu d'être importée");
  /* Le témoin : le motif voit une adresse retapée, ancienne ou neuve, et passe un commentaire. */
  assert.ok(ADRESSE.test('sortie.push("is an engagement: https://cascade-routing.com/engagement.html");'));
  assert.ok(ADRESSE.test("const x = `https://crusetra.com/pricing`;"));
  assert.ok(commentaire(" *     git clone https://github.com/ArslaneSempai-ui/crusetra-routing && cd crusetra-routing"));
});

test("le README et la page publiée disent les mêmes adresses, et plus les anciennes", () => {
  const readme = lire("README.md");
  assert.ok(readme.includes(CONTACT), `le README ne donne plus ${CONTACT}`);
  assert.ok(readme.includes(PAGES), `le README ne renvoie plus à ${PAGES}`);
  const anciennes = readme.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => ANCIENNE.test(l));
  assert.deepEqual(anciennes, [], "le README renvoie encore à une ancienne adresse");
  const page = lire("docs/index.html");
  assert.ok(page.includes(`href="${DEPOT}"`), "la page publiée ne renvoie pas au dépôt d'adresses.ts : `npm run pages`");
  assert.doesNotMatch(page, ANCIENNE, "la page publiée renvoie encore à une ancienne adresse : `npm run pages`");
});
