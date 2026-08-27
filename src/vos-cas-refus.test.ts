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

test("deux lignes portant le même identifiant sont refusées, avec leurs numéros de ligne", () => {
  /*
   * Un doublon d'export ordinaire comptait DEUX verdicts pour UN document : bons=2/2 sur une
   * chaîne notée sur un seul cas, « every identifier matches » affiché. L'exactitude d'une
   * chaîne CLIENTE se calculait fausse en silence — le chiffre que l'acheteur regarde.
   */
  const d = bac();
  const f = join(d, "doublon.csv");
  writeFileSync(f, 'id,text,name\n7,"Anna Petrova",Anna\n8,"Boris Ivanov",Boris\n7,"Clara Diaz",Clara\n');
  const r = lancer([CMD, `--cases=${f}`]);
  exigerRefus(r, /duplicate case identifier.*"7" \(rows 2, 4\)/,
    "un identifiant en double doit être refusé en nommant l'id ET ses lignes");
  assert.match(r.texte, /Nothing was measured/,
    "le refus ne dit pas que rien n'a été mesuré.");
});

test("une cellule id manquante reçoit un id qui ne peut PAS collisionner avec un id réel", () => {
  /* Le secours était String(i+1) : la ligne 3 sans id devenait « 3 », et un id réel « 3 »
     ailleurs dans le fichier en faisait un doublon fabriqué par NOTRE lecture. */
  const d = bac();
  const f = join(d, "sans-id.csv");
  writeFileSync(f, 'id,text,name\n3,"Anna Petrova",Anna\n,"Boris Ivanov",Boris\n');
  /* Pas de point d'arrêt disponible ici : deux cas passent toutes les gardes et la commande
     mesurerait. On la borne à 15 s — la lecture du CSV, où vit la garde éprouvée, tient en
     millisecondes, et on ne regarde que ce qu'elle a DIT. */
  const r = lancer([CMD, `--cases=${f}`], { msMax: 15_000 });
  assert.doesNotMatch(r.texte, /duplicate case identifier/,
    "la lecture fabrique elle-même un doublon : l'id de secours collisionne avec un id réel.");
});

test("un nom de chaîne égal à un nom de palier est refusé — sa ligne serait écrasée", () => {
  /* « small » est un nom naturel pour « ma chaîne au petit modèle » — et la boucle des paliers
     écrivait releve[champ]["small"] PAR-DESSUS la ligne du client : sa chaîne disparaissait du
     tableau sans un mot. */
  const d = bac();
  const f = join(d, "cas.csv");
  writeFileSync(f, 'id,text,name\n1,"Anna Petrova",Anna\n');
  const so = join(d, "sorties.json");
  writeFileSync(so, JSON.stringify({ nom: "small", issues: { name: { "1": "clean" } } }));
  exigerRefus(lancer([CMD, `--cases=${f}`, `--sorties=${so}`]),
    /"nom" is "small", which is one of our tier names/,
    "un nom qui collisionne avec un palier doit être refusé");
});

test("un chiffre déclaré en chaîne est refusé à l'entrée, pas découvert à l'affichage", () => {
  /* "msParDocument": "45" — JSON écrit à la main — faisait dire « declared by you » à
     l'en-tête pendant que chaque ligne imprimait « no declared duration » : deux lecteurs du
     même champ, deux verdicts. */
  const d = bac();
  const f = join(d, "cas.csv");
  writeFileSync(f, 'id,text,name\n1,"Anna Petrova",Anna\n');
  const so = join(d, "sorties.json");
  writeFileSync(so, JSON.stringify({ nom: "ma-chaine", issues: { name: { "1": "clean" } },
    declares: { msParDocument: "45" } }));
  const r = lancer([CMD, `--cases=${f}`, `--sorties=${so}`]);
  exigerRefus(r, /declares\.msParDocument is "45", not a finite number/,
    "une durée déclarée en chaîne doit être refusée en nommant le champ");
  assert.match(r.texte, /write msParDocument: 45/,
    "le refus ne montre pas la forme juste : un refus sans issue se contourne.");
});

test("les numéros de ligne annoncés sont ceux du FICHIER, pas des index de parseur", () => {
  /* Un texte cité sur trois lignes décale tous les index : « line 7 » désignait la ligne 9 du
     fichier, et le client cherchait au mauvais endroit dans son propre export. */
  const d = bac();
  const f = join(d, "multi.csv");
  writeFileSync(f, 'id,text,name,extra\n1,"ligne un\nligne deux\nligne trois",Anna\n2,"court",Boris,Trop,DeColonnes\n');
  const r = lancer([CMD, `--cases=${f}`], { msMax: 15_000 });
  assert.match(r.texte, /row 5|line 5|ligne 5/i,
    `la ligne écartée est à la ligne 5 du fichier (après un texte cité de 3 lignes) :\n`
    + `  ${JSON.stringify(r.texte.match(/.{0,60}(row|line|ligne) \d+.{0,20}/i)?.[0] ?? r.texte.slice(0, 200))}`);
});
