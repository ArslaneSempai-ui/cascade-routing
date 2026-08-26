/**
 * LA DÉMO PUBLIÉE.
 *
 * Le même `ui.html` sert ici et en local : ce qui change est un shim qui répond aux mêmes
 * routes avec les mêmes formes. Deux écrans divergeraient au premier correctif.
 *
 * Ce que le shim ne fait pas : mesurer. Le profil des paliers coûte deux minutes de
 * modèles téléchargés, il est mesuré une fois et figé dans `data/profiles.json` ; la page
 * l'emporte tel quel. Un visiteur ne relance donc aucun modèle — il rejoue l'arithmétique
 * sur des mesures datées, et la page le dit.
 *
 * Pas d'accent grave dans le shim : il vit dans un gabarit, et un seul le referme au
 * milieu. Concaténation avec `+`, et les commentaires citent le code sans le baliser.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * LES SOURCES QUI PRODUISENT LA PAGE, déclarées ici parce que c'est ici qu'on les lit.
 *
 * La liste vivait dans un fichier de cas, à côté du contrôle qui l'employait — donc à un
 * endroit où rien ne la confrontait à la construction réelle. Une source ajoutée à la
 * construction n'y serait jamais apparue, et le contrôle aurait continué de rendre vert sur
 * une liste incomplète.
 */
export const PRODUISENT_LA_PAGE = ["ui.html", "gabarit.html", "pages.ts", "registre.css", "graphes.js"] as const;
import { fileURLToPath } from "node:url";
import { isMain } from "./cli.ts";
import { readProfiles, RELEVE_DE_REFERENCE } from "./measure.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

/*
 * LA PAGE PUBLIÉE NE POUVAIT PAS ÊTRE REFAITE SUR UN CLONE FRAIS.
 *
 * Cette ligne lisait `data/profiles.json` en direct. `data/` n'est pas versionné — c'est
 * voulu, il porte les mesures faites sur les données d'un client — donc la commande plantait
 * sur ENOENT chez quiconque clone, nous compris après un nettoyage. Toutes les autres
 * commandes passent par `readProfiles()`, qui retombe sur le relevé de référence livré avec
 * le dépôt ; celle-ci était la seule à ne pas le faire.
 *
 * Conséquence mesurée : la page publiée faisait tourner du code vieux de plusieurs commits,
 * parce que personne ne pouvait la régénérer et que rien ne le signalait.
 */
const PROFIL_UTILISE = (() => {
  const p = readProfiles();
  if (!p) {
    console.error(
      "no reading to build the page from.\n\n"
      + "  This is normally impossible: a reference relevé ships with the repository.\n"
      + "  If it is gone, restore it with `git checkout profiles-*.json`.");
    process.exit(1);
  }
  return p;
})();

/*
 * LE RELEVÉ EST UNE SOURCE DE LA PAGE, AU MÊME TITRE QUE `ui.html`.
 *
 * Il ne l'était pas, et la conséquence a été mesurée le 26 août 2026 : on remesure, on
 * rescelle, on refait les figures, le dossier et la sonde — la discipline complète — et
 * `npm test` rend 442 sur 442 avec sortie 0 pendant que `docs/index.html` sert toujours
 * l'ancien chiffre. Seul `npm run pages` refait la page, et rien ne le disait.
 *
 * Le sceau ci-dessous ne couvrait que le CODE qui produit la page. Un code inchangé qui
 * recopie un relevé changé rend une page fausse dont toutes les empreintes concordent :
 * la garde regardait à côté de ce qui peut mentir.
 *
 * On enregistre donc l'empreinte du relevé employé à la construction, et le contrôle de
 * fraîcheur la compare à celle du relevé de référence tel qu'il est aujourd'hui. Deux
 * causes distinctes rougissent, et le message les sépare :
 *   — le relevé a été remesuré depuis, donc la page est périmée ;
 *   — la page a été construite depuis une mesure locale que `data/` ne versionne pas,
 *     donc personne d'autre ne peut la refaire.
 */
const RELEVE_DE_LA_PAGE = {
  attendu: RELEVE_DE_REFERENCE,
  empreinte: (PROFIL_UTILISE as unknown as Record<string, unknown>).empreinte,
};

const PROFILS = JSON.stringify(PROFIL_UTILISE);

const SHIM = `<script>window.LOCAL_PRET = new Promise((r) => { window.LOCAL_POSE = r; });</` + `script>
<script type="module">
import { FIELDS } from "./js/corpus.js";
import { TIERS } from "./js/paliers.js";
import { evaluer, optimiseExtraction, budgetShadowPrice, latenceRepresentative } from "./js/optimise.js";
import { ASSUMPTIONS, BOUNDS, pricePerThousandExtractions, accuracy } from "./js/assumptions.js";

/* Le profil mesuré, embarqué tel quel : la page ne mesure rien, elle rejoue. */
const profils = ${PROFILS};

let hypotheses = { ...ASSUMPTIONS };
let routage = Object.fromEntries(FIELDS.map((c) => [c, "large"]));

const etat = () => {
  const optimum = optimiseExtraction(profils, hypotheses);
  const mien = evaluer(profils, hypotheses, routage);
  return {
    champs: FIELDS,
    paliers: TIERS,
    routage,
    justesse: Object.fromEntries(FIELDS.map((c) => [
      c, Object.fromEntries(TIERS.map((e) => [e, accuracy(e, profils.extraction[e][c].accuracy, hypotheses)])),
    ])),
    prix: Object.fromEntries(TIERS.map((e) => [e, pricePerThousandExtractions(e, hypotheses, latenceRepresentative(profils, e))])),
    mien,
    optimum,
    uniformes: TIERS.map((e) => ({
      palier: e,
      ...evaluer(profils, hypotheses, Object.fromEntries(FIELDS.map((c) => [c, e]))),
    })),
    prochainGain: budgetShadowPrice(profils, hypotheses),
    hypotheses,
    bornes: BOUNDS,
    /*
     * LES TAILLES D'ÉCHANTILLON VOYAGENT AVEC LES TAUX.
     *
     * La légende de la figure de routage annonçait 120 documents pour les sept paliers,
     * alors que quatre sont mesurés sur mille. Elle le tapait à la main parce que rien
     * dans l'état ne le portait. On le porte.
     *
     * Un même palier a la même taille sur les cinq champs — c'est une propriété de la
     * mesure, pas une hypothèse : items sort du même relevé pour tous les champs d'un
     * palier. On lit donc le premier champ, et le cas legende-figure.test.ts refuse si
     * un palier porte deux tailles différentes selon le champ.
     *
     * DEUX CONTRAINTES D'ÉCRITURE ICI, et je les ai cassées toutes les deux avant de les
     * lire. (1) Aucun accent grave : ce bloc vit dans un gabarit, et un seul le refermerait
     * au milieu — l'en-tête du fichier le dit. (2) Aucune syntaxe TypeScript : ce corps est
     * ÉMIS TEL QUEL dans la page, donc un !  de non-nullité y devient une erreur de syntaxe
     * dans le navigateur. tsc compilait ; c'est le vérificateur d'écran qui l'a vue, en
     * rendant la page.
     */
    echantillons: Object.fromEntries(TIERS.map((e) => [e, profils.extraction[e][FIELDS[0]].items])),
    mesureLe: profils.measuredAt,
  };
};

window.LOCAL = async (chemin, corps) => {
  if (chemin === "/api/etat") return etat();
  if (chemin === "/api/routage") {
    const champ = String(corps.champ || ""), palier = String(corps.palier || "");
    if (FIELDS.includes(champ) && TIERS.includes(palier)) routage = { ...routage, [champ]: palier };
    return etat();
  }
  if (chemin === "/api/optimum") {
    const o = optimiseExtraction(profils, hypotheses);
    if (o) routage = { ...o.routing };
    return etat();
  }
  if (chemin === "/api/hypotheses") {
    if (corps.remise) hypotheses = { ...ASSUMPTIONS };
    else for (const [cle, bornes] of Object.entries(BOUNDS)) {
      /* MEME GARDE QUE DANS LE SERVEUR, ET C EST LE POINT : la demo publiee portait la faute
         mot pour mot, donc corriger un seul des deux la laisse la ou l acheteur regarde.
         Ce commentaire est ecrit sans accent grave et sans apostrophe : il vit DANS un
         gabarit, et un accent grave le fermerait. Quatrieme fois aujourd hui dans l equipe
         qu une insertion casse un gabarit ; la premiere pour moi, apres l avoir signalee
         deux fois aux autres. */
      const v = corps[cle];
      if (typeof v === "number" && Number.isFinite(v)) hypotheses = { ...hypotheses, [cle]: Math.min(bornes[1], Math.max(bornes[0], v)) };
    }
    return etat();
  }
  return {};
};

/* Le shim est en place : l'écran peut partir. */
window.LOCAL_POSE && window.LOCAL_POSE();
` + "</" + "script>\n";

const BANNIERE = `<p class="renvoi" style="margin-bottom:1.5rem">
This runs entirely in your browser — no server, nothing uploaded, and no model is called:
the accuracy of each tier was <b>measured once on held-out records</b> and frozen.
<b>Take a cell</b> to send a field to another tier and read what your routing costs.
<a href="https://github.com/ArslaneSempai-ui/cascade-routing">Source and method</a>.
</p>`;

export function construire(): void {
  const docs = root + "docs";
  mkdirSync(docs, { recursive: true });

  let html = readFileSync(root + "src/ui.html", "utf8");
  /* Les chemins absolus valent pour un serveur à la racine ; la page publiée vit sous
   * `/cascade-routing/`, donc tout devient relatif. */
  html = html.replace('href="/registre.css"', 'href="registre.css"');
  html = html.replace('from "/graphes.js"', 'from "./graphes.js"');
  html = html.replace('<script type="module">', SHIM + '<script type="module">');
  html = html.replace("<main>", "<main>\n" + BANNIERE);

  writeFileSync(docs + "/index.html", html);
  cpSync(root + "src/graphes.js", docs + "/graphes.js");
  cpSync(root + "src/registre.css", docs + "/registre.css");
  writeFileSync(docs + "/.nojekyll", "");
  /*
   * ─── NE PUBLIER QUE CE QUE LA PAGE CHARGE ───
   *
   * `tsconfig.web.json` nomme six fichiers ; le compilateur en émettait DIX. Un `import type`
   * est effacé du JavaScript produit, mais le fichier visé entre quand même dans le programme
   * et se fait émettre. Quatre modules arrivaient donc dans `docs/js` sans qu'aucune ligne
   * exécutable ne les demande.
   *
   * Mesuré le 25 août 2026 : 102 Ko sur 162 jamais demandés par le navigateur. Et ce n'était
   * pas que du poids — `tiers.js` portait `http://localhost:11434`, trois routes d'API et un
   * chemin `node_modules`, servis publiquement et lisibles par un `curl`. Une revue de
   * sécurité côté acheteur qui trouve ça sur une page de vente s'arrête là, et elle a raison
   * de s'arrêter : elle ne peut pas savoir que ce code n'est jamais atteint.
   *
   * LA FERMETURE SE FAIT SUR LE JAVASCRIPT ÉMIS, PAS SUR LE TYPESCRIPT. C'est le point : les
   * imports de type n'existent plus dans le JS, donc le graphe qu'on y lit est celui que le
   * navigateur suivra. La même fermeture faite sur les sources se trompait de quatre modules
   * sur dix — et elle suivait en plus des chaînes d'import écrites dans des commentaires,
   * d'où le retrait des commentaires avant lecture.
   *
   * Le contrôle d'écran mesure la même chose autrement, en relevant ce que le navigateur a
   * réellement demandé. Deux méthodes indépendantes qui tombent d'accord valent mieux qu'une
   * seule à qui l'on fait confiance.
   */
  const sansCommentaires = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
  const atteints = new Set<string>();
  const suivre = (fichier: string, texte: string) => {
    for (const m of sansCommentaires(texte).matchAll(/from\s*["'][^"']*?([a-zA-Z0-9_-]+\.js)["']/g)) {
      const nom = m[1]!;
      if (atteints.has(nom)) continue;
      const chemin = `${docs}/js/${nom}`;
      if (!existsSync(chemin)) continue;
      atteints.add(nom);
      suivre(nom, readFileSync(chemin, "utf8"));
    }
  };
  suivre("index.html", html);
  const emis = readdirSync(docs + "/js").filter((n) => n.endsWith(".js"));
  /* Une fermeture qui ne trouve presque rien est cassée, et son silence ressemble à « tout
     est inutile ». On refuse plutôt que de vider `docs/js`. */
  if (atteints.size < 2) {
    throw new Error(
      `module closure reached ${atteints.size} of ${emis.length} emitted modules.\n\n`
      + "  It follows the `from \"...\"` of index.html, then of each module it reaches. If the\n"
      + "  page changed how it imports, fix the reading — do not let it conclude that almost\n"
      + "  everything is unused, because it would delete the page.");
  }
  const inutiles = emis.filter((n) => !atteints.has(n));
  for (const n of inutiles) rmSync(`${docs}/js/${n}`);

  /*
   * ─── L'EMPREINTE DE CHAQUE SOURCE, PARCE QU'UNE DATE MESURE LE SYSTÈME DE FICHIERS ───
   *
   * Le contrôle de fraîcheur comparait les dates de modification. Il tombait sur CENT POUR
   * CENT des clones neufs, et de façon déterministe : `git clone` écrit `docs/` avant `src/`,
   * si bien que chaque source paraît plus récente que le module publié — de neuf à dix-huit
   * MILLISECONDES, mesuré le 25 août 2026 sur deux clones. Le premier `npm test` d'un acheteur
   * affichait donc six modules « périmés » alors que les fichiers réellement servis étaient
   * identiques au bit près à leurs sources.
   *
   * Une date répond à « lequel a été écrit en dernier », qui est une question sur la machine.
   * La question posée est « ce qui est publié correspond-il aux sources », qui est une question
   * sur le contenu. On enregistre donc l'empreinte de chaque source au moment de construire ;
   * un contrôle la recalcule et compare. Aucune horloge, aucun ordre d'écriture, aucun fuseau.
   */
  const empreintes: Record<string, string> = {};
  for (const f of [...PRODUISENT_LA_PAGE]) {
    const src = root + "src/" + f;
    if (existsSync(src)) empreintes[f] = createHash("sha256").update(readFileSync(src)).digest("hex");
  }
  for (const n of atteints) {
    const src = root + "src/" + n.replace(/\.js$/, ".ts");
    if (existsSync(src)) empreintes["js/" + n] = createHash("sha256").update(readFileSync(src)).digest("hex");
  }
  /*
   * ET L'EMPREINTE DE CE QUI EST SERVI, PAS SEULEMENT DE CE QUI L'A PRODUIT.
   *
   * Les empreintes ci-dessus répondent à « la source a-t-elle bougé depuis la construction ».
   * Elles ne répondent PAS à « le fichier que le navigateur charge est-il celui qu'on a
   * construit » — et c'est la seconde question qui protège un visiteur.
   *
   * Mesuré le 26 août 2026 : une ligne ajoutée à la main dans `docs/js/assumptions.js`, le
   * fichier réellement servi, laisse le contrôle de fraîcheur à 5 sur 5. Aucune source n'a
   * bougé, donc toutes les empreintes concordent, et le module falsifié part avec la page.
   *
   * Les fichiers COPIÉS verbatim — graphes.js, registre.css — sont déjà couverts autrement :
   * le contrôle les compare octet pour octet à leur homonyme de `src/`. Ce qui manquait est
   * le COMPILÉ, qui n'a pas d'homonyme comparable.
   *
   * Ce que ça ne ferme pas, et je l'écris plutôt que de le taire : une main qui falsifie le
   * module ET le manifeste passe. Le manifeste est versionné, donc c'est l'historique qui
   * répond de ce cas-là — pas ce contrôle.
   */
  const publies: Record<string, string> = {};
  for (const n of atteints) {
    const servi = docs + "/js/" + n;
    if (existsSync(servi)) publies["js/" + n] = createHash("sha256").update(readFileSync(servi)).digest("hex");
  }

  writeFileSync(docs + "/.sources.json", JSON.stringify(
    { quoi: "sha256 of each SOURCE at build time. A freshness check compares these to the sources on disk; a modification date would compare the machine instead.", empreintes,
      releve: RELEVE_DE_LA_PAGE, publies },
    null, 2) + "\n");
  console.log(`docs/ built — ${atteints.size} module(s) published`
    + (inutiles.length ? `, ${inutiles.length} dropped: ${inutiles.join(", ")}` : ""));
}

if (isMain(import.meta)) construire();
