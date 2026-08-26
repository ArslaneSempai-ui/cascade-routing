/*
 * LES REFUS DE `measure:yours`, C'EST-À-DIRE CEUX QU'UN ACHETEUR RENCONTRE EN PREMIER.
 *
 * C'est la seule commande de ce dépôt qui tourne sur les dossiers de quelqu'un d'autre. Ses
 * refus ne protègent donc pas notre mesure : ils protègent SA lecture de sa propre mesure.
 * Le balayage du 26 août 2026 a montré qu'aucun cas ne les atteignait.
 *
 * Le plus important est celui du fichier sans enregistrements. Sans lui, un CSV qui ne porte
 * qu'une ligne d'en-tête produit un taux calculé sur zéro dossier — et **un taux sur zéro
 * dossier n'est pas un intervalle large, il n'existe pas.** L'acheteur lirait un chiffre. Le
 * refus lui dit en plus les deux causes qui le produisent, parce qu'un « rien lu » sans cause
 * envoie chercher dans le mauvais fichier.
 *
 * Le second protège son temps et son argent : au-dessus du plafond d'appels, la commande
 * refuse de démarrer plutôt que d'engager une passe dont personne n'a annoncé le coût.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";
import { PLAFOND_APPELS } from "./your-cases.ts";

const CMD = fileURLToPath(new URL("./your-cases.ts", import.meta.url));
const bac = () => mkdtempSync(join(tmpdir(), "vos-cas-"));

test("un fichier absent est refusé par son nom", () => {
  exigerRefus(lancer([CMD, "--cases=/tmp/ce-fichier-nexiste-pas-du-tout.csv"]),
    /no such file/, "un fichier absent doit être refusé");
});

test("un fichier sans enregistrement est refusé — un taux sur zéro dossier n'existe pas", () => {
  const d = bac();
  const f = join(d, "en-tete-seul.csv");
  writeFileSync(f, "id,text,name\n");
  const r = lancer([CMD, `--cases=${f}`]);
  /* Le message est celui de la garde qui se déclenche RÉELLEMENT, relevé en la lançant : il en
     existe une plus tôt que celle du relevé, et mieux formulée. Écrire le motif d'après le code
     qu'on croit atteindre plutôt que d'après la sortie observée, c'est éprouver une garde
     imaginaire — et le cas aurait dénoncé un refus parfaitement clair. */
  exigerRefus(r, /has a header line and no cases/,
    "un fichier sans ligne de données doit être refusé");
  assert.match(r.texte, /reads like\s+one that measured something/,
    "le refus ne dit pas POURQUOI un rapport sur zéro dossier est dangereux : sans cette phrase\n"
    + "  le lecteur croit à une mesure imprécise plutôt qu'absente.");
  assert.match(r.texte, /nothing was written/i,
    "le refus ne dit pas que rien n'a été écrit.");
});

test("au-dessus du plafond d'appels, la commande refuse de démarrer et n'écrit rien", () => {
  /* Le coût est imposé à l'acheteur, pas à nous. Une passe engagée sans que son ampleur soit
     annoncée est un coût qu'il découvre après. */
  const d = bac();
  const f = join(d, "beaucoup.csv");
  /* TROIS champs et non un : le compte est cases × champs × paliers. Ma première version
     prenait 4 000 lignes sur un seul champ — 8 000 appels, SOUS le plafond de 10 000 — donc la
     commande démarrait vraiment et le cas mourait sur sa borne de temps. Le refus se déclenche
     par le nombre d'APPELS, pas par la taille du fichier. */
  const lignes = ["id,text,name,dob,country"];
  for (let i = 0; i < 4000; i++) {
    lignes.push(`${i},"Anna Petrova — dob 3 May 1990, Bulgaria",Anna Petrova,1990-05-03,Bulgaria`);
  }
  writeFileSync(f, lignes.join("\n") + "\n");

  const r = lancer([CMD, `--cases=${f}`], { msMax: 60_000 });
  exigerRefus(r, /above [\d,]+ calls/, "une passe au-dessus du plafond doit être refusée");
  assert.equal(r.code, 3, `le code doit être 3 et non ${r.code} — une chaîne lit le code.`);
  assert.match(r.texte, /Nothing was written/,
    "le refus ne dit pas que rien n'a été écrit : l'acheteur ne sait pas si une passe a commencé.");
  assert.match(r.texte, /--yes-run-it/,
    "le refus ne dit pas comment passer outre — un refus sans issue se contourne.");
  assert.ok(PLAFOND_APPELS > 0, "le plafond exporté doit être lisible depuis un cas.");
});

test("un fichier de questions illisible est refusé, et le refus le nomme", () => {
  const d = bac();
  const f = join(d, "cas.csv");
  writeFileSync(f, "id,text,name\n1,\"Anna Petrova\",Anna\n");
  exigerRefus(lancer([CMD, `--cases=${f}`, "--questions=/tmp/questions-absentes.json"]),
    /no such file|cannot read/, "un fichier de questions absent doit être refusé");
});
