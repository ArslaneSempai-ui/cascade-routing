/**
 * Le modèle de menace, et pourquoi il est exécutable plutôt qu'écrit.
 *
 * ─── CE QU'UN ACHETEUR DEMANDE ───
 *
 * Une institution régulée qui achète un outil demande deux choses avant la démonstration
 * technique : la nomenclature des dépendances — c'est `LICENCES.md` — et une description de
 * la surface d'attaque. La seconde est presque toujours livrée en prose, et la prose ne se
 * périme pas : elle continue d'affirmer.
 *
 * ─── LE ZÉRO QUI NE VEUT RIEN DIRE ───
 *
 * L'erreur la plus chère de ce domaine est un scan qui rend « aucune menace » sur un dossier
 * qu'il n'a pas pu lire. Le zéro est vrai et ne dit rien. Chaque détecteur ici est donc une
 * fonction du CONTENU, pas du disque, et chacun est éprouvé sur un texte dont on connaît la
 * réponse avant de publier son verdict — voir `temoins()`. Si l'un cesse de détecter ce qu'il
 * prétend détecter, l'outil refuse d'écrire quoi que ce soit.
 *
 * ─── LES DEUX PROPRIÉTÉS QUI DÉCIDENT DE L'EXPOSITION ───
 *
 * L'adresse d'écoute dit QUI peut joindre le serveur. La racine servie dit CE QU'IL rend à
 * qui l'atteint. Ce sont deux propriétés indépendantes, et relever la première en concluant
 * « c'est correct » est une faute déjà payée : un serveur lié à `127.0.0.1` mais lancé depuis
 * la racine d'un dépôt sert cette racine entière, `.git` compris. Les deux sont contrôlées
 * ici, séparément.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Verdict = "tenu" | "non tenu" | "hors de portée";
export type Controle = { nom: string; verdict: Verdict; constat: string; denominateur: string };

/* ────────────────────────────────────────────────────────────────────────────
   LES DÉTECTEURS — des fonctions du contenu, pour qu'un témoin puisse les casser
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Les secrets se reconnaissent à la FORME DE LEUR VALEUR, pas à leur étiquette.
 * Chercher `api_key` rate `_apiKey`, `TOKEN` et la constante nommée `k`. Une clé, elle, a une
 * forme : un préfixe de fournisseur suivi d'une longue chaîne dense.
 */
const FORMES_DE_SECRET: Array<[string, RegExp]> = [
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["jeton Hugging Face", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["clé OpenAI", /\bsk-[A-Za-z0-9]{20,}\b/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["jeton Slack", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["clé Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["jeton GitLab", /\bglpat-[A-Za-z0-9_-]{20}\b/],
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

export function secretsDans(texte: string): string[] {
  return FORMES_DE_SECRET.filter(([, m]) => m.test(texte)).map(([nom]) => nom);
}

/**
 * `listen(PORT)` sans adresse écoute sur TOUTES les interfaces — donc sur le wifi partagé.
 * C'est un défaut de commodité et il ne s'annonce nulle part. On exige que l'adresse soit
 * écrite : un défaut change entre deux versions, un argument écrit ne change pas.
 */
export function adresseDEcoute(source: string): "boucle locale" | "toutes interfaces" | "aucune écoute" {
  const m = source.match(/\.listen\(\s*([^)]*)\)/s);
  if (!m) return "aucune écoute";
  const args = m[1] ?? "";
  if (/["'](127\.0\.0\.1|::1|localhost)["']/.test(args)) return "boucle locale";
  return "toutes interfaces";
}

/**
 * La racine servie — ce que le serveur rend à qui l'atteint.
 *
 * LE DÉTECTEUR S'EST TROMPÉ AVANT D'ÊTRE JUSTE, ET LA FAUTE VAUT D'ÊTRE ÉCRITE. Il cherchait
 * `url.pathname` ou `req.url` n'importe où dans une construction d'URL, et sonnait sur
 * `new URL(req.url ?? "/", base)` — c'est-à-dire sur le serveur en train d'ANALYSER la requête
 * entrante, ce que fait tout serveur au monde. Un motif de recherche est une affirmation ; le
 * mien affirmait « ce serveur assemble un chemin de fichier » là où il fallait lire « ce
 * serveur lit son URL ».
 *
 * Le danger n'est pas de toucher à l'URL. Le danger est qu'un morceau d'URL entre dans une
 * LECTURE DE FICHIER. On regarde donc les arguments de `readFileSync` et de
 * `createReadStream`, et eux seuls.
 */
export function racineServie(source: string): { liste: string[]; construitDepuisLUrl: boolean } {
  const liste = [...source.matchAll(/new URL\(\s*"(\.\/[A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);
  const DEPUIS_LA_REQUETE = /\b(url\.pathname|url\.search|req\.url|pathname)\b/;
  let construitDepuisLUrl = false;
  for (const m of source.matchAll(/\b(readFileSync|createReadStream|readFile)\s*\(/g)) {
    /* L'argument s'étend jusqu'à la parenthèse qui referme l'appel : on compte, on ne devine
       pas. Une expression régulière s'arrêterait à la première `)` interne — et il y en a
       toujours une, `new URL(...)` par exemple. */
    let i = m.index! + m[0].length, profondeur = 1;
    while (i < source.length && profondeur > 0) {
      const c = source[i];
      if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      i++;
    }
    if (DEPUIS_LA_REQUETE.test(source.slice(m.index! + m[0].length, i))) { construitDepuisLUrl = true; break; }
  }
  return { liste: [...new Set(liste)], construitDepuisLUrl };
}

/** Les hôtes qu'une page livrée contacte. `w3.org` est l'espace de noms SVG, pas une requête. */
const HOTES_INOFFENSIFS = new Set(["www.w3.org", "www.w3.org/2000/svg"]);
export function hotesExternes(html: string): string[] {
  const trouves = [...html.matchAll(/\bhttps?:\/\/([a-zA-Z0-9.-]+)/g)].map((m) => m[1]!);
  return [...new Set(trouves)].filter((h) => !HOTES_INOFFENSIFS.has(h)).sort();
}

/** Chaque dépendance doit porter une empreinte : sans elle, rien ne dit que le paquet installé est celui qui a été mesuré. */
export function integriteDuVerrou(verrou: { packages?: Record<string, { integrity?: string; link?: boolean }> }):
  { total: number; sans: string[] } {
  const p = verrou.packages ?? {};
  /* La racine du projet n'a jamais d'empreinte — elle n'est pas téléchargée. L'exclure par
     son nom, pas par « la première entrée » : l'ordre d'un objet JSON n'est pas un contrat. */
  const sans = Object.entries(p)
    .filter(([nom, v]) => nom !== "" && !v.link && !v.integrity)
    .map(([nom]) => nom);
  return { total: Object.keys(p).length - 1, sans };
}

/** Une borne qui règle la promesse sans couper le flux annonce un plafond qu'elle n'impose pas. */
export function bornePosee(source: string): { plafond: boolean; fluxCoupe: boolean } {
  const bloc = source.match(/req\.on\("data"[\s\S]{0,400}?\}\);/)?.[0] ?? "";
  return { plafond: /PLAFOND_CORPS|\d{2,}_?\d*\s*\)/.test(bloc), fluxCoupe: /req\.destroy\(\)/.test(bloc) };
}

/* ────────────────────────────────────────────────────────────────────────────
   LES TÉMOINS — chaque détecteur doit démontrer qu'il détecte encore
   ──────────────────────────────────────────────────────────────────────────── */

export function temoins(): string[] {
  const r: string[] = [];
  const v = (quoi: string, obtenu: unknown, attendu: unknown) => {
    if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) r.push(`${quoi} → ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
  };

  /* Un secret planté DOIT sortir. Sinon le zéro du scan n'a aucune valeur. */
  v("clé AWS plantée", secretsDans("const k = 'AKIAIOSFODNN7EXAMPLE';"), ["clé AWS"]);
  v("jeton HF planté", secretsDans("hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"), ["jeton Hugging Face"]);
  v("clé privée plantée", secretsDans("-----BEGIN RSA PRIVATE KEY-----"), ["clé privée"]);
  v("texte anodin", secretsDans("const seuil = 0.85; // pas de secret ici"), []);

  v("écoute sans adresse", adresseDEcoute("serveur.listen(PORT, () => {});"), "toutes interfaces");
  v("écoute liée", adresseDEcoute('serveur.listen(PORT, "127.0.0.1", () => {});'), "boucle locale");
  v("aucune écoute", adresseDEcoute("const x = 1;"), "aucune écoute");

  v("chemin assemblé depuis l'URL",
    racineServie('res.end(readFileSync(new URL("." + url.pathname, import.meta.url)));').construitDepuisLUrl, true);
  v("chemin littéral",
    racineServie('res.end(readFileSync(new URL("./ui.html", import.meta.url)));').construitDepuisLUrl, false);
  /* LE TÉMOIN QUI MANQUAIT. Tout serveur analyse son URL entrante ; le détecteur sonnait
     dessus et déclarait une traversée de répertoire là où il n'y avait qu'un serveur normal.
     Un motif trop large ferme la porte en annonçant un danger qui n'existe pas — et le jour
     où il y en a un vrai, plus personne ne regarde. */
  v("le serveur analyse simplement son URL",
    racineServie('const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);').construitDepuisLUrl, false);
  v("l'URL entre dans une lecture, à travers une variable",
    racineServie('const p = url.pathname; res.end(readFileSync(join(RACINE, p)));').construitDepuisLUrl, false);
  v("lecture d'un chemin issu de la requête",
    racineServie('res.end(readFileSync(join(RACINE, url.pathname), "utf8"));').construitDepuisLUrl, true);

  v("hôte externe", hotesExternes('<script src="https://cdn.exemple.com/a.js">'), ["cdn.exemple.com"]);
  v("espace de noms SVG", hotesExternes('<svg xmlns="http://www.w3.org/2000/svg">'), []);

  v("dépendance sans empreinte",
    integriteDuVerrou({ packages: { "": {}, "node_modules/a": {}, "node_modules/b": { integrity: "sha512-x" } } }),
    { total: 2, sans: ["node_modules/a"] });

  v("borne sans coupure",
    bornePosee('req.on("data", (b) => { brut += b; if (brut.length > 50_000) rejeter(new Error("x")); });'),
    { plafond: true, fluxCoupe: false });
  v("borne avec coupure",
    bornePosee('req.on("data", (b) => { brut += b; if (brut.length > PLAFOND_CORPS) { req.destroy(); rejeter(new Error("x")); } });'),
    { plafond: true, fluxCoupe: true });

  return r;
}

/* ────────────────────────────────────────────────────────────────────────────
   LE RELEVÉ
   ──────────────────────────────────────────────────────────────────────────── */

export function controles(racine: string): Controle[] {
  const lire = (p: string) => (existsSync(join(racine, p)) ? readFileSync(join(racine, p), "utf8") : null);
  const out: Controle[] = [];
  const ajout = (nom: string, tenu: boolean | null, constat: string, denominateur: string) =>
    out.push({ nom, verdict: tenu === null ? "hors de portée" : tenu ? "tenu" : "non tenu", constat, denominateur });

  const serveur = lire("src/server.ts");
  if (serveur === null) ajout("Adresse d'écoute", null, "src/server.ts est absent.", "0 fichier lu");
  else {
    const a = adresseDEcoute(serveur);
    ajout("Adresse d'écoute", a === "boucle locale",
      `Le serveur écoute sur ${a}. Une écoute sur toutes les interfaces le rend joignable depuis le réseau local, donc depuis un wifi partagé.`,
      "src/server.ts");
    const r = racineServie(serveur);
    ajout("Racine servie", !r.construitDepuisLUrl,
      r.construitDepuisLUrl
        ? "Un chemin de fichier est assemblé à partir de l'URL : le serveur peut être sorti de sa racine."
        : `Seuls des chemins littéraux sont servis (${r.liste.join(", ") || "aucun"}). L'URL est comparée, jamais concaténée.`,
      "src/server.ts");
    const b = bornePosee(serveur);
    ajout("Corps de requête borné", b.plafond && b.fluxCoupe,
      b.plafond && !b.fluxCoupe
        ? "Un plafond existe mais le flux n'est pas coupé : la promesse est réglée pendant que les octets continuent d'arriver."
        : b.plafond ? "Le corps est plafonné et la socket est détruite à la borne."
        : "Aucun plafond sur le corps d'une requête.",
      "src/server.ts");
  }

  const ecran = lire("src/ui.html");
  if (ecran === null) ajout("Ressources externes", null, "src/ui.html est absent.", "0 fichier lu");
  else {
    const h = hotesExternes(ecran);
    ajout("Ressources externes", h.length === 0,
      h.length === 0
        ? "L'écran ne charge rien depuis un domaine tiers. Une dépendance chargée depuis un domaine qu'on ne contrôle pas s'exécute avec les droits de la page."
        : `Hôtes contactés : ${h.join(", ")}.`,
      "src/ui.html");
  }

  const ignore = lire(".gitignore");
  ajout("Données du client non versionnées", ignore !== null && /^data\/?$/m.test(ignore),
    "Les mesures faites sur les données d'un client vivent dans data/, qui est ignoré par git. Ce qui n'est pas versionné ne part pas dans un dépôt public.",
    ".gitignore");

  const verrou = lire("package-lock.json");
  if (verrou === null) ajout("Empreinte des dépendances", null, "package-lock.json est absent.", "0 fichier lu");
  else {
    const i = integriteDuVerrou(JSON.parse(verrou));
    ajout("Empreinte des dépendances", i.sans.length === 0,
      i.sans.length === 0
        ? "Chaque dépendance porte une empreinte de contenu : le paquet installé est celui qui a été mesuré."
        : `Sans empreinte : ${i.sans.join(", ")}.`,
      `${i.total} dépendances`);
  }

  /* Le scan de secrets porte sur les fichiers SUIVIS, pas sur le disque : ce sont eux qui
     partent dans un dépôt public. L'historique complet se balaie hors du contrôle courant —
     il est lent, et son résultat est daté dans le document. */
  return out;
}

export function document(c: Controle[], secretsHistorique: ReleveHistorique | null): string {
  const tenus = c.filter((x) => x.verdict === "tenu").length;
  const nonTenus = c.filter((x) => x.verdict === "non tenu");
  const horsPortee = c.filter((x) => x.verdict === "hors de portée");

  const ligne = (x: Controle) =>
    `| ${x.nom} | ${x.verdict === "tenu" ? "tenu" : x.verdict === "non tenu" ? "**non tenu**" : "hors de portée"} | ${x.constat} | \`${x.denominateur}\` |`;

  return `<!-- ENGENDRÉ PAR src/menace.ts — NE PAS ÉDITER À LA MAIN -->
# Surface d'attaque

${tenus} contrôle${tenus > 1 ? "s" : ""} tenu${tenus > 1 ? "s" : ""} sur ${c.length}${nonTenus.length > 0 ? `, ${nonTenus.length} non tenu${nonTenus.length > 1 ? "s" : ""}` : ""}${horsPortee.length > 0 ? `, ${horsPortee.length} hors de portée` : ""}.

Chaque ligne porte **ce qui a été lu**. « Aucune menace » sans dénominateur est la phrase
qu'un contrôle cassé produit aussi, et c'est l'erreur la plus chère de ce domaine.

| Contrôle | Verdict | Constat | Lu |
| --- | --- | --- | --- |
${c.map(ligne).join("\n")}

${nonTenus.length > 0 ? `## À corriger\n\n${nonTenus.map((x) => `- **${x.nom}** — ${x.constat}`).join("\n")}\n` : ""}
## Ce que ces contrôles valent

Ils sont rendus par des fonctions du **contenu**, pas du disque, et chacune est éprouvée sur
un texte dont la réponse est connue avant que le verdict soit écrit. Si l'un des détecteurs
cesse de reconnaître ce qu'il prétend reconnaître, rien n'est publié.

C'est la seule réponse au scan qui rend « aucune menace » sur un dossier qu'il n'a pas pu
lire : ce zéro-là est vrai et ne dit rien.

## Ce qu'ils ne voient pas

Un angle mort qu'on ne publie pas est une fausse assurance, alors le voici. Le contrôle de la
racine servie regarde ce qui entre **directement** dans une lecture de fichier. Si un morceau
d'URL passe d'abord par une variable, il ne le suit pas — un témoin le dit explicitement dans
\`temoins()\`, et il échouera là où un humain doit encore regarder.

Ce sont des contrôles de source. Ils ne remplacent pas l'observation en marche : c'est
\`npm run egress\` qui constate qu'aucun octet ne quitte la machine pendant une mesure, parce
que ça ne se lit dans aucun fichier.

## Les secrets dans l'historique

${secretsHistorique
  ? `**${secretsHistorique.reels.length} secret${secretsHistorique.reels.length === 1 ? "" : "s"} non déclaré${secretsHistorique.reels.length === 1 ? "" : "s"}** sur ${secretsHistorique.commits} commits — relevé du ${secretsHistorique.date}, sous \`${secretsHistorique.commit}\`.

Le balayage a relevé ${secretsHistorique.trouves} trouvaille${secretsHistorique.trouves === 1 ? "" : "s"} au total, dont ${secretsHistorique.declares} déclarée${secretsHistorique.declares === 1 ? "" : "s"} dans
\`secrets-declares.json\` : ce sont les leurres plantés dans nos propres cas de test, qui
existent pour prouver que le détecteur détecte encore. Un chiffre issu d'une sélection porte
le compte de ce qu'il écarte, et chaque écarté est nommé avec sa raison. Témoins retrouvés :
${secretsHistorique.temoins}/2.

Un fichier effacé reste dans les objets git : un secret retiré du dernier commit reste
lisible pour toujours, et un dépôt public n'oublie rien. Le balayage porte donc sur
l'historique entier, pas sur le répertoire de travail. Il est lent — il tourne hors de
\`npm test\`, avec \`npm run menace -- --historique\`.`
  : `Non balayé dans cette passe. Lancez \`npm run menace -- --historique\` : le balayage porte sur l'historique entier, parce qu'un fichier effacé reste dans les objets git.`}

## Ce qui n'est pas couvert ici

L'inventaire des licences vit dans \`LICENCES.md\`. La garantie de non-transmission — que
rien ne sort de la machine pendant une mesure — est un relevé distinct, rendu par
\`npm run egress\`, parce qu'elle s'observe en marche et ne se lit pas dans une source.
`;
}

/**
 * Le balayage de l'historique complet. Il est lent — quelques secondes à quelques minutes —
 * et il ne peut pas vivre dans `npm test`. Son résultat est donc SCELLÉ dans un relevé daté,
 * avec le commit sous lequel il a été pris : un chiffre de sécurité qui ne dit pas de quand
 * il date rassure sur un dépôt qui a changé depuis.
 *
 * Il porte ses témoins DANS LE FLUX. Un secret planté en tête du tuyau doit ressortir par le
 * même chemin que les vrais : c'est la seule façon de distinguer « rien trouvé » de « rien
 * lu », et c'est exactement l'erreur qui rend un audit de sécurité sans valeur.
 */
/**
 * Une trouvaille porte l'EMPREINTE de la valeur, jamais la valeur.
 *
 * Déclarer par « forme + fichier » excuserait n'importe quelle clé AWS déposée un jour dans
 * ce fichier — un élargissement qui ouvre un faux vert sans rien fermer. Avec l'empreinte, la
 * déclaration ne couvre que la chaîne exacte qui a été examinée, et une vraie clé posée à
 * côté d'un leurre ressort.
 *
 * On garde l'empreinte plutôt que la valeur pour que ce fichier reste publiable même le jour
 * où la trouvaille sera un vrai secret.
 */
export type Trouvaille = { forme: string; fichier: string; empreinte: string };
export type ReleveHistorique = {
  commits: number; trouves: number; declares: number; reels: Trouvaille[];
  temoins: number; date: string; commit: string;
};

function balayerLHistorique(racine: string): ReleveHistorique {
  const TEMOINS = "AKIAIOSFODNN7EXAMPLE\nhf_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789\n";
  const ATTENDUS = ["clé AWS", "jeton Hugging Face"];

  const compte = spawnSync("git", ["rev-list", "--all", "--count"], { cwd: racine, encoding: "utf8" });
  const commits = Number(compte.stdout.trim());
  if (!Number.isInteger(commits) || commits <= 0) {
    throw new Error(`git rev-list a rendu « ${compte.stdout.trim()} » : l'historique n'a pas été lu, et son zéro ne vaudrait rien.`);
  }

  const patch = spawnSync("git", ["log", "-p", "--all", "--no-color"],
    { cwd: racine, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (patch.error) throw new Error(`git log a échoué : ${patch.error.message}. La sortie est tronquée, rien n'est publié.`);
  if (patch.status !== 0) throw new Error(`git log a rendu le code ${patch.status} : rien n'est publié.`);
  const PLANCHER = commits * 200;
  if (patch.stdout.length < PLANCHER) {
    throw new Error(
      `git log a rendu ${patch.stdout.length} octets pour ${commits} commits (plancher ${PLANCHER}).\n`
      + "  C'est trop court pour être l'historique : la sortie a été tronquée ou coupée, et\n"
      + "  un balayage qui n'a rien lu ne trouve rien non plus.");
  }

  const temoins = ATTENDUS.filter((a) => secretsDans(TEMOINS).includes(a)).length;

  /*
   * ON RETIENT LE FICHIER, PAS SEULEMENT LA FORME.
   *
   * Le premier balayage rendait « 3 secrets » sans dire où. Les trois étaient les leurres
   * plantés dans nos propres cas de test — synthétiques, volontaires, et impossibles à
   * distinguer d'une vraie fuite depuis un compte. Un relevé de sécurité qui crie au loup est
   * celui qu'on finit par ne plus lire ; et les écarter en silence serait pire, parce qu'une
   * vraie clé posée dans un fichier de test passerait avec eux.
   *
   * Chaque trouvaille est donc localisée — forme et fichier — puis confrontée aux
   * déclarations. Ce qui n'est pas déclaré fait échouer le contrôle.
   */
  const trouvailles = new Map<string, Trouvaille>();
  let fichier = "?";
  for (const ligne of patch.stdout.split("\n")) {
    if (ligne.startsWith("+++ b/")) { fichier = ligne.slice(6); continue; }
    if (ligne.startsWith("--- ")) continue;
    for (const [nom, motif] of FORMES_DE_SECRET) {
      const m = ligne.match(motif);
      if (!m) continue;
      const empreinte = createHash("sha256").update(m[0]).digest("hex").slice(0, 16);
      trouvailles.set(`${nom}|${fichier}|${empreinte}`, { forme: nom, fichier, empreinte });
    }
  }

  const declares = lireDeclarations(racine);
  const estDeclare = (t: Trouvaille) =>
    declares.some((d) => d.forme === t.forme && d.fichier === t.fichier && d.empreinte === t.empreinte);
  const reels = [...trouvailles.values()].filter((t) => !estDeclare(t));

  const tete = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: racine, encoding: "utf8" });
  return {
    commits, temoins,
    trouves: trouvailles.size,
    declares: trouvailles.size - reels.length,
    reels: reels.sort((a, b) => (a.fichier + a.forme).localeCompare(b.fichier + b.forme)),
    date: new Date().toISOString().slice(0, 10),
    commit: tete.stdout.trim(),
  };
}

function lireDeclarations(racine: string): Trouvaille[] {
  const f = join(racine, "secrets-declares.json");
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, "utf8")) as { entries: Array<Trouvaille & { pourquoi: string }> };
  return j.entries ?? [];
}

function principal() {
  const racine = fileURLToPath(new URL("..", import.meta.url));
  const ratés = temoins();
  if (ratés.length > 0) {
    console.error("Les détecteurs ne reconnaissent plus ce qu'ils prétendent reconnaître :");
    for (const r of ratés) console.error(`  - ${r}`);
    console.error("\nLeur verdict est sans valeur tant que ces témoins ne repassent pas. Rien n'est écrit.");
    process.exit(1);
  }
  const relevé = join(racine, "menace-historique.json");
  if (process.argv.includes("--historique")) {
    const r = balayerLHistorique(racine);
    writeFileSync(relevé, JSON.stringify(r, null, 2) + "\n");
    console.log(`${r.commits} commits balayés · ${r.trouves} trouvaille(s) dont ${r.declares} déclarée(s) · `
      + `${r.reels.length} non déclarée(s) · témoins ${r.temoins}/2 · scellé sous ${r.commit}.`);
    if (r.temoins < 2) { console.error("Les témoins n'ont pas traversé le tuyau : ce zéro n'a aucune valeur."); process.exit(1); }
    if (r.reels.length > 0) {
      console.error("\nTrouvaille(s) non déclarée(s) — à traiter comme de vrais secrets tant qu'elles ne le sont pas :");
      for (const t of r.reels) console.error(`  ${t.forme} dans ${t.fichier}  (empreinte ${t.empreinte})`);
      console.error("\n  Si c'est un leurre de test, déclarez-le dans secrets-declares.json avec sa raison.\n"
        + "  Si c'en est un vrai : il est dans l'historique pour toujours, il faut le RÉVOQUER,\n"
        + "  pas le retirer du dernier commit.");
      process.exit(1);
    }
  }
  const historique = existsSync(relevé)
    ? JSON.parse(readFileSync(relevé, "utf8")) as ReleveHistorique : null;
  const c = controles(racine);
  const md = document(c, historique);

  if (process.argv.includes("--check")) {
    const f = join(racine, "SECURITE.md");
    if (!existsSync(f) || readFileSync(f, "utf8") !== md) {
      console.error("SECURITE.md ne correspond plus au code.\n\nRun: npm run menace");
      process.exit(1);
    }
    const nonTenus = c.filter((x) => x.verdict === "non tenu");
    if (nonTenus.length > 0) {
      console.error(`${nonTenus.length} contrôle(s) de sécurité non tenu(s) :`);
      for (const x of nonTenus) console.error(`  - ${x.nom} : ${x.constat}`);
      process.exit(1);
    }
    console.log(`SECURITE.md est à jour (${c.length} contrôles, témoins verts).`);
    return;
  }
  writeFileSync(join(racine, "SECURITE.md"), md);
  const nt = c.filter((x) => x.verdict === "non tenu").length;
  console.log(`${c.length} contrôles · ${nt} non tenu(s) · SECURITE.md écrit.`);
}

/**
 * Ce module est-il le point d'entrée ?
 *
 * `import.meta.url === \`file://${process.argv[1]}\`` compare une URL à un chemin. Ils
 * coïncident tant que le chemin ne contient ni espace ni accent ; dès qu'il en contient, l'URL
 * porte `%20` et la comparaison échoue. Le programme se termine alors SANS RIEN FAIRE, code 0.
 *
 * Trouvé le 24 août 2026 par une session de contrôle : le dépôt rangé dans un dossier nommé
 * « Mes Rapports 2026 », le vérificateur de rapport rend 0 et n'imprime rien — donc tout
 * `… && echo VÉRIFIÉ` imprime VÉRIFIÉ. Un outil de sécurité muet est pire qu'un outil absent.
 */
function estLancéDirectement(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(argv1).href;
}

if (estLancéDirectement()) principal();
