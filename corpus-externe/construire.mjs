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
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "node:path";

const D = "/private/tmp/claude-501/-Users-arslanechr-Downloads-atlas-final-en-fr/9eaa6456-ea12-48c5-bd77-6279f40c9def/scratchpad/externe";

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
for (const l of lire(`${D}/add.csv`.replace("add", "sdn-add"))) {
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
