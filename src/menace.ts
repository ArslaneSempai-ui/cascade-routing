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

  /*
   * ─── LES FORMATS D'AUJOURD'HUI, QUE LES MOTIFS D'HIER NE VOIENT PAS ───
   *
   * Mesuré le 25 août 2026 sur seize formes fabriquées : le détecteur en reconnaissait DIX.
   * Les six manquantes n'étaient pas exotiques — c'étaient, pour trois d'entre elles, les
   * formats COURANTS d'OpenAI, d'Anthropic et de GitHub.
   *
   * La cause est la même pour les trois, et elle est instructive : `sk-[A-Za-z0-9]{20,}`
   * s'arrête au premier tiret. `sk-proj-…` et `sk-ant-api03-…` en portent un juste après le
   * préfixe, donc le motif ne mordait que sur les huit caractères qui précèdent et échouait
   * sur la borne `\b`. Un motif écrit pour le format d'une époque cesse silencieusement de
   * voir la suivante — et son zéro continue de s'afficher, identique.
   *
   * C'est ce qui rend la ligne publiée dangereuse : « 0 secret non déclaré » se lisait comme
   * « aucun secret », alors qu'il fallait lire « aucun PARMI LES FORMES QU'ON REGARDE ».
   * SECURITE.md porte désormais ce dénominateur.
   *
   * Le JWT est VOLONTAIREMENT absent : un jeton signé est souvent public et de courte durée,
   * et son motif — trois blocs base64 séparés par des points — mord sur des chaînes qui n'en
   * sont pas. Une forme qui crie sans raison fait ignorer la liste entière.
   */
  ["clé OpenAI projet", /\bsk-proj-[A-Za-z0-9_-]{20,}\b/],
  ["clé Anthropic", /\bsk-ant-(?:api\d{2}|admin\d{2})-[A-Za-z0-9_-]{20,}\b/],
  ["jeton GitHub à portée fine", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ["clé Twilio", /\bSK[0-9a-f]{32}\b/],
  ["clé SendGrid", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\b/],

  /*
   * LA FORME SOUS LAQUELLE NOTRE PROPRE CLÉ VOYAGERAIT.
   *
   * Les motifs ci-dessus reconnaissent une clé privée à son en-tête PEM. Or une clé posée dans
   * une variable d'environnement ou dans un secret d'intégration continue n'a PAS d'en-tête :
   * c'est du base64 nu. C'est exactement la forme sous laquelle la clé qui signe nos rapports
   * circulerait, et elle était invisible.
   *
   * Le préfixe est constant parce que le codage DER l'est : mesuré sur 5 000 tirages Ed25519,
   * 2 000 X25519 et 1 000 EC, une seule valeur à chaque fois. Le RSA fait exception — l'octet
   * de longueur du module bouge, six valeurs sur 120 tirages — donc son motif s'ancre sur
   * l'identifiant d'algorithme, qui ne bouge pas, et non sur le préfixe.
   *
   * Trouvé par une session de contrôle, et la première version de sa mesure était fausse : un
   * préfixe « constant » relevé sur un tirage est une affirmation, pas une mesure.
   */
  ["clé Ed25519 sans en-tête", /\bMC4CAQAwBQYDK2Vw[A-Za-z0-9+/]{20,}/],
  ["clé X25519 sans en-tête", /\bMC4CAQAwBQYDK2Vu[A-Za-z0-9+/]{20,}/],
  ["clé RSA sans en-tête", /\bMII[A-Za-z0-9+/]{2,6}IBADANBgkqhkiG9w0BAQ[A-Za-z0-9+/]{20,}/],
  ["clé EC sans en-tête", /\bMI[A-Za-z0-9+/]{1,5}AgEAM[A-Za-z0-9+/]{2}GByqG[A-Za-z0-9+/]{20,}/],

  /* Deux jetons que les motifs voisins manquaient d'UN caractère : la forme OpenAI exige
     `sk-` avec un tiret, Stripe écrit `sk_live_` avec un tiret bas ; et la classe Slack
     `[baprs]` ne contenait pas le `e` de `xoxe-`. Un motif est une affirmation, et un
     caractère d'écart la rend fausse en silence. */
  ["jeton Stripe", /\b[sr]k_(live|test)_[A-Za-z0-9]{20,}/],
  ["jeton Slack étendu", /\bxox[abeprs]-[A-Za-z0-9-]{10,}/],

  /* Un mot de passe dans une URL de connexion. Il ne ressemble à aucune clé, il n'a aucun
     préfixe, et il traverse les journaux comme les fichiers de configuration. */
  ["identifiants dans une URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']{6,}@/],
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

  /* Les formes sans en-tête PEM — celle sous laquelle NOTRE clé de signature voyagerait. */
  v("Ed25519 nu", secretsDans("CLE=MC4CAQAwBQYDK2VwBCIEIL9kM0hVvBTz3nQd7yPKcE1sXaWq2vRtYuIoPlKjHgFd"), ["clé Ed25519 sans en-tête"]);
  v("X25519 nu", secretsDans("K=MC4CAQAwBQYDK2VuBCIEIA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1vW2xY3zA4bC"), ["clé X25519 sans en-tête"]);
  v("RSA nu", secretsDans("K=MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7vbqajDw4o6gJ"), ["clé RSA sans en-tête"]);
  v("base64 anodin", secretsDans("const b = 'aGVsbG8gd29ybGQgY2VjaSBuJ2VzdCBwYXMgdW5lIGNsZQ==';"), []);

  /*
   * ─── CE TÉMOIN EST ASSEMBLÉ, PARCE QU'ÉCRIT EN ENTIER IL BLOQUE TOUTE POUSSÉE ───
   *
   * Écrit littéralement, `sk_live_…` ressemble assez à une vraie clé Stripe pour que la
   * protection de GitHub refuse le `git push` : « Push cannot contain secrets », en nommant
   * cette ligne dans cinq commits. Notre propre témoin de détection de secrets était détecté
   * comme un secret.
   *
   * Ce n'est pas un faux positif de leur part : leur motif fait exactement son travail. C'est
   * notre témoin qui n'avait pas besoin de ressembler à une clé PLAUSIBLE — il a besoin de
   * correspondre à NOTRE motif, ce que la concaténation préserve intégralement.
   *
   * Et ça ne coûtait pas qu'à nous : n'importe qui clonant ce dépôt et poussant vers son
   * propre distant se serait fait bloquer par la même règle, sur notre ligne, sans savoir
   * pourquoi. Un dépôt qui vend un audit de sécurité ne peut pas demander qu'on autorise un
   * secret pour le publier.
   *
   * Le débloquer par l'interface aurait marché et aurait été la mauvaise réponse : il aurait
   * fallu inscrire une exception permanente chez GitHub pour une chaîne qui n'a jamais eu
   * besoin d'exister sous cette forme.
   */
  const TEMOIN_STRIPE = "sk" + "_live_" + "51H8xKqL2eZvKYlo2C0" + "abcdefghij";
  v("jeton Stripe", secretsDans(TEMOIN_STRIPE), ["jeton Stripe"]);
  v("Slack étendu", secretsDans("xoxe-2-abcdefghij-klmnop"), ["jeton Slack étendu"]);
  v("mot de passe dans une URL", secretsDans("postgres://admin:Tr0ub4dor3@db.interne:5432/prod"), ["identifiants dans une URL"]);
  v("URL sans identifiants", secretsDans("postgres://db.interne:5432/prod"), []);
  v("URL avec port seulement", secretsDans("http://localhost:11434/api/generate"), []);

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

  /*
   * LE DÉNOMINATEUR NE RÉTRÉCIT PAS EN SILENCE.
   *
   * Quand `src/server.ts` manquait, cette branche ne déclarait QU'UN de ses trois contrôles
   * en « hors de portée » : les deux autres disparaissaient du tableau, et le document
   * publiait « 3 contrôles tenus sur 4 » alors qu'il y en a six. C'est la faute contre
   * laquelle ce document est écrit, commise par lui — un chiffre issu d'une sélection doit
   * porter le compte de ce qu'il écarte, et celui-ci écartait sans compter.
   *
   * Les trois contrôles existent toujours, dans les deux cas. Trouvé par une session de
   * contrôle le 24 août 2026.
   */
  const CONTROLES_SERVEUR = ["Listening address", "Served root", "Request body bounded"] as const;
  const serveur = lire("src/server.ts");
  if (serveur === null) {
    for (const nom of CONTROLES_SERVEUR) {
      ajout(nom, null, "src/server.ts is missing: this check could look at nothing.", "0 files read");
    }
  } else {
    const a = adresseDEcoute(serveur);
    ajout("Listening address", a === "boucle locale",
      `The server listens on ${a === "boucle locale" ? "the loopback" : a === "toutes interfaces" ? "all interfaces" : "nothing"}. Listening on all interfaces makes it reachable from the local network, and therefore from a shared wifi.`,
      "src/server.ts");
    const r = racineServie(serveur);
    ajout("Served root", !r.construitDepuisLUrl,
      r.construitDepuisLUrl
        ? "A file path is assembled from the URL: the server can be walked out of its root."
        : `Only literal paths are served (${r.liste.join(", ") || "none"}). The URL is compared, never concatenated.`,
      "src/server.ts");
    const b = bornePosee(serveur);
    ajout("Request body bounded", b.plafond && b.fluxCoupe,
      b.plafond && !b.fluxCoupe
        ? "A cap exists but the stream is not cut: the promise settles while the bytes keep arriving."
        : b.plafond ? "The body is capped and the socket destroyed at the limit."
        : "No cap on a request body at all.",
      "src/server.ts");
  }

  const ecran = lire("src/ui.html");
  if (ecran === null) ajout("Third-party resources", null, "src/ui.html is missing.", "0 files read");
  else {
    const h = hotesExternes(ecran);
    ajout("Third-party resources", h.length === 0,
      h.length === 0
        ? "The screen loads nothing from a third-party domain. A dependency loaded from a domain you do not control runs with the page's privileges."
        : `Hosts contacted: ${h.join(", ")}.`,
      "src/ui.html");
  }

  const ignore = lire(".gitignore");
  const dataIgnore = ignore !== null && /^data\/?$/m.test(ignore);
  /* LE CONSTAT DISAIT LA MÊME CHOSE DANS LES DEUX CAS. Quand il échouait, la phrase
     affirmait exactement ce qui était faux — un tableau où l'on doit lire la colonne
     « verdict » pour savoir si la colonne « constat » ment. */
  ajout("Client data unversioned", dataIgnore,
    dataIgnore
      ? "Measurements taken on a client's data live in data/, which git ignores. What is not versioned does not travel into a public repository."
      : ignore === null
        ? "No .gitignore at all: nothing stops measurements taken on a client's data from leaving at the first commit."
        : "data/ is not ignored by git: measurements taken on a client's data would go into the public repository at the first commit.",
    ".gitignore");

  const verrou = lire("package-lock.json");
  if (verrou === null) ajout("Dependency fingerprints", null, "package-lock.json is missing.", "0 files read");
  else {
    const i = integriteDuVerrou(JSON.parse(verrou));
    ajout("Dependency fingerprints", i.sans.length === 0,
      i.sans.length === 0
        ? "Every dependency carries a content fingerprint: the package installed is the one that was measured."
        : `Without a fingerprint: ${i.sans.join(", ")}.`,
      /* LE DÉNOMINATEUR NOMME CE QUI A ÉTÉ LU, PAS SEULEMENT COMBIEN. Il annonçait « 82
         dependencies » — un compte. Tous les autres contrôles nomment leur fichier, et c'est
         la règle que ce document énonce lui-même : « chaque ligne porte ce qui a été lu ».
         Un lecteur qui veut refaire le contrôle a besoin du fichier. */
      `package-lock.json, ${i.total} dependencies`);
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
    `| ${x.nom} | ${x.verdict === "tenu" ? "held" : x.verdict === "non tenu" ? "**not held**" : "out of reach"} | ${x.constat} | \`${x.denominateur}\` |`;

  return `<!-- GENERATED BY src/menace.ts — DO NOT EDIT BY HAND -->
# Attack surface

${tenus} check${tenus > 1 ? "s" : ""} held out of ${c.length}${nonTenus.length > 0 ? `, ${nonTenus.length} not held` : ""}${horsPortee.length > 0 ? `, ${horsPortee.length} out of reach` : ""}.

Every row carries **what was read**. "No threats found" without a denominator is the sentence
a broken scan produces too, and that is the most expensive mistake in this field.

| Check | Verdict | Finding | Read |
| --- | --- | --- | --- |
${c.map(ligne).join("\n")}

${nonTenus.length > 0 ? `## To fix\n\n${nonTenus.map((x) => `- **${x.nom}** — ${x.constat}`).join("\n")}\n` : ""}
## What these checks are worth

They are functions of **content**, not of the disk, and each one is proved against a text
whose answer is known before any verdict is written. If a detector stops recognising what it
claims to recognise, nothing is published at all.

That is the only answer to the scan that reports "no threats found" on a directory it could
not read: that zero is true and says nothing.

## What they do not see

A blind spot nobody publishes is a false reassurance, so here it is. The served-root check
looks at what enters a file read **directly**. If a piece of URL passes through a variable
first, it does not follow it — a witness says so explicitly in \`temoins()\`, and it will fail
exactly where a human still has to look.

These are source checks. They do not replace watching the thing run: it is \`npm run egress\`
that establishes no byte leaves the machine during a measurement, because that cannot be read
in any file.

## Secrets in the history

${secretsHistorique
  ? `**${secretsHistorique.reels.filter((t) => t.publie).length} undeclared secret${secretsHistorique.reels.filter((t) => t.publie).length === 1 ? "" : "s"} in the published history** across ${secretsHistorique.commits} commits — swept on ${secretsHistorique.date}, sealed at \`${secretsHistorique.commit}\`.${
  secretsHistorique.reels.some((t) => !t.publie)
    ? `\n\nThe sweep reads \`--all\`, which on the author's machine also covers backup branches and
the \`refs/original/\` a history rewrite leaves behind. ${secretsHistorique.reels.filter((t) => !t.publie).length} match${secretsHistorique.reels.filter((t) => !t.publie).length === 1 ? " sits" : "es sit"} there and **${secretsHistorique.reels.filter((t) => !t.publie).length === 1 ? "is" : "are"} not in
what you cloned** — reachability from \`HEAD\` is checked per match rather than assumed. They are
named rather than dropped, because a ref nobody pushes today can be pushed tomorrow.`
    : ""}

Read that as **none among the ${FORMES_DE_SECRET.length} shapes this sweep looks for**, which is the only
claim it can make. A pattern written for one era stops seeing the next one in silence, and its
zero keeps printing unchanged: on 2026-08-25 the detector missed the CURRENT formats of three
major providers because their prefix carries a hyphen the old pattern stopped at. The shapes
are listed in \`src/menace.ts\`; a figure drawn from a selection carries the count of what it
excludes.

The sweep found ${secretsHistorique.trouves} match${secretsHistorique.trouves === 1 ? "" : "es"} in total, of which ${secretsHistorique.declares} ${secretsHistorique.declares === 1 ? "is" : "are"} declared in
\`secrets-declares.json\`: those are the decoys planted in our own test cases, which exist to
prove the detector still detects. A figure drawn from a selection carries the count of what it
excludes, and every exclusion is named with its reason. Witnesses recovered:
${secretsHistorique.temoins}/2.

A deleted file stays in git's objects: a secret removed from the last commit remains readable
forever, and a public repository forgets nothing. The sweep therefore covers the entire
history, not the working tree. It is slow — it runs outside \`npm test\`, with
\`npm run menace -- --historique\`.`
  : `Not swept in this pass. Run \`npm run menace -- --historique\`: the sweep covers the whole history, because a deleted file stays in git's objects.`}

## What is not covered here

The licence inventory lives in \`LICENCES.md\`. The non-transmission guarantee — that nothing
leaves the machine during a measurement — is a separate relevé, produced by \`npm run egress\`,
because it is observed while running and cannot be read from a source file.
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
export type Trouvaille = { forme: string; fichier: string; empreinte: string;
  /** Atteignable depuis HEAD, donc présent dans ce que reçoit un clone. Absent = local seulement. */
  publie?: boolean };
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
    throw new Error(`git rev-list returned "${compte.stdout.trim()}": the history was not read, and its zero would be worthless.`);
  }

  const patch = spawnSync("git", ["log", "-p", "--all", "--no-color"],
    { cwd: racine, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (patch.error) throw new Error(`git log failed: ${patch.error.message}. The output is truncated; nothing is published.`);
  if (patch.status !== 0) throw new Error(`git log returned code ${patch.status}: nothing is published.`);
  const PLANCHER = commits * 200;
  if (patch.stdout.length < PLANCHER) {
    throw new Error(
      `git log returned ${patch.stdout.length} bytes for ${commits} commits (floor ${PLANCHER}).\n`
      + "  That is too short to be the history: the output was truncated or cut, and a sweep\n"
      + "  that read nothing finds nothing either.");
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
  /*
   * ─── DEUX DÉFAUTS D'ATTRIBUTION, TROUVÉS LE 25 AOÛT 2026 EN REMONTANT UNE FAUSSE ALERTE ───
   *
   * Le relevé accusait `.github/workflows/verifier.yml` de porter six formes de secret. Aucun
   * commit de ce fichier n'en contient une seule : le contenu venait de `src/menace.ts` et de
   * ses cas.
   *
   * 1. LE NOM DU FICHIER NE SE MET PAS À JOUR SUR UNE SUPPRESSION. Un fichier effacé donne
   *    `+++ /dev/null`, donc `fichier` gardait la valeur du diff PRÉCÉDENT et toutes les
   *    trouvailles du hunk suivant lui étaient imputées. On lit désormais `--- a/` aussi, et
   *    l'on repart de « ? » à chaque commit — un message de commit n'appartient à aucun fichier.
   *
   * 2. LES LIGNES SUPPRIMÉES ÉTAIENT COMPTÉES. Une ligne `-` retire un secret ; elle ne
   *    l'introduit pas. Son introduction a déjà été comptée sur la ligne `+` du commit qui
   *    l'a ajoutée — la retenir une seconde fois double la trouvaille ET la place au mauvais
   *    endroit. Seules les lignes AJOUTÉES comptent.
   *
   * Un diagnostic qui désigne le mauvais fichier coûte plus cher qu'aucun diagnostic : il
   * envoie chercher là où il n'y a rien, et le jour où il dit vrai, on ne le croit plus.
   */
  /*
   * CE QU'UN CLONE REÇOIT N'EST PAS CE QUE CE DISQUE PORTE.
   *
   * `git log --all` balaie aussi les branches de sauvegarde et `refs/original/`, que la
   * réécriture laisse derrière elle et que personne ne pousse. Le 25 août 2026, six formes de
   * secret y ont été trouvées — dans un bac à sable Stryker commité par erreur puis retiré de
   * `main`. Le dépôt PUBLIÉ est propre ; le disque local ne l'est pas.
   *
   * On garde `--all`, parce qu'une référence non poussée aujourd'hui peut l'être demain et que
   * le silence sur ce risque serait pire. Mais chaque trouvaille porte désormais si elle est
   * atteignable depuis HEAD : « le clone de l'acheteur la contient » et « elle dort dans une
   * branche de sauvegarde chez moi » n'appellent ni la même urgence ni la même correction.
   */
  const atteignables = new Set(
    (spawnSync("git", ["rev-list", "HEAD"], { cwd: racine, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .stdout || "").split("\n").map((l) => l.trim()).filter(Boolean));
  const trouvailles = new Map<string, Trouvaille>();
  let fichier = "?", sha = "";
  for (const ligne of patch.stdout.split("\n")) {
    const nouveauCommit = ligne.match(/^commit ([0-9a-f]{7,40})/);
    if (nouveauCommit) { fichier = "?"; sha = nouveauCommit[1]!; continue; }
    if (ligne.startsWith("--- ")) {
      /* `--- a/X` nomme le fichier d'AVANT : utile quand `+++` vaut /dev/null. */
      if (ligne.startsWith("--- a/")) fichier = ligne.slice(6);
      continue;
    }
    if (ligne.startsWith("+++ ")) {
      if (ligne.startsWith("+++ b/")) fichier = ligne.slice(6);
      continue;
    }
    if (!ligne.startsWith("+")) continue;
    for (const [nom, motif] of FORMES_DE_SECRET) {
      const m = ligne.match(motif);
      if (!m) continue;
      const empreinte = createHash("sha256").update(m[0]).digest("hex").slice(0, 16);
      const cle = `${nom}|${fichier}|${empreinte}`;
      const publie = atteignables.has(sha);
      const vu = trouvailles.get(cle);
      /* Une même trouvaille peut apparaître dans plusieurs commits : elle est publiée dès
         qu'UN seul de ces commits l'est. */
      trouvailles.set(cle, { forme: nom, fichier, empreinte, publie: publie || vu?.publie === true });
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

/**
 * L'EMPREINTE SCELLÉE EXISTE-T-ELLE ENCORE DANS LE DÉPÔT QU'ON PUBLIE ?
 *
 * `SECURITE.md` annonce « swept on <date>, sealed at <commit> » pour qu'un acheteur puisse
 * rejouer le balayage à ce point précis. Le 25 août 2026, une session a cloné le dépôt PUBLIÉ
 * et lancé `git cat-file -t` sur l'empreinte citée : **`fatal: Not a valid object name`.** Une
 * réécriture d'historique avait changé les 142 empreintes, et le document continuait de citer
 * l'ancienne. L'acheteur venu contrôler le balayage des secrets ne le pouvait pas.
 *
 * ET LE DÉPÔT LOCAL NE PEUT PAS VOIR CE DÉFAUT : après une réécriture, il garde les objets
 * orphelins, donc `git cat-file` y répond « commit » sur une empreinte que personne d'autre
 * ne trouvera. Le contrôle ne vaut donc que s'il exige l'ACCESSIBILITÉ depuis une référence,
 * pas la simple existence de l'objet.
 */
export function empreinteScelleeAtteignable(racine: string, commit: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) return false;
  /* `--all` restreint aux commits atteignables depuis une référence : c'est exactement ce
     qu'un clone recevra. `cat-file -t` répondrait « commit » sur un objet orphelin. */
  const r = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: racine, encoding: "utf8" });
  return r.status === 0;
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
    console.error("The detectors no longer recognise what they claim to recognise:");
    for (const r of ratés) console.error(`  - ${r}`);
    console.error("\nTheir verdict is worthless until those witnesses pass again. Nothing was written.");
    process.exit(1);
  }
  const relevé = join(racine, "menace-historique.json");
  if (process.argv.includes("--historique")) {
    const r = balayerLHistorique(racine);
    writeFileSync(relevé, JSON.stringify(r, null, 2) + "\n");
    console.log(`${r.commits} commits swept · ${r.trouves} match(es), ${r.declares} declared · `
      + `${r.reels.length} undeclared · witnesses ${r.temoins}/2 · sealed at ${r.commit}.`);
    if (r.temoins < 2) { console.error("The witnesses did not make it through the pipe: this zero is worthless."); process.exit(1); }
    const publies = r.reels.filter((t) => t.publie);
    const locaux = r.reels.filter((t) => !t.publie);
    if (locaux.length > 0) {
      console.error(`\n${locaux.length} undeclared match(es) reachable ONLY from local refs — `
        + `a clone of this repository does not contain them:`);
      for (const t of locaux) console.error(`  ${t.forme} in ${t.fichier}  (fingerprint ${t.empreinte})`);
      console.error("  These live in backup branches or refs/original/ left by a history rewrite.\n"
        + "  Nothing is published today. Pushing one of those refs would publish all of it, so\n"
        + "  they are named rather than ignored — and deleting a ref is not this tool's call.");
    }
    if (publies.length > 0) {
      console.error("\nUndeclared match(es) IN THE PUBLISHED HISTORY — treat them as real secrets until declared:");
      for (const t of publies) console.error(`  ${t.forme} in ${t.fichier}  (fingerprint ${t.empreinte})`);
      console.error("\n  If it is a test decoy, declare it in secrets-declares.json with its reason.\n"
        + "  If it is real: it is in the history forever, and it must be REVOKED —\n"
        + "  not removed from the last commit.");
      process.exit(1);
    }
  }
  const historique = existsSync(relevé)
    ? JSON.parse(readFileSync(relevé, "utf8")) as ReleveHistorique : null;

  /*
   * LE SCELLÉ PUBLIÉ DOIT ÊTRE REJOUABLE PAR CELUI QUI LIT LA PAGE.
   *
   * Sans ce refus, `SECURITE.md` continue d'annoncer une empreinte que la réécriture
   * d'historique a effacée, et l'acheteur qui veut contrôler le balayage des secrets tombe
   * sur « Not a valid object name ». Un scellé invérifiable est pire qu'aucun scellé : il
   * affirme une vérification que personne ne peut refaire.
   */
  if (historique && !empreinteScelleeAtteignable(racine, historique.commit)) {
    console.error(
      `SECURITE.md seals the secret sweep at \`${historique.commit}\`, which is NOT reachable `
      + `from HEAD.\n\n`
      + `  A rewrite changed the history and the seal was left behind. A buyer who clones this\n`
      + `  repository cannot replay the sweep at that point, so the line claims a verification\n`
      + `  nobody can repeat.\n\n`
      + `  Note that a local clone CANNOT see this on its own: after a rewrite it keeps the\n`
      + `  orphaned objects, so \`git cat-file\` still answers. Reachability is the property.\n\n`
      + `  Run: npm run menace -- --historique`);
    process.exit(1);
  }
  const c = controles(racine);
  const md = document(c, historique);

  if (process.argv.includes("--check")) {
    const f = join(racine, "SECURITE.md");
    if (!existsSync(f) || readFileSync(f, "utf8") !== md) {
      console.error("SECURITE.md no longer matches the code.\n\nRun: npm run menace");
      process.exit(1);
    }
    const nonTenus = c.filter((x) => x.verdict === "non tenu");
    if (nonTenus.length > 0) {
      console.error(`${nonTenus.length} security check(s) not held:`);
      for (const x of nonTenus) console.error(`  - ${x.nom} : ${x.constat}`);
      process.exit(1);
    }
    console.log(`SECURITE.md is up to date (${c.length} checks, witnesses green).`);
    return;
  }
  writeFileSync(join(racine, "SECURITE.md"), md);
  const nt = c.filter((x) => x.verdict === "non tenu").length;
  console.log(`${c.length} checks · ${nt} not held · SECURITE.md written.`);
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
