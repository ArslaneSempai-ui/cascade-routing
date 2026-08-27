/**
 * UN CORPUS QUE NOUS N'AVONS PAS ÉCRIT.
 *
 * Source : la liste SDN de l'OFAC — la liste de sanctions officielle des États-Unis, celle
 * contre laquelle les équipes AML criblent réellement. Publique, officielle, gratuite, et sa
 * publication est sa raison d'être : il n'y a pas de question de vie privée à en tirer un
 * corpus.
 *
 * CE QUE ÇA CHANGE. Chaque chiffre qu'on vend est mesuré sur un corpus écrit par notre propre
 * générateur — donc sur les cas que NOUS avons imaginés, avec nos angles morts. Celui-ci a une
 * distribution qu'on n'a pas choisie : plusieurs passeports par personne, des préfixes « alt. »,
 * des pays entre parenthèses, des translittérations, des dates à formats mêlés.
 *
 * LA VÉRITÉ DE RÉFÉRENCE EST EXTRAITE PAR CE FICHIER, donc elle vaut ce que vaut cet analyseur.
 * C'est le risque central : mesurer notre outil contre notre propre lecture, et appeler ça une
 * mesure externe. Un échantillon est donc relu à la main avant que le moindre chiffre soit cité.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "node:path";

/*
 * ─── OÙ SONT LES FICHIERS DE L'OFAC, ET POURQUOI CE N'EST PLUS ÉCRIT EN DUR ───
 *
 * Cette ligne portait le chemin d'un bac à sable de session : `/private/tmp/claude-501/…/<id>`.
 * Ce dossier n'existe plus — il appartenait à une session terminée — donc ce script ne pouvait
 * plus tourner pour personne, y compris pour celui qui l'a écrit.
 *
 * Ce n'est pas un détail de confort. Ce fichier EXTRAIT la vérité de référence du seul corpus
 * que nous n'avons pas écrit, celui qui sert à mesurer nos règles hors de nos propres angles
 * morts. Un corpus dont la dérivation n'est pas rejouable n'est plus un corpus externe : c'est
 * un fichier qu'on nous demande de croire. Le CSV et sa provenance sont versionnés, mais la
 * chaîne qui va de la source publique à ce CSV était cassée.
 *
 * Le dossier se donne donc, et son absence est un REFUS qui dit quoi télécharger et où :
 *
 *     node corpus-externe/construire.mjs --donnees=/chemin/vers/les/csv
 *     OFAC_DONNEES=/chemin/vers/les/csv node corpus-externe/construire.mjs
 */
const D = (() => {
  const drapeau = process.argv.find((a) => a.startsWith("--donnees="))?.slice("--donnees=".length);
  const d = drapeau || process.env.OFAC_DONNEES;
  if (!d) {
    console.error(
      "\n  Where are the OFAC exports?\n\n"
      + "    --donnees=<folder>   or   OFAC_DONNEES=<folder>\n\n"
      + "  The folder must hold sdn.csv and sdn-add.csv, as published here:\n"
      + "    https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV\n"
      + "    https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADD.CSV\n\n"
      + "  This script downloads nothing. The source is public and its URL is recorded in\n"
      + "  corpus-externe/provenance.json, with the date of the reading that produced the\n"
      + "  versioned CSV.\n");
    process.exit(2);
  }
  if (!existsSync(d)) {
    console.error(`\n  ${d} does not exist. Nothing was read, nothing was written.\n`);
    process.exit(2);
  }
  return d;
})();

/* Un lecteur CSV minimal : le format de l'OFAC est simple mais porte des virgules citées. */
const lire = (f) => {
  const t = readFileSync(f, "utf8");
  const out = []; let champ = "", ligne = [], dans = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dans) { if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') dans = false; else champ += c; }
    else if (c === '"') dans = true;
    else if (c === ",") { ligne.push(champ.trim()); champ = ""; }
    else if (c === "\n") { ligne.push(champ.trim()); out.push(ligne); ligne = []; champ = ""; }
    else if (c !== "\r") champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ.trim()); out.push(ligne); }
  return out.filter((l) => l.length > 1);
};

const vide = (v) => !v || v === "-0-";
const sdn = lire(`${D}/sdn.csv`);
const adresses = new Map();
/* Le nom du fichier s'écrit, il ne se dérive pas d'un autre par remplacement : `.replace`
   agit sur la PREMIÈRE occurrence de la chaîne dans tout le chemin, donc un dossier contenant
   « add » — `/tmp/addendum` — produisait `/tmp/sdn-addendum/add.csv` et lisait autre chose en
   silence. Mesuré. */
for (const l of lire(`${D}/sdn-add.csv`)) {
  if (!adresses.has(l[0])) adresses.set(l[0], l);
}

/* Les remarques sont de la prose à points-virgules. On ne devine pas : chaque champ a son
   motif, et ce qui ne correspond pas reste vide plutôt que d'être approché. */
const dob = (r) => /DOB ([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/.exec(r)?.[1]
  ?? /DOB ([A-Za-z]{3} [0-9]{4})/.exec(r)?.[1] ?? /DOB ([0-9]{4})/.exec(r)?.[1] ?? "";
const doc = (r) => /Passport ([A-Z0-9-]{5,})/.exec(r)?.[1] ?? /National ID No\. ([A-Z0-9-]{5,})/.exec(r)?.[1] ?? "";
const pays = (r) => /nationality ([A-Za-z ]+?)[;.]/.exec(r)?.[1]?.trim()
  ?? /citizen ([A-Za-z ]+?)[;.]/.exec(r)?.[1]?.trim()
  ?? /POB [^;]*?,\s*([A-Za-z ]+?)[;.]/.exec(r)?.[1]?.trim() ?? "";

const cas = [];
for (const l of sdn) {
  if (l[2] !== "individual") continue;
  const r = l[11] ?? "";
  if (vide(r)) continue;
  const a = adresses.get(l[0]);
  const adresse = a && !vide(a[2]) ? [a[2], a[3], a[4]].filter((x) => !vide(x)).join(", ") : "";
  const c = { id: `OFAC-${l[0]}`, nom: l[1], birth: dob(r), document: doc(r), country: pays(r), address: adresse, remarques: r };
  /* On ne garde que les cas où au moins trois des cinq champs existent : un cas presque vide
     mesure la capacité à rendre du vide, ce qui n'est pas la question. */
  if ([c.birth, c.document, c.country, c.address].filter(Boolean).length >= 3) cas.push(c);
}
console.log(`  ${cas.length} cases kept out of ${sdn.length} lines · at least 3 of 4 fields present`);

/* Le texte est ce qu'un système d'accueil verrait : le nom, puis la prose officielle. */
const ech = (v) => `"${String(v).replace(/"/g, '""')}"`;
const lignes = ["id,text,name,birth,document,country,address"];
for (const c of cas.slice(0, 300)) {
  lignes.push([c.id, ech(`${c.nom} — ${c.remarques}`), ech(c.nom), ech(c.birth), ech(c.document), ech(c.country), ech(c.address)].join(","));
}
writeFileSync(`${D}/ofac-300.csv`, lignes.join("\n") + "\n");
console.log(`  écrit : ofac-300.csv · ${lignes.length - 1} cas`);
