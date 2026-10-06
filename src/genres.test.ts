/**
 * LES GENRES : LES ÉCRIVAINS DISENT LE NOM NEUF, LES LECTEURS ENTENDENT LES DEUX.
 *
 * Ce que chaque cas ferme :
 *   - un lecteur qui n'accepterait que « crusetra-… » refuserait les relevés scellés que ce
 *     dépôt livre lui-même, et ceux que nos clients tiennent déjà : on le prouve sur les
 *     fichiers COMMITÉS, jamais réécrits, dont le scellé et la signature tiennent encore ;
 *   - un écrivain qui retaperait « cascade-… » à la main émettrait l'ancien nom sans que rien
 *     ne le dise : la source est balayée ;
 *   - un lecteur trop large (n'importe quel suffixe, n'importe quelle casse) laisserait
 *     entrer un fichier qui n'est pas ce qu'il croit lire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENRES, ancienGenre, estDuGenre } from "./genres.ts";
import { chargerBaselineDepuis } from "./recertify.ts";
import { readProfiles } from "./measure.ts";
import { chargerSorties } from "./your-cases.ts";
import { readListPrices } from "./audit.ts";
import { empreinteDuReleve, scelleIntact } from "./empreinte.ts";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel: string): string => readFileSync(join(racine, rel), "utf8");

test("chaque genre a deux noms, et seulement deux", () => {
  for (const g of Object.values(GENRES)) {
    assert.match(g, /^crusetra-[a-z-]+$/, `${g} : un écrivain doit émettre le nom neuf`);
    const ancien = ancienGenre(g);
    assert.equal(ancien, g.replace("crusetra-", "cascade-"));
    assert.ok(estDuGenre(g, g) && estDuGenre(ancien, g), `${g} : l'un des deux noms est refusé`);
    for (const faux of [`${g}-x`, `x-${g}`, g.toUpperCase(), ancien.toUpperCase(), g.replace("crusetra-", ""), undefined, null, 1]) {
      assert.equal(estDuGenre(faux, g), false, `${String(faux)} passe pour ${g}`);
    }
  }
  assert.equal(estDuGenre(GENRES.recertification, GENRES.releveClient), false, "un genre en accepte un autre");
});

test("aucun écrivain ne retape un genre à la main, ni sous l'ancien nom ni sous le neuf", () => {
  /* Les genres viennent de genres.ts. Un littéral « cascade-client-record » dans un module
     émettrait l'ancien nom ; un littéral « crusetra-… » ferait deux sources d'un même nom. */
  const suffixes = Object.values(GENRES).map((g) => g.replace("crusetra-", ""));
  const motif = new RegExp(`["'\`](?:cascade|crusetra)-(?:${suffixes.join("|")})["'\`]`);
  const fautes: string[] = [];
  const modules = readdirSync(join(racine, "src")).filter((n) => /\.(ts|mjs)$/.test(n) && !/\.test\.(ts|mjs)$/.test(n) && n !== "genres.ts");
  assert.ok(modules.length > 50, `${modules.length} modules lus : le balayage ne regarde pas le dépôt`);
  for (const n of modules) {
    lire(`src/${n}`).split("\n").forEach((l, i) => { if (motif.test(l)) fautes.push(`src/${n}:${i + 1}  ${l.trim()}`); });
  }
  assert.deepEqual(fautes, [], "un genre est tapé à la main au lieu d'être pris dans genres.ts");
  /* Le témoin : le motif voit bien ce qu'il cherche. */
  assert.ok(motif.test('kind: "cascade-client-record",') && motif.test("kind: 'crusetra-outcomes'"));
});

test("un relevé client COMMITÉ sous l'ancien genre se lit encore, scellé et signé comme au premier jour", () => {
  const nom = "examples/cord-receipts/cord-labels-grouped-measured.json";
  const brut = lire(nom);
  const r = JSON.parse(brut) as Record<string, unknown>;
  assert.equal(r.kind, "cascade-client-record", "ce cas prouve l'ANCIEN genre : il lui faut un relevé scellé avant le changement de nom");
  const b = chargerBaselineDepuis(brut, nom);
  assert.equal(b.empreinte, "ac7d0adbe4907caf");
  assert.ok(scelleIntact(r), "le scellé du relevé commité ne tient plus : il a été réécrit");
  const sig = JSON.parse(lire(nom.replace(/\.json$/, ".signature.json"))) as { valeur: string };
  assert.ok(verify(null, Buffer.from(String(r.empreinte), "utf8"), createPublicKey(lire("cle-publique.pem")), Buffer.from(sig.valeur, "base64")),
    "la signature du relevé commité ne vérifie plus");
});

test("le relevé du banc COMMITÉ sous l'ancien genre se lit et se vérifie", () => {
  const nom = "profiles-2026-08-20-coeur-rendu.json";
  const p = readProfiles(join(racine, nom)) as unknown as Record<string, unknown>;
  assert.equal(p.kind, "cascade-routing-record");
  assert.ok(estDuGenre(p.kind, GENRES.releveRoutage));
  assert.equal(p.empreinte, "dbf26abec438515e");
});

test("des issues COMMITÉES sous l'ancien genre se lisent", () => {
  const nom = join(racine, "examples/cord-receipts/cord-google-outcomes.json");
  assert.equal((JSON.parse(readFileSync(nom, "utf8")) as { kind: string }).kind, "cascade-outcomes");
  const s = chargerSorties(nom);
  assert.equal(s.nom, "google-expense");
  assert.ok(Object.keys(s.issues).length >= 3);
});

test("une référence de recertification et une table de prix se lisent sous les deux noms, et pas sous un troisième", () => {
  const d = mkdtempSync(join(tmpdir(), "genres-"));
  /* La recertification : on prend le relevé commité, on lui donne chaque genre, on le re-scelle. */
  const base = JSON.parse(lire("examples/cord-receipts/cord-labels-grouped-measured.json")) as Record<string, unknown>;
  for (const kind of [GENRES.releveClient, ancienGenre(GENRES.releveClient), GENRES.recertification, ancienGenre(GENRES.recertification), "other-record"]) {
    const r: Record<string, unknown> = { ...base, kind };
    delete r.empreinte;
    r.empreinte = empreinteDuReleve(r);
    const accepte = kind !== "other-record";
    if (accepte) assert.equal(chargerBaselineDepuis(JSON.stringify(r), "r.json").kind, kind);
    else assert.throws(() => chargerBaselineDepuis(JSON.stringify(r), "r.json"), /is not a client record/);
  }
  /* La table des prix : la livrée porte le nom neuf ; une copie d'avant porte l'ancien. */
  assert.equal((JSON.parse(lire("vendor-prices.json")) as { kind: string }).kind, GENRES.prixCatalogue);
  const p = join(d, "prix.json");
  for (const kind of [GENRES.prixCatalogue, ancienGenre(GENRES.prixCatalogue)]) {
    writeFileSync(p, JSON.stringify({ kind, version: 1, readOn: "2026-09-29", currency: "USD", vendors: {} }));
    assert.equal(readListPrices(p).readOn, "2026-09-29", `${kind} : une table de prix refusée`);
  }
  writeFileSync(p, JSON.stringify({ kind: "crusetra-vendor-prices", version: 1, readOn: "2026-09-29", vendors: {} }));
  assert.throws(() => readListPrices(p), /not a vendor price table/);
});
