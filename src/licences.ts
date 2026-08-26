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

import { isMain } from "./cli.ts";
import { join } from "node:path";

/** Copyleft fort : contamine l'œuvre qui l'incorpore. Bloque une livraison propriétaire. */
const BLOQUANTES = /\b(GPL-2|GPL-3|GPLv2|GPLv3|AGPL|SSPL|CC-BY-NC|BUSL|Business Source|Commons Clause|OSL-3|PolyForm|Noncommercial|Non-Commercial|Elastic-2|Elastic License)\b/i;
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
    ["PolyForm-Noncommercial-1.0.0", "", "bloquante", "source-available non commerciale — la nôtre : dans l'arbre d'un tiers elle bloquerait, et il faut que l'inventaire le dise"],
    ["Elastic-2.0", "", "bloquante", "sigle Elastic, même famille"],
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

export type Paquet = { nom: string; version: string; declaree: string | null; classe: Classe;
  fichier: string | null;
  /** Les contraintes `os`/`cpu` du paquet, quand il n'existe que sur certaines machines. */
  plateforme?: string | null };

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
    /*
     * UN BINAIRE PROPRE À LA MACHINE NE PEUT PAS ÊTRE INSCRIT SOUS SON NOM COMPLET.
     *
     * L'inventaire est pris sur `node_modules/`, donc sur la machine qui l'écrit. Sur macOS
     * npm installe `@img/sharp-darwin-arm64` ; sur le Linux de l'intégration continue,
     * `@img/sharp-linux-x64`. Les deux jeux ne peuvent JAMAIS coïncider, donc
     * `licences.ts --check` échouait à chaque passe — et comme `npm test` est une chaîne de
     * `&&`, `node --test` ne tournait pas du tout. Mesuré : 22 passes d'affilée en échec, la
     * dernière réussite le 17 août 2026.
     *
     * Le nom de famille se DÉDUIT, il ne se devine pas : on retire du nom les jetons que le
     * paquet déclare lui-même dans `os` et `cpu`. `@img/sharp-darwin-arm64` → `@img/sharp`,
     * et `@img/sharp-linux-x64` → `@img/sharp`. Un paquet qui porte tous ses binaires dans
     * un seul dossier — `onnxruntime-node` — garde son nom, puisqu'aucun jeton n'y figure.
     *
     * Ce qui est publié reste vrai : la licence est celle de la famille, et le document dit
     * que la variante concrète dépend de la machine.
     */
    const complet: string = m.name ?? dir;
    /*
     * On coupe le nom au DERNIER `-<os>` qu'il porte, pas les jetons un par un : retirer
     * « linux » de `@img/sharp-linuxmusl-x64` laisserait `@img/sharpmusl`, et le document
     * d'une machine Alpine différerait encore de celui d'une machine glibc. La coupe rend
     * `@img/sharp` dans les deux cas, comme pour `-darwin-arm64` et `-freebsd-wasm32`.
     */
    let nom = complet;
    for (const t of (Array.isArray(m.os) ? m.os : []) as string[]) {
      const i = complet.lastIndexOf(`-${t}`);
      if (i > 0 && i < nom.length) nom = complet.slice(0, i);
    }
    const p: Paquet = { nom, version: m.version ?? "?", declaree, classe: classer(declaree, texte), fichier,
      /* Marqué SEULEMENT si le nom portait la plateforme : `onnxruntime-node` déclare trois
         systèmes et s'appelle pareil partout — il n'a rien de dépendant de la machine ici. */
      plateforme: nom !== complet ? "le nom portait la plateforme" : null };
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
      /*
       * `replaceAll`, PAS `replace` — ET LA RAISON N'EST PAS CELLE QUE CODEQL DONNE.
       *
       * Signalé comme « ne remplace que la première occurrence ». Pour un nom de paquet npm
       * légitime c'est exactement ce qu'il faut : `@scope/nom` doit devenir `%40scope/nom` et
       * le `@` de la version, ajouté juste après, doit rester tel quel. La grammaire npm
       * n'autorise pas un second `@` dans un nom.
       *
       * Mais `p.nom` retombe sur le NOM DE DOSSIER quand `package.json` n'a pas de champ
       * `name` (voir plus haut, `m.name ?? dir`), et un nom de dossier n'a aucune de ces
       * garanties. Le `purl` publié dans la nomenclature deviendrait alors invalide — dans le
       * document même qu'un service achats lit pour vérifier ce qu'on embarque.
       *
       * Le coût de la version sûre est nul, parce qu'un nom légitime ne porte qu'un seul `@`.
       * Se fier à une grammaire pour un chemin qui la contourne est le genre de raccourci
       * qu'on paie une fois.
       */
      purl: `pkg:npm/${p.nom.replaceAll("@", "%40")}@${p.version}`,
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

  return `<!-- GENERATED BY src/licences.ts — DO NOT EDIT BY HAND -->
# Licences and bill of materials

${paquets.length} packages are installed under \`node_modules/\`, development dependencies
included. Each was classified on its \`license\` field **and** on the text of the licence
file it ships; where the two disagree, the text decides.

${paquets.filter((p) => p.plateforme).length} of them are binaries whose package name carries
the platform (${paquets.filter((p) => p.plateforme).map((p) => `\`${p.nom}\``).join(", ") || "none"}).
They are listed under their family name: which variant npm installs depends on the machine,
while the licence and the version are the family's and do not change with it. Recorded under
their full names, this inventory could never match on a second machine — and that is exactly
what kept the public suite from running for nine days.

| Class | Packages | What it means |
| --- | --- | --- |
| Permissive | ${par("permissive").length} | Attribution. Nothing else. |
| With obligations | ${aTenir.length} | Permitted in a proprietary product, under conditions — set out below. |
| Blocking | ${bloquantes.length} | Would contaminate what is delivered. |
| Undetermined | ${indeterminees.length} | To be resolved before delivery. |

## What needs a decision

${bloquantes.length > 0
  ? `### ⛔ Strong copyleft in the tree\n\n${tableau(bloquantes)}\n\nThese licences contaminate the work that incorporates them. They must leave the tree before any proprietary delivery.`
  : "### No strong copyleft\n\nNo GPL, AGPL, SSPL or Business Source in the tree. This zero comes from a classifier whose witnesses pass — see `temoins()` in `src/licences.ts`. If it stopped recognising the AGPL, the tool would refuse to write the zero at all."}

${aTenir.length > 0
  ? `### Library copyleft\n\n${tableau(aTenir)}\n\nThe LGPL permits use inside a proprietary product as long as the user can replace the library. That holds here: it arrives through \`npm install\` on the client's side, unmodified, with no static linking. **The obligation changes the day this tool ships as a sealed binary** — relinking would then have to be offered, or the dependency dropped.`
  : ""}

${indeterminees.length > 0
  ? `### Unresolved licences\n\n${tableau(indeterminees)}\n\nNeither the field nor the file settles it. To be resolved before delivery.`
  : ""}

${sansFichier.length > 0
  ? `### Declared, but shipping no licence file\n\n${sansFichier.map((p) => `\`${p.nom}@${p.version}\` (${p.declaree ?? "—"})`).join(" · ")}\n\nThe field says permissive, the package ships no text. This is not a legal risk: it is a missing item if a buyer asks for full attribution.`
  : ""}

## This tool's own licence

${licenceDuDepot
  ? `This repository declares **${licenceDuDepot}**${/PolyForm|Noncommercial|BUSL|Elastic/i.test(licenceDuDepot)
      ? ` — a *source-available* licence, not an open source one.

Three tiers, and only one of them is paid for:

| Who | What is permitted |
| --- | --- |
| Anyone, with no time limit | Read it, study it, fork it, use it noncommercially. The repository keeps its full value as a demonstration. |
| An organisation evaluating it | Run it **on their own data**, for thirty days, to decide. Results stay internal and do not go to production. |
| An organisation using it | A commercial licence, negotiated separately. |

The second tier is a permission *added* to the PolyForm text, not a modification
of it: a rights holder can always grant more, never less. It exists because a
licence forbidding all commercial use also forbids evaluation, and a buyer who
could not evaluate does not buy.

**This licence is not what a client buys.** It describes what a visitor to the
repository may do. Commercial use happens under a separate commercial licence,
negotiated on its own — the dual-licensing model. The rights holder keeps the
right to license this tool to whoever they choose on whatever terms; the public
licence takes nothing away from them.

One consequence worth knowing: it is not OSI-approved, so some large
organisations exclude it from their dependency tree by policy. That does not
impede a sale, since a buyer goes through the commercial licence anyway; it would
impede spontaneous adoption, which is not what this repository is for.`
      : "."}`
  : `**This repository declares no licence at all.** On a public repository that means "all rights reserved": nobody may legally use it, including a client who has paid for it. That may well be deliberate — it is the default for a product being sold — but until it is written down, a legal department will stop the sale. To settle: a written commercial licence, or an explicit statement of ownership.`}

## Bill of materials

\`sbom.json\` accompanies this document, in CycloneDX 1.5 format.
`;
}

function principal() {
  const controle = process.argv.includes("--check");
  const ratés = temoins();
  if (ratés.length > 0) {
    console.error("The licence classifier no longer recognises what it claims to recognise:");
    for (const r of ratés) console.error(`  - ${r}`);
    console.error("\nIts verdict is worthless until those witnesses pass again. Nothing was written.");
    process.exit(1);
  }
  if (!existsSync("node_modules")) {
    console.error("node_modules/ is missing: the inventory cannot be taken.\nRun `npm install`, then `npm run licences`.");
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
      console.error(/* « matches » ou « match » selon le nombre de fichiers cités : la phrase se lit sur la
       première sortie qu'un acheteur voit après un clone, et un accord fautif y coûte plus
       cher qu'ailleurs. */
      `${perimes.join(" and ")} ${perimes.length > 1 ? "no longer match" : "no longer matches"} `
      + `the installed tree.`);
      /*
       * UN REFUS QUI NE DIT PAS CE QUI DIFFÈRE SE RELIT VINGT-DEUX FOIS SANS RIEN APPRENDRE.
       *
       * Ce pas a fait échouer l'intégration continue vingt-deux fois d'affilée, du 17 au 25
       * août 2026, et le journal public ne portait que « no longer match ». La cause — deux
       * binaires nommés d'après la machine — se lisait en une ligne dès qu'on comparait les
       * deux jeux de noms. Personne ne l'a fait, parce que le message ne le proposait pas.
       */
      try {
        const avant = JSON.parse(readFileSync("sbom.json", "utf8")) as { components?: { name: string; version: string }[] };
        const cle = (c: { name: string; version: string }) => `${c.name}@${c.version}`;
        const anciens = new Set((avant.components ?? []).map(cle));
        const neufs = new Set(paquets.map((q) => `${q.nom}@${q.version}`));
        const partis = [...anciens].filter((x) => !neufs.has(x));
        const venus = [...neufs].filter((x) => !anciens.has(x));
        if (partis.length || venus.length) {
          console.error(`\n  recorded here, absent from the tree : ${partis.join(", ") || "none"}`);
          console.error(`  in the tree, not recorded here     : ${venus.join(", ") || "none"}`);
          console.error("\n  A name that carries the platform — `@img/sharp-darwin-arm64` here,");
          console.error("  `@img/sharp-linux-x64` elsewhere — can never match from one machine to the");
          console.error("  next. See `inventaire()`, which records them under their family name.");
        } else {
          console.error("\n  Same packages, same versions: it is the TEXT of the document that changed,");
          console.error("  not the tree — often a hand edit inside a generated file.");
        }
      } catch {
        console.error("\n  (sbom.json is unreadable or missing: cannot say what differs.)");
      }
      console.error("\nRun: npm run licences");
      process.exit(1);
    }
    console.log(`LICENCES.md and sbom.json are up to date (${paquets.length} packages, ${temoins().length === 0 ? "witnesses green" : "WITNESSES BROKEN"}).`);
    return;
  }
  writeFileSync("LICENCES.md", md);
  writeFileSync("sbom.json", bom);
  const bloquantes = paquets.filter((p) => p.classe === "bloquante").length;
  console.log(`${paquets.length} paquets · ${bloquantes} bloquante(s) · ${paquets.filter((p) => p.classe === "à tenir").length} à tenir · LICENCES.md + sbom.json écrits.`);
}

/*
 * LA DÉTECTION DU POINT D'ENTRÉE VIENT DE `cli.ts`, ELLE NE SE RÉÉCRIT PAS ICI.
 *
 * Cinq modules portaient chacun leur copie de `import.meta.url === pathToFileURL(argv1).href`,
 * chacune avec son commentaire expliquant le piège URL-contre-chemin. Cinq copies d'une
 * comparaison subtile, c'est cinq endroits où se tromper demain et une correction à faire cinq
 * fois — et elles rendent toutes le même résultat le jour où on les écrit, ce qui est
 * exactement ce qui les rend difficiles à voir.
 *
 * `isMain` est éprouvé équivalent avant ce remplacement, sur les quatre cas qui séparent les
 * deux formes : chemin accentué avec espaces, invocation relative, et lien symbolique — où les
 * deux rendent `false`.
 */

if (isMain(import.meta)) principal();
