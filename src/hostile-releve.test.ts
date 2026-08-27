import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { page, verifierLeScelle, type Releve } from "./hostile.ts";
import { empreinteDuReleve } from "./measure.ts";

/*
 * LES TÉMOINS DU RELEVÉ.
 *
 * Séparés des témoins unitaires parce qu'ils lisent `corpus-hostile.json`, qui ne peut pas
 * exister avant le code qui le produit : la mesure exige un arbre propre, donc un commit.
 * Ce fichier arrive avec le relevé, dans le commit suivant.
 */

const RELEVE = fileURLToPath(new URL("../corpus-hostile.json", import.meta.url));
const PAGE = fileURLToPath(new URL("../CORPUS-HOSTILE.md", import.meta.url));

test("la page est engendrée du relevé, et le relevé dit quand il a été mesuré", () => {
  assert.ok(existsSync(RELEVE),
    "corpus-hostile.json est absent : lance `npm run hostile`. Ce cas ne doit pas être "
    + "assoupli — une page sans relevé est de la prose non mesurée.");
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Releve;
  assert.match(r.mesureLe, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(r.code.commit, /^[0-9a-f]{7,}$/);
  assert.equal(r.code.sale, false, "un relevé pris sur un arbre modifié porte une fausse provenance.");
  assert.equal(readFileSync(PAGE, "utf8"), page(r),
    "CORPUS-HOSTILE.md ne correspond plus au relevé : relance `npm run hostile`.");
});

test("la comparaison peut échouer — la page suit vraiment les chiffres", () => {
  /*
   * LE VERT VIDE ÉVITÉ. Le cas précédent passerait aussi si `page()` rendait une constante.
   * Ici on bouge un résultat et on EXIGE que la page bouge.
   */
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Releve;
  const avant = page(r);
  const cible = r.resultats.find((x) => !x.detourne);
  assert.ok(cible, "aucun résultat non détourné : ce cas ne peut plus rien muter.");
  cible.detourne = true;
  assert.notEqual(page(r), avant,
    "la page n'a pas bougé alors qu'un détournement a été ajouté : elle ne lit pas le relevé.");
});

test("la commande refuse un drapeau inconnu, et --check vérifie la page", { timeout: 120_000 }, () => {
  const cmd = fileURLToPath(new URL("./hostile.ts", import.meta.url));
  const inconnu = spawnSync("node", [cmd, "--tous"], { encoding: "utf8", timeout: 100_000 });
  assert.equal(inconnu.status, 2,
    `un drapeau inconnu doit être refusé, pas ignoré. Sortie :\n${inconnu.stderr?.slice(0, 400)}`);
  const check = spawnSync("node", [cmd, "--check"], { encoding: "utf8", timeout: 100_000 });
  assert.equal(check.status, 0,
    `\`--check\` échoue. Sortie :\n${(check.stdout ?? "") + (check.stderr ?? "")}`);
});

test("--check REFUSE une page qui a dérivé, et le refuse en s'arrêtant", { timeout: 120_000 }, () => {
  /*
   * LE CHEMIN ROUGE DU REFUS, QUE RIEN NE REGARDAIT.
   *
   * Le cas ci-dessus n'éprouve que le vert : `--check` sur une page conforme rend 0. Il
   * resterait vert si le refus était retiré, si `process.exit(1)` devenait `process.exit(0)`,
   * ou si la comparaison rendait toujours vrai. Et le balayage des gardes ne peut pas
   * compenser : il ne mute que `throw new Error(`, et cette garde-ci est un `process.exit`.
   * Une session voisine me l'a signalé — « zéro survivant » sur un fichier qui ne garde pas
   * par `throw` ne dit rien du tout.
   *
   * Le témoin travaille sur des COPIES dans un dossier temporaire. Abîmer la vraie page le
   * temps de la mesure ferait refuser le commit d'une autre session — c'est arrivé
   * aujourd'hui dans l'autre sens, et un contrôle ne doit pas coûter ça pour exister.
   */
  const cmd = fileURLToPath(new URL("./hostile.ts", import.meta.url));
  const d = mkdtempSync(join(tmpdir(), "hostile-check-"));
  const releve = join(d, "releve.json");
  const page = join(d, "page.md");
  copyFileSync(RELEVE, releve);
  copyFileSync(PAGE, page);

  /* Le témoin positif d'abord : sur des copies fidèles, le contrôle passe. Sans lui, le rouge
     ci-dessous pourrait venir du dossier temporaire et non de la dérive. */
  const sain = spawnSync("node", [cmd, "--check", `--releve=${releve}`, `--page=${page}`],
    { encoding: "utf8", timeout: 100_000 });
  assert.equal(sain.status, 0,
    `des copies fidèles doivent passer. Sortie :\n${(sain.stdout ?? "") + (sain.stderr ?? "")}`);

  /* Une seule ligne déplacée : c'est la dérive la plus discrète qu'on puisse écrire. */
  writeFileSync(page, readFileSync(page, "utf8").replace("## Per tier", "## Per  tier"));
  const derive = spawnSync("node", [cmd, "--check", `--releve=${releve}`, `--page=${page}`],
    { encoding: "utf8", timeout: 100_000 });
  assert.equal(derive.status, 1,
    "une page qui a dérivé doit faire ÉCHOUER la commande, pas seulement afficher un avis. "
    + `Sortie :\n${(derive.stdout ?? "") + (derive.stderr ?? "")}`);
  assert.match((derive.stderr ?? "") + (derive.stdout ?? ""), /no longer matches/,
    "et le refus doit dire ce qui ne correspond plus, sinon le lecteur cherche à l'aveugle.");

  rmSync(d, { recursive: true, force: true });
});


/*
 * LE RELEVÉ COMME LIVRABLE : IL PORTE SON SCELLÉ, OU IL NE SE PUBLIE PAS.
 *
 * `--check` refusait une PAGE qui avait dérivé de son relevé. Rien ne disait que le RELEVÉ
 * n'avait pas bougé : un taux de détournement changé à la main dans le JSON produisait une page
 * parfaitement cohérente avec lui, et le contrôle la déclarait à jour. Le corpus dur porte ce
 * scellé depuis longtemps ; celui-ci vivait sans.
 *
 * Les trois refus sont éprouvés SÉPARÉMENT, et chacun avec son pendant vert : une garde dont on
 * n'a jamais vu le vert peut refuser tout, et une garde dont on n'a jamais vu le rouge peut
 * n'avoir jamais regardé.
 */
test("un relevé sans scellé est refusé, et le refus nomme ce qui manque", () => {
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Record<string, unknown>;

  /* TÉMOIN POSITIF D'ABORD : intact, il passe. Sans lui, une garde qui refuse tout satisferait
     les trois refus ci-dessous sans rien garder. */
  assert.doesNotThrow(() => verifierLeScelle(r, RELEVE),
    "le relevé livré est refusé par sa propre garde : elle a coûté la mesure au lieu de la garder.");

  for (const champ of ["empreinte", "mesureLe"] as const) {
    const ampute = { ...r };
    delete ampute[champ];
    assert.throws(() => verifierLeScelle(ampute, RELEVE),
      (e: Error) => e.message.includes(champ) && /npm run hostile/.test(e.message),
      `retirer \`${champ}\` doit faire REFUSER, en nommant le champ et en disant quoi lancer — `
      + "un refus sans issue écrite finit commenté par le premier qui le rencontre.");
  }

  /* La provenance aussi : un relevé sans commit ne se rejoue pas. */
  const sansCommit = { ...r, code: { sale: false } };
  assert.throws(() => verifierLeScelle(sansCommit, RELEVE), /code\.commit/,
    "un relevé sans commit de provenance doit être refusé : personne ne peut le rejouer.");
});

test("un relevé modifié après son scellé est refusé, et le refus donne les deux empreintes", () => {
  const r = JSON.parse(readFileSync(RELEVE, "utf8")) as Releve;

  /* LE DÉFAUT EXACT QUE CECI FERME : un chiffre changé à la main. On prend le plus tentant —
     un détournement qu'on ferait disparaître avant de montrer la page à un acheteur. */
  const cible = r.resultats.find((x) => x.detourne);
  assert.ok(cible, "aucun détournement dans le relevé : ce cas n'a rien à falsifier, et son "
    + "rouge ne prouverait plus ce qu'il prétend.");
  cible.detourne = false;

  assert.throws(() => verifierLeScelle(r, RELEVE),
    (e: Error) => /edited since it was sealed/.test(e.message)
      && e.message.includes(empreinteDuReleve(r)),
    "un relevé dont un chiffre a bougé doit être refusé, et le refus doit porter l'empreinte "
    + "calculée — sans elle, le lecteur ne peut pas savoir laquelle des deux est la sienne.");
});

test("--check REFUSE un relevé descellé, à la commande et pas seulement en fonction",
  { timeout: 120_000 }, () => {
  /*
   * LE SITE D'APPEL. Les deux cas ci-dessus éprouvent `verifierLeScelle`. Ils resteraient verts
   * si `--check` cessait de l'appeler — c'est-à-dire si le défaut d'origine revenait : une page
   * contrôlée contre un relevé que personne ne vérifie. Le refus doit sortir de la COMMANDE.
   */
  const cmd = fileURLToPath(new URL("./hostile.ts", import.meta.url));
  const d = mkdtempSync(join(tmpdir(), "hostile-scelle-"));
  const releve = join(d, "releve.json");
  const pageCopie = join(d, "page.md");
  copyFileSync(RELEVE, releve);
  copyFileSync(PAGE, pageCopie);

  const lancer = () => spawnSync("node", [cmd, "--check", `--releve=${releve}`, `--page=${pageCopie}`],
    { encoding: "utf8", timeout: 100_000 });

  try {
    /* Témoin positif : les copies fidèles passent, scellé compris. */
    const sain = lancer();
    assert.equal(sain.status, 0,
      `des copies fidèles doivent passer. Sortie :\n${(sain.stdout ?? "") + (sain.stderr ?? "")}`);

    /* Le scellé retiré : la commande doit s'arrêter. */
    const r = JSON.parse(readFileSync(releve, "utf8")) as Record<string, unknown>;
    delete r["empreinte"];
    writeFileSync(releve, JSON.stringify(r, null, 2) + "\n");
    const descelle = lancer();
    assert.notEqual(descelle.status, 0,
      "un relevé sans scellé laisse la commande conclure : la page est contrôlée contre un "
      + `fichier que personne ne vérifie. Sortie :\n${(descelle.stdout ?? "") + (descelle.stderr ?? "")}`);
    assert.match((descelle.stderr ?? "") + (descelle.stdout ?? ""), /is not sealed/,
      "et le refus doit dire que le relevé n'est pas scellé, pas planter sur autre chose.");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
