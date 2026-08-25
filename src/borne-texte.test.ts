import { test } from "node:test";
import assert from "node:assert/strict";
import { bornerTexte, PLAFOND_TEXTE, FENETRE_JETONS, CARACTERES_PAR_JETON } from "./your-cases.ts";
import { generateRecords } from "./corpus.ts";

/*
 * LA BORNE NE DOIT RIEN COÛTER SUR DES DONNÉES NORMALES, ET DOIT TENIR SUR L'ANORMAL.
 *
 * Elle existe parce que l'extraction croît linéairement avec la longueur du texte — environ
 * 44 Mo par mégaoctet, mesuré — et qu'une cellule de 20 Mo coûte près d'un gigaoctet sur la
 * machine du client. Elle ne retire rien parce que les extracteurs lisent au plus 512 jetons.
 */

test("le chiffre de la borne se dérive de la fenêtre du modèle, il n'est pas choisi", () => {
  assert.equal(PLAFOND_TEXTE, FENETRE_JETONS * CARACTERES_PAR_JETON,
    "le plafond doit rester le produit de la fenêtre lue et de la marge mesurée : "
    + "un chiffre écrit à la main ici cesserait de suivre le modèle.");
  assert.equal(FENETRE_JETONS, 512,
    "512 est `max_position_embeddings` lu dans le config.json du modèle. S'il change, "
    + "c'est le modèle qui a changé, et la borne doit suivre — pas l'inverse.");
});

test("aucun document du corpus n'est borné", () => {
  const corpus = generateRecords(400, "heldout");
  assert.ok(corpus.length >= 100, `${corpus.length} document(s) : le corpus ne se lit plus.`);
  const bornes = corpus.filter((d) => bornerTexte(d.text).ecarte > 0);
  assert.deepEqual(bornes.map((d) => d.id), [],
    `${bornes.length} document(s) normaux seraient tronqués — la borne coûterait de la mesure. `
    + `Le plus long du corpus fait ${Math.max(...corpus.map((d) => d.text.length))} caractères.`);
});

test("un texte démesuré est borné, et l'écart est rendu", () => {
  const texte = "x".repeat(PLAFOND_TEXTE * 3 + 17);
  const r = bornerTexte(texte);
  assert.equal(r.texte.length, PLAFOND_TEXTE, "le texte borné doit faire exactement le plafond.");
  assert.equal(r.ecarte, texte.length - PLAFOND_TEXTE,
    "l'écart rendu doit être ce qui a été retiré : c'est le chiffre que la sortie annonce.");
  assert.equal(r.texte, texte.slice(0, PLAFOND_TEXTE), "on garde le DÉBUT, qui est ce que le modèle lit.");
});

test("exactement au plafond, rien n'est retiré", () => {
  /* La borne au caractère près. `>=` au lieu de `>` couperait un texte qui tient, et
     personne ne le verrait : le compte annoncé dirait « 1 cas borné » sur un cas entier. */
  const pile = "y".repeat(PLAFOND_TEXTE);
  assert.equal(bornerTexte(pile).ecarte, 0, "un texte exactement au plafond ne doit pas être touché.");
  assert.equal(bornerTexte(pile + "z").ecarte, 1, "un caractère de plus doit en retirer exactement un.");
});

test("la commande ANNONCE ce qu'elle a borné, et le compte est juste", { timeout: 300_000 }, async () => {
  /*
   * LE SITE D'APPEL, PAS LA FONCTION.
   *
   * Les cas ci-dessus éprouvent `bornerTexte`. Aucun ne tomberait si quelqu'un retirait son
   * appel de la boucle d'extraction — c'est-à-dire si le défaut d'origine revenait. C'est la
   * faute exacte qu'une session voisine a relevée dans une autre garde aujourd'hui : la
   * mutation qui l'éprouve doit être celle du défaut, pas celle qui tombe sous la main.
   *
   * Ce cas lance la commande sur un fichier dont une cellule dépasse le plafond, et exige que
   * la sortie le DISE avec son compte. Il tombe si l'appel disparaît.
   */
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");

  const d = mkdtempSync(join(tmpdir(), "borne-"));
  const surplus = 4_242;
  const texte = "x".repeat(PLAFOND_TEXTE + surplus);
  writeFileSync(join(d, "cas.csv"), `id,text,name\n1,"${texte}",A\n`);

  const r = spawnSync("node", [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
    `--cases=${join(d, "cas.csv")}`, "--sample=1"], { encoding: "utf8", timeout: 280_000 });
  const sortie = (r.stdout ?? "") + (r.stderr ?? "");

  assert.match(sortie, /1 case\(s\) had their text cut/,
    `la troncature n'est pas annoncée. Sortie :\n${sortie.slice(-600)}`);
  assert.match(sortie, new RegExp(`${surplus.toLocaleString("en-GB")} character\\(s\\) set aside`),
    `le compte annoncé n'est pas celui qui a été retiré (${surplus} attendus).`);

  /* LE PENDANT : un fichier normal ne doit RIEN annoncer, sinon l'avis crierait toujours et
     personne ne le lirait. */
  writeFileSync(join(d, "normal.csv"), `id,text,name\n1,"Anna Petrova — dob 3 May 1990",Anna Petrova\n`);
  const r2 = spawnSync("node", [fileURLToPath(new URL("./your-cases.ts", import.meta.url)),
    `--cases=${join(d, "normal.csv")}`, "--sample=1"], { encoding: "utf8", timeout: 280_000 });
  assert.doesNotMatch((r2.stdout ?? "") + (r2.stderr ?? ""), /had their text cut/,
    "un fichier normal ne doit rien faire annoncer.");
});
