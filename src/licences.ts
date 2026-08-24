/**
 * L'inventaire des licences — et la seule qui coûte quelque chose.
 *
 * ─── POURQUOI CE DOCUMENT EXISTE ───
 *
 * Un service achats ne lit pas le code. Il demande deux choses : la liste de ce que
 * l'outil embarque, et la preuve qu'aucune de ces licences ne contamine ce qu'il
 * achète. Sans ces deux pièces, la vente s'arrête avant la démonstration technique.
 *
 * ─── LE PIÈGE QU'ON A ÉVITÉ, ET CELUI QU'ON N'ÉVITE PAS ───
 *
 * Le piège classique est de lire le champ `license` du `package.json` et de s'arrêter
 * là. Ce champ est déclaratif : personne ne le vérifie, il manque parfois, et il peut
 * contredire le fichier LICENSE effectivement livré. On lit donc les deux, et un
 * paquet dont le champ est permissif mais dont le texte porte une clause copyleft est
 * classé sur le TEXTE.
 *
 * Le piège qu'on n'évite pas tout seul : `sharp-libvips` est une bibliothèque native
 * sous LGPL-3.0-or-later. La LGPL autorise l'usage dans un produit propriétaire —
 * c'est sa raison d'être — à condition que l'utilisateur puisse la remplacer par une
 * autre version. Ici il le peut : elle arrive par `npm install` chez le client, non
 * modifiée, et rien ne la lie statiquement. L'obligation est donc satisfaite par
 * l'attribution, qui est ce document. **Ça devient faux le jour où l'outil est livré
 * en binaire scellé**, et ce jour-là il faudra soit offrir le relien, soit sortir
 * `sharp`. C'est écrit ici pour que la question se pose au bon moment.
 *
 * ─── LE ZÉRO QUI NE VEUT RIEN DIRE ───
 *
 * « Aucune licence bloquante » est exactement le genre de phrase qu'un contrôle cassé
 * rend aussi. La classification est donc une fonction pure, et elle est éprouvée sur
 * des chaînes dont on connaît la réponse AVANT de publier son verdict : si elle
 * n'attrape plus l'AGPL, l'outil refuse de rendre un zéro. Voir `temoins()`.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Copyleft fort : contamine l'œuvre qui l'incorpore. Bloque une livraison propriétaire. */
const BLOQUANTES = /\b(GPL-2|GPL-3|GPLv2|GPLv3|AGPL|SSPL|CC-BY-NC|BUSL|Business Source|Commons Clause|OSL-3)\b/i;
/** Copyleft de fichier ou de bibliothèque : usage autorisé, obligations à tenir. */
const A_TENIR = /\b(LGPL|MPL-2|EPL-[12]|CDDL|EUPL)\b/i;
/** Permissives : attribution, rien de plus. */
const PERMISSIVES = /\b(MIT|ISC|BSD-[23]|BSD Zero|0BSD|Apache-2|Apache License|Unlicense|CC0|Python-2|BlueOak|Zlib)\b/i;

export type Classe = "bloquante" | "à tenir" | "permissive" | "indéterminée";

/** Les titres, pour les paquets qui livrent le texte sans déclarer de sigle. */
const T_A_TENIR = /LESSER GENERAL PUBLIC LICENSE|MOZILLA PUBLIC LICENSE|ECLIPSE PUBLIC LICENSE|COMMON DEVELOPMENT AND DISTRIBUTION|EUROPEAN UNION PUBLIC LICENCE/;
const T_BLOQUANTES = /AFFERO GENERAL PUBLIC LICENSE|GNU GENERAL PUBLIC LICENSE|SERVER SIDE PUBLIC LICENSE|BUSINESS SOURCE LICENSE|COMMONS CLAUSE|NONCOMMERCIAL/;
const T_PERMISSIVES = /MIT LICENSE|APACHE LICENSE|ISC LICENSE|BSD|BLUE OAK|PERMISSION IS HEREBY GRANTED|THE UNLICENSE/;

/**
 * La classification, isolée pour être éprouvable.
 *
 * Deux décisions valent d'être écrites, parce qu'elles ont été fausses avant de
 * l'être :
 *
 * **On lit le titre, pas tout le texte.** Le texte complet de la LGPL cite la GPL
 * dans son corps — « incorporates the terms and conditions of version 3 of the GNU
 * General Public License ». Chercher « GNU General Public License » n'importe où
 * classait donc toute LGPL comme bloquante. Le titre, lui, est en tête et ne ment
 * pas : les quatre cents premiers octets suffisent, et ils ne contiennent que lui.
 *
 * **Le plus strict des deux gagne.** Un paquet peut déclarer MIT et livrer une
 * AGPL. C'est le seul cas où cet inventaire vaut mieux qu'un coup d'œil au
 * `package.json`, alors il est traité en premier : le copyleft de bibliothèque est
 * cherché avant le copyleft fort — LGPL avant GPL — et les deux avant le permissif.
 */
export function classer(declaree: string | null, texte: string): Classe {
  const sigle = declaree ?? "";
  const titre = texte.slice(0, 400).toUpperCase();
  if (A_TENIR.test(sigle) || T_A_TENIR.test(titre)) return "à tenir";
  if (BLOQUANTES.test(sigle) || T_BLOQUANTES.test(titre)) return "bloquante";
  if (PERMISSIVES.test(sigle) || T_PERMISSIVES.test(titre)) return "permissive";
  return "indéterminée";
}

/**
 * Les témoins. Chaque entrée est un cas dont la classe est connue ; si l'un d'eux
 * change de réponse, la détection est cassée et son zéro n'a aucune valeur. On rend
 * la liste de ce qui a échoué plutôt qu'un booléen : une garde qui ne nomme pas ce
 * qui a lâché fait perdre le temps qu'elle prétend faire gagner.
 *
 * Les quatre derniers sont ceux qui ont réellement pris l'outil en défaut.
 */
export function temoins(): string[] {
  const TEXTE_AGPL = "                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3, 19 November 2007\n\n Copyright (C)";
  const TEXTE_LGPL = "                   GNU LESSER GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n  This version of the GNU Lesser General Public License incorporates the terms and conditions of version 3 of the GNU General Public License";
  const TEXTE_GPL = "                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007";
  const TEXTE_MIT = "MIT License\n\nCopyright (c) 2020\n\nPermission is hereby granted, free of charge, to any person obtaining a copy";
  const cas: Array<[string | null, string, Classe, string]> = [
    ["AGPL-3.0", "", "bloquante", "sigle AGPL"],
    ["GPL-3.0-only", "", "bloquante", "sigle GPL-3"],
    ["GPL-2.0", "", "bloquante", "sigle GPL-2"],
    ["SSPL-1.0", "", "bloquante", "sigle SSPL"],
    ["MIT", "", "permissive", "sigle MIT"],
    ["Apache-2.0", "", "permissive", "sigle Apache"],
    ["BSD-3-Clause", "", "permissive", "sigle BSD"],
    ["LGPL-3.0-or-later", "", "à tenir", "sigle LGPL"],
    ["MPL-2.0", "", "à tenir", "sigle MPL"],
    ["SEE LICENSE IN LICENSE.txt", "", "indéterminée", "renvoi sans sigle"],
    [null, TEXTE_AGPL, "bloquante", "texte AGPL sans champ — le cas qui a pris l'outil en défaut"],
    [null, TEXTE_GPL, "bloquante", "texte GPL sans champ"],
    [null, TEXTE_LGPL, "à tenir", "texte LGPL, qui cite la GPL dans son corps"],
    ["MIT", TEXTE_AGPL, "bloquante", "champ MIT, texte AGPL — le plus strict gagne"],
    [null, TEXTE_MIT, "permissive", "texte MIT sans champ"],
  ];
  const ratés: string[] = [];
  for (const [d, t, attendu, quoi] of cas) {
    const obtenu = classer(d, t);
    if (obtenu !== attendu) ratés.push(`${quoi} → ${obtenu}, attendu ${attendu}`);
  }
  return ratés;
}

export type Paquet = { nom: string; version: string; declaree: string | null; classe: Classe; fichier: string | null };

function dossiers(racine: string): string[] {
  const out: string[] = [];
  if (!existsSync(racine)) return out;
  for (const e of readdirSync(racine)) {
    if (e === ".bin" || e.startsWith(".")) continue;
    const p = join(racine, e);
    if (!statSync(p).isDirectory()) continue;
    if (e.startsWith("@")) { out.push(...dossiers(p)); continue; }
    if (existsSync(join(p, "package.json"))) out.push(p);
    out.push(...dossiers(join(p, "node_modules")));
  }
  return out;
}

export function inventaire(racine = "node_modules"): Paquet[] {
  const vus = new Map<string, Paquet>();
  for (const dir of dossiers(racine)) {
    const m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    let d: unknown = m.license ?? m.licenses;
    if (Array.isArray(d)) d = d.map((l) => (typeof l === "string" ? l : l?.type)).join(" OR ");
    if (d && typeof d === "object") d = (d as { type?: string }).type ?? null;
    const declaree = typeof d === "string" && d.length > 0 ? d : null;
    const fichier = readdirSync(dir).find((f) => /^(LICEN[CS]E|COPYING)/i.test(f)) ?? null;
    const texte = fichier ? readFileSync(join(dir, fichier), "utf8").slice(0, 6000) : "";
    const p: Paquet = { nom: m.name ?? dir, version: m.version ?? "?", declaree, classe: classer(declaree, texte), fichier };
    vus.set(`${p.nom}@${p.version}`, p);   // l'arbre répète les paquets hissés : une clé par version
  }
  return [...vus.values()].sort((a, b) => a.nom.localeCompare(b.nom));
}

/** CycloneDX minimal — le format qu'un service achats sait ingérer. */
export function sbom(paquets: Paquet[], nom: string, version: string) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { component: { type: "application", name: nom, version } },
    components: paquets.map((p) => ({
      type: "library",
      name: p.nom,
      version: p.version,
      licenses: p.declaree ? [{ license: { id: p.declaree } }] : [],
      purl: `pkg:npm/${p.nom.replace("@", "%40")}@${p.version}`,
    })),
  };
}

export function document(paquets: Paquet[], licenceDuDepot: string | null): string {
  const par = (c: Classe) => paquets.filter((p) => p.classe === c);
  const bloquantes = par("bloquante");
  const aTenir = par("à tenir");
  const indeterminees = par("indéterminée");
  const sansFichier = paquets.filter((p) => p.fichier === null);

  const tableau = (ps: Paquet[]) =>
    ["| Package | Version | Licence |", "| --- | --- | --- |",
     ...ps.map((p) => `| \`${p.nom}\` | ${p.version} | ${p.declaree ?? "—"} |`)].join("\n");

  return `<!-- ENGENDRÉ PAR src/licences.ts — NE PAS ÉDITER À LA MAIN -->
# Licences et nomenclature

${paquets.length} paquets sont installés sous \`node_modules/\`, dépendances de
développement comprises. Chacun a été classé sur son champ \`license\` **et** sur le
texte du fichier de licence qu'il livre ; quand les deux divergent, c'est le texte
qui décide.

| Classe | Paquets | Ce que ça implique |
| --- | --- | --- |
| Permissive | ${par("permissive").length} | Attribution. Rien d'autre. |
| À tenir | ${aTenir.length} | Usage autorisé dans un produit propriétaire, sous conditions — détaillées ci-dessous. |
| Bloquante | ${bloquantes.length} | Contaminerait ce qui est livré. |
| Indéterminée | ${indeterminees.length} | À lever avant livraison. |

## Ce qui demande une décision

${bloquantes.length > 0
  ? `### ⛔ Copyleft fort dans l'arbre\n\n${tableau(bloquantes)}\n\nCes licences contaminent l'œuvre qui les incorpore. Elles doivent sortir de l'arbre avant toute livraison propriétaire.`
  : "### Aucun copyleft fort\n\nAucune GPL, AGPL, SSPL ni Business Source dans l'arbre. Ce zéro est rendu par une classification dont les témoins passent — voir `temoins()` dans `src/licences.ts` ; si elle cessait de reconnaître l'AGPL, l'outil refuserait de l'écrire."}

${aTenir.length > 0
  ? `### Copyleft de bibliothèque\n\n${tableau(aTenir)}\n\nLa LGPL autorise l'usage dans un produit propriétaire tant que l'utilisateur peut remplacer la bibliothèque. C'est le cas ici : elle arrive par \`npm install\` chez le client, non modifiée, sans lien statique. **L'obligation change si l'outil est un jour livré en binaire scellé** — il faudra alors offrir le relien, ou sortir la dépendance.`
  : ""}

${indeterminees.length > 0
  ? `### Licences non levées\n\n${tableau(indeterminees)}\n\nNi le champ ni le fichier ne permettent de trancher. À lever avant livraison.`
  : ""}

${sansFichier.length > 0
  ? `### Déclarées sans fichier de licence livré\n\n${sansFichier.map((p) => `\`${p.nom}@${p.version}\` (${p.declaree ?? "—"})`).join(" · ")}\n\nLe champ dit permissif, le paquet ne livre pas son texte. Ce n'est pas un risque juridique : c'est une pièce manquante si un acheteur demande l'attribution complète.`
  : ""}

## La licence de cet outil

${licenceDuDepot
  ? `Le dépôt déclare **${licenceDuDepot}**.`
  : `**Le dépôt ne déclare aucune licence.** Sur un dépôt public, cela signifie « tous droits réservés » : personne ne peut légalement s'en servir, y compris le client qui l'a acheté. C'est peut-être voulu — c'est le comportement par défaut d'un produit vendu — mais tant que ce n'est pas écrit, un service juridique bloquera. À trancher : licence commerciale écrite, ou déclaration explicite de propriété.`}

## Nomenclature

\`sbom.json\` accompagne ce document, au format CycloneDX 1.5.
`;
}

function principal() {
  const controle = process.argv.includes("--check");
  const ratés = temoins();
  if (ratés.length > 0) {
    console.error("La classification des licences ne reconnaît plus ce qu'elle prétend reconnaître :");
    for (const r of ratés) console.error(`  - ${r}`);
    console.error("\nSon verdict est sans valeur tant que ces témoins ne repassent pas. Rien n'est écrit.");
    process.exit(1);
  }
  if (!existsSync("node_modules")) {
    console.error("node_modules/ absent : l'inventaire ne peut pas être fait.\nLancez « npm install », puis « npm run licences ».");
    process.exit(1);
  }
  const moi = JSON.parse(readFileSync("package.json", "utf8"));
  const paquets = inventaire();
  const md = document(paquets, typeof moi.license === "string" ? moi.license : null);
  const bom = JSON.stringify(sbom(paquets, moi.name ?? "cascade", moi.version ?? "0.0.0"), null, 2) + "\n";

  if (controle) {
    const differe = (f: string, attendu: string) => !existsSync(f) || readFileSync(f, "utf8") !== attendu;
    const perimes = [["LICENCES.md", md], ["sbom.json", bom]].filter(([f, a]) => differe(f, a)).map(([f]) => f);
    if (perimes.length > 0) {
      console.error(`${perimes.join(" et ")} ne correspond plus à l'arbre installé.\n\nRun: npm run licences`);
      process.exit(1);
    }
    console.log(`LICENCES.md et sbom.json sont à jour (${paquets.length} paquets, ${temoins().length === 0 ? "témoins verts" : "TÉMOINS CASSÉS"}).`);
    return;
  }
  writeFileSync("LICENCES.md", md);
  writeFileSync("sbom.json", bom);
  const bloquantes = paquets.filter((p) => p.classe === "bloquante").length;
  console.log(`${paquets.length} paquets · ${bloquantes} bloquante(s) · ${paquets.filter((p) => p.classe === "à tenir").length} à tenir · LICENCES.md + sbom.json écrits.`);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
