import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signer } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error — module .mjs sans déclarations, volontairement lisible par un auditeur
import { verifier, bloc, empreinteDeCle } from "./verifier-rapport.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** Fabrique un rapport signé de bout en bout, avec une paire jetable. */
function rapportSigne(donnees: object, opts: { fausseCle?: boolean } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const autre = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const charge = JSON.stringify(donnees).replace(/</g, "\\u003c");
  /* Le corps EST ce qui sera signé : tout le document sauf le bloc de signature. Un tableau
     lisible hors des octets signés se modifie sans casser la signature — c'est le défaut que
     ce montage existe pour rendre impossible. */
  const corps = `<!doctype html><h1>Audit</h1>\n<p>records: ${(donnees as { corpus?: { dossiers?: number } }).corpus?.dossiers}</p>\n`
    + `<script type="application/json" id="rapport">${charge}</script>\n`;
  const valeur = signer(null, Buffer.from(corps, "utf8"), opts.fausseCle ? autre.privateKey : privateKey).toString("base64");
  const sig = JSON.stringify({ alg: "Ed25519", cle: empreinteDeCle(pem), valeur });
  /* AUCUN OCTET APRÈS LE BLOC : le corps signé est le document privé de ce bloc, ce qui
     précède ET ce qui suit. Un saut de ligne final ferait échouer un rapport authentique. */
  return { html: `${corps}<script type="application/json" id="signature">${sig}</script>`, pem, corps };
}

const EXEMPLE = { emisLe: "2026-08-24", client: "Banque Témoin", corpus: { empreinte: "ab12cd34", dossiers: 240 }, outil: { commit: "abc1234" } };

test("un rapport intact est vérifié, et le nombre d'octets signés est rendu", () => {
  const { html, pem } = rapportSigne(EXEMPLE);
  const r = verifier(html, pem);
  assert.equal(r.valide, true, r.motif);
  assert.equal(r.donnees.client, "Banque Témoin");
  assert.ok(r.octets > 50, "zéro octet signé serait un vert vide : la signature porterait sur rien.");
});

test("UN OCTET MODIFIÉ FAIT ÉCHOUER LA VÉRIFICATION", () => {
  /*
   * LE TÉMOIN QUI REND L'AUTRE PUBLIABLE. Sans lui, un vérificateur qui rend toujours
   * « valide » passerait le premier cas et ne protégerait de rien. C'est la forme la plus
   * simple du vert vide, et la plus coûteuse ici : elle transforme la pièce maîtresse de
   * l'offre en décoration.
   */
  const { html, pem } = rapportSigne(EXEMPLE);
  const altere = html.replace('"dossiers":240', '"dossiers":999');
  assert.notEqual(altere, html, "l'altération n'a rien changé : ce cas ne vérifie rien.");
  const r = verifier(altere, pem);
  assert.equal(r.valide, false);
  assert.match(r.motif, /altered after it was issued/);
});

test("ALTÉRER LE TEXTE LISIBLE casse aussi la signature", () => {
  /*
   * Le défaut qui a coûté une réécriture. La signature ne portait que sur le bloc JSON, et le
   * tableau que le lecteur regarde n'était couvert par rien : on remplaçait un chiffre dans
   * la colonne visible, l'outil répondait « ✓ signature valide », et le lecteur croyait le
   * faux chiffre. Le corps entier est signé maintenant, et ce cas le prouve.
   */
  const { html, pem } = rapportSigne(EXEMPLE);
  const altere = html.replace("records: 240", "records: 999");
  assert.notEqual(altere, html, "l'altération n'a rien changé : ce cas ne vérifie rien.");
  const r = verifier(altere, pem);
  assert.equal(r.valide, false);
  assert.match(r.motif, /altered after it was issued/);
});

test("AJOUTER QUOI QUE CE SOIT APRÈS LA SIGNATURE CASSE LA VÉRIFICATION", () => {
  /*
   * Le second défaut de cette famille, trouvé par une session de contrôle. La signature avait
   * un début et pas de fin : le corps signé était « tout ce qui précède le bloc », donc tout
   * ce qui SUIT était libre. Un `<style>` ajouté à la fin réécrit un chiffre du tableau
   * d'origine — `::after` et `visibility` — sans toucher un octet signé. Mesure publiée
   * 76,7 %, écran 96,7 %, et le vérificateur imprimait « aucun octet n'a bougé » avec une
   * sortie identique au caractère près à celle du rapport authentique.
   */
  const { html, pem } = rapportSigne(EXEMPLE);
  assert.equal(verifier(html, pem).valide, true, "le rapport de départ doit être valide, sinon ce cas ne prouve rien.");
  for (const [quoi, ajout] of [
    ["une feuille de style qui réécrit un chiffre",
      '<style>p{visibility:hidden}p::after{visibility:visible;content:"records: 999"}</style>'],
    ["un saut de ligne", "\n"],
    ["un commentaire", "<!-- rien de méchant -->"],
  ] as [string, string][]) {
    const r = verifier(html + ajout, pem);
    assert.equal(r.valide, false, `${quoi} ajouté après la signature n'a pas cassé la vérification.`);
  }
});

test("un rapport signé par une autre clé est refusé, et le motif nomme les deux empreintes", () => {
  const { html, pem } = rapportSigne(EXEMPLE, { fausseCle: true });
  const r = verifier(html, pem);
  assert.equal(r.valide, false);
  assert.match(r.motif, /does not match the content|other than the one/);
});

test("chaque façon de ne pas être un rapport a son propre motif", () => {
  const { pem } = rapportSigne(EXEMPLE);
  const cas: [string, RegExp][] = [
    ["<!doctype html><h1>rien</h1>", /not a signed report/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`, /carries no signature/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`
      + `<script type="application/json" id="signature">pas du json</script>`, /not readable JSON/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`
      + `<script type="application/json" id="signature">{"alg":"RSA","cle":"x","valeur":"y"}</script>`, /Ed25519/],
  ];
  assert.ok(cas.length > 0, "`cas` est vide : la boucle qui suit ne vérifie rien.");
  for (const [contenu, attendu] of cas) {
    const r = verifier(contenu, pem);
    assert.equal(r.valide, false);
    assert.match(r.motif, attendu, `motif inattendu pour « ${contenu.slice(0, 45)}… » : ${r.motif}`);
  }
});

test("la clé publique du dépôt est lisible et n'est pas une clé privée", () => {
  const pem = readFileSync(new URL("../cle-publique.pem", import.meta.url), "utf8");
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----/m);
  assert.doesNotMatch(pem, /PRIVATE KEY/,
    "une clé privée est publiée dans le dépôt : toute signature devient falsifiable par n'importe qui.");
  assert.equal(empreinteDeCle(pem).length, 32);
});

test("le dépôt refuse de versionner une clé privée", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^cle-privee\.pem$/m,
    "la clé privée n'est pas ignorée : une copie posée à la racine partirait au premier commit.");
  void racine; void bloc;
});

test("LA FIN DU BLOC SUIT LA RÈGLE DU NAVIGATEUR, PAS UNE ÉGALITÉ DE CHAÎNE", () => {
  /*
   * Deuxième cran de la même famille, trouvé par une session de contrôle. Un navigateur ferme
   * un `<script>` sur `</script` suivi d'un espace, d'une tabulation, d'un saut de ligne, d'un
   * `/` ou d'un `>`. Chercher les neuf caractères exacts laissait quatre fermetures valides
   * passer : la charge restait dans les octets exclus côté vérificateur et se faisait rendre
   * côté navigateur. Écran à 96,7 %, sortie identique au rapport authentique.
   */
  const { html, pem } = rapportSigne(EXEMPLE);
  const bloc = '<script type="application/json" id="signature">';
  const i = html.lastIndexOf(bloc);
  const sig = html.slice(i + bloc.length, html.indexOf("</script>", i));
  const charge = '<style>td{display:none}</style><table><tr><td>96.7 %</td></tr></table>';
  for (const fermeture of ["</script >", "</script\t>", "</script\n>", "</script/>"]) {
    const forge = html.slice(0, i + bloc.length)
      + sig.replace(/}$/, `,"pad":"${fermeture}${charge}"}`)
      + html.slice(html.indexOf("</script>", i));
    const r = verifier(forge, pem);
    assert.equal(r.valide, false,
      `« ${fermeture.replace(/\t/g, "\\t").replace(/\n/g, "\\n")} » a passé la vérification : `
      + "la frontière signée et la frontière rendue ne coïncident pas.");
  }
});

test("un « < » dans le bloc de signature est refusé d'emblée", () => {
  /* Une signature authentique est faite de base64, d'hexadécimal et de mots fixes. Interdire
     le caractère qui rouvre une balise ferme toute la famille d'un coup, au lieu de courir
     derrière les règles d'analyse d'un navigateur. */
  const { html, pem } = rapportSigne(EXEMPLE);
  const bloc = '<script type="application/json" id="signature">';
  const i = html.lastIndexOf(bloc);
  const forge = html.slice(0, i + bloc.length) + '{"pad":"<b>"}' + html.slice(html.indexOf("</script>", i));
  const r = verifier(forge, pem);
  assert.equal(r.valide, false);
  assert.match(r.motif, /"<"/);
});

/*
 * ─── LE SEUL ENDROIT QUE LA SIGNATURE NE PEUT PAS COUVRIR ───
 *
 * Le corps signé est le document PRIVÉ de son bloc de signature — ce qui précède et ce qui
 * suit. C'est ce qui ferme d'un coup toute la famille du « j'ajoute quelque chose après ».
 *
 * Mais ça laisse le bloc lui-même comme une région d'octets que rien ne signe, par
 * construction. Trouvé par une session pair à la quinzième tentative de contrefaçon, après
 * quatorze refusées : ce n'est pas une contrefaçon, rien ne s'affiche, et un `<` est déjà
 * refusé ailleurs — donc les octets sont inertes.
 *
 * ILS RESTENT DES OCTETS NON SIGNÉS DANS UN DOCUMENT QUI SE PRÉSENTE COMME VÉRIFIÉ, et ils
 * cessent d'être inertes le jour où quelque chose lit un champ de `sig` autre que les trois
 * attendus : une version future de ce vérificateur, un outil qui indexe des rapports, un
 * lecteur qui ouvre le JSON. Un canal inerte reste un canal.
 */
test("un champ inconnu dans le bloc de signature fait refuser", () => {
  const { html, pem } = rapportSigne(EXEMPLE);
  /* LE TÉMOIN POSITIF D'ABORD : sans lui, un « refusé » obtenu pour une autre raison — une
     signature cassée par la manipulation — se lirait comme une réussite du contrôle. */
  assert.equal(verifier(html, pem).valide, true,
    "le rapport de départ doit être valide, sinon ce cas ne prouve rien.");

  const DEBUT = '<script type="application/json" id="signature">';
  const i = html.lastIndexOf(DEBUT) + DEBUT.length;
  const j = html.indexOf("</script>", i);
  const sig = JSON.parse(html.slice(i, j));

  /* Le champ passager, exactement comme il a été trouvé : à l'INTÉRIEUR du bloc. */
  const avecPassager = { ...sig, note: "des octets que rien ne signe" };
  const forge = html.slice(0, i) + JSON.stringify(avecPassager) + html.slice(j);
  const r = verifier(forge, pem);
  assert.equal(r.valide, false, "un champ inconnu dans le bloc de signature est accepté : "
    + "le document porte des octets non signés et se dit vérifié.");
  assert.match(r.motif, /note/, "le refus ne nomme pas le champ en trop : un lecteur ne peut pas le retirer.");

  /* ET LE CHEMIN SAIN : réécrire le bloc avec ses trois champs seuls doit rester valide.
     Sans ce second sens, un vérificateur qui refuse TOUT passerait ce cas. */
  /* LE COMPTE EST IMPOSÉ, PAS SEULEMENT ANNONCÉ. Le commentaire et le message parlent des
     « trois champs attendus » ; sans cette ligne, un quatrième champ ajouté demain à la
     signature laisserait la prose mentir et le cas passer. Un chiffre écrit dans un message
     dérive exactement comme un chiffre écrit dans une prose : rien ne le recalcule. */
  const ATTENDUS = ["alg", "cle", "valeur"];
  assert.deepEqual(Object.keys(sig).sort(), [...ATTENDUS].sort(),
    `le bloc de signature porte ${Object.keys(sig).length} champ(s) et non ${ATTENDUS.length} : `
    + "la prose de ce cas et le vérificateur ne parlent plus du même objet.");

  const remis = html.slice(0, i)
    + JSON.stringify(Object.fromEntries(ATTENDUS.map((k) => [k, sig[k]]))) + html.slice(j);
  assert.equal(verifier(remis, pem).valide, true,
    `un bloc réécrit avec ses ${ATTENDUS.length} champs attendus est refusé : la garde refuse trop.`);
});


/*
 * ————————————————————————————————————————————————————————————————————————————————————
 * LA COMMANDE QUE L'ACHETEUR LANCE, ET NON LA FONCTION QU'ELLE APPELLE.
 *
 * Les onze cas ci-dessus éprouvent `verifier()`. Aucun ne lançait le programme — donc le
 * chemin qu'un auditeur emprunte réellement n'avait aucun témoin : le texte d'usage, les
 * codes de sortie, la lecture de la clé, la distinction entre « fichier illisible » et
 * « rapport falsifié ». Un scellé que l'acheteur ne peut pas contrôler lui-même est une
 * décoration ; un scellé dont la commande n'est pas éprouvée en est une aussi, avec un
 * fichier en plus.
 *
 * Les trois codes de sortie sont le contrat, parce que c'est ce que lit une chaîne
 * d'intégration : 0 vérifié, 1 REFUSÉ, 2 rien n'a été vérifié.
 * ————————————————————————————————————————————————————————————————————————————————————
 */

const BIN = fileURLToPath(new URL("./verifier-rapport.mjs", import.meta.url));

function lancer(dossier: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: dossier });
  return { code: r.status, sortie: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("la commande rend 0 sur un rapport authentique, et dit ce qu'elle ne prouve pas", () => {
  const dossier = mkdtempSync(join(tmpdir(), "scelle-"));
  try {
    const { html, pem } = rapportSigne(EXEMPLE);
    const rapport = join(dossier, "rapport.html"), cle = join(dossier, "cle.pem");
    writeFileSync(rapport, html);
    writeFileSync(cle, pem);

    const r = lancer(dossier, rapport, `--cle=${cle}`);
    assert.equal(r.code, 0, "un rapport authentique doit être accepté, sinon rien d'autre ne compte.");
    assert.match(r.sortie, /Signature valid/);
    assert.match(r.sortie, /does not prove/,
      "un scellé qui laisse croire qu'il garantit les chiffres est pire qu'aucun scellé.");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("un seul octet changé, où que ce soit, fait rendre 1", () => {
  const dossier = mkdtempSync(join(tmpdir(), "scelle-"));
  try {
    const { html, pem } = rapportSigne(EXEMPLE);
    const cle = join(dossier, "cle.pem");
    writeFileSync(cle, pem);

    /* Trois endroits : le texte lisible, la charge signée, et la signature elle-même. */
    const endroits: [string, string][] = [
      ["le texte que l'humain lit", html.replace("<h1>Audit</h1>", "<h1>Audlt</h1>")],
      ["la charge de données", html.replace('"dossiers":240', '"dossiers":999')],
      ["un bloc ajouté après coup", html.replace("</script>",
        '</script>\n<script type="application/json" id="rapport">{"dossiers":999999}</script>')],
    ];
    for (const [ou, altere] of endroits) {
      const f = join(dossier, "r.html");
      writeFileSync(f, altere);
      const r = lancer(dossier, f, `--cle=${cle}`);
      assert.equal(r.code, 1, `modifié dans ${ou} : la commande a rendu ${r.code} au lieu de 1.`);
      assert.match(r.sortie, /NOT VERIFIED/);
    }

    /* Témoin : le même rapport intact passe. Sans lui, ces trois refus passeraient aussi
       si la commande refusait tout. */
    const intact = join(dossier, "intact.html");
    writeFileSync(intact, html);
    assert.equal(lancer(dossier, intact, `--cle=${cle}`).code, 0);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("une clé qui n'est pas la bonne fait rendre 1, pas 0", () => {
  const dossier = mkdtempSync(join(tmpdir(), "scelle-"));
  try {
    const { html } = rapportSigne(EXEMPLE);
    const autre = rapportSigne(EXEMPLE);          // une seconde paire, jetable elle aussi
    const cle = join(dossier, "autre.pem"), rapport = join(dossier, "rapport.html");
    writeFileSync(cle, autre.pem);
    writeFileSync(rapport, html);
    const r = lancer(dossier, rapport, `--cle=${cle}`);
    assert.equal(r.code, 1, "signé par quelqu'un d'autre, donc refusé.");
    assert.match(r.sortie, /NOT VERIFIED/);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("« rien n'a été vérifié » rend 2, et ne se confond pas avec un refus", () => {
  const dossier = mkdtempSync(join(tmpdir(), "scelle-"));
  try {
    const sans = lancer(dossier);
    assert.equal(sans.code, 2, "sans argument : on ne peut pas refuser ce qu'on n'a pas lu.");
    assert.match(sans.sortie, /Usage:/);
    assert.match(sans.sortie, /--cle=/, "l'option doit être découvrable sans lire le fichier.");

    const absent = lancer(dossier, join(dossier, "pas-la.html"));
    assert.equal(absent.code, 2);
    assert.match(absent.sortie, /not a failed verification/,
      "un fichier illisible pris pour une falsification enverrait accuser quelqu'un.");

    const mauvaiseCle = lancer(dossier, join(dossier, "x.html"), `--cle=${join(dossier, "rien.pem")}`);
    assert.equal(mauvaiseCle.code, 2, "une clé illisible n'est pas un rapport invalide non plus.");

    const inconnue = lancer(dossier, "r.html", "--clef=x.pem");
    assert.equal(inconnue.code, 2, "une option mal orthographiée ne doit pas retomber en silence");
    assert.match(inconnue.sortie, /Unknown option/,
      "sinon `--clef` vérifierait contre la clé du dépôt en laissant croire au contraire.");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

/*
 * LE RAPPORT D'EXEMPLE LIVRÉ EST SIGNÉ DE LA CLÉ PUBLIÉE, ET INTACT.
 *
 * Revue du 3 septembre 2026 : le vérificateur et la clé publique étaient publics, mais un
 * acheteur n'avait rien à vérifier avant d'avoir payé — le seul rapport émis vivait dans un
 * cas de test, signé d'une clé jetable. `rapport-exemple.html` est émis sur notre corpus
 * held-out, signé de la vraie clé, et dit lui-même qu'il n'est qu'un exemple. Ce cas le
 * vérifie avec la clé du dépôt, comme l'acheteur le fera ; un exemple qui ne se vérifie plus
 * — clé tournée, fichier retouché — rougit ici avant de rougir chez lui.
 */
test("le rapport d'exemple livré se vérifie avec la clé publique du dépôt, et se dit exemple", () => {
  const chemin = join(racine, "rapport-exemple.html");
  assert.ok(existsSync(chemin), "rapport-exemple.html a disparu : l'acheteur n'a plus rien à vérifier avant d'acheter.");
  const html = readFileSync(chemin, "utf8");
  const r = verifier(html, readFileSync(join(racine, "cle-publique.pem"), "utf8"));
  assert.equal(r.valide, true, r.motif);
  assert.match(r.donnees.client, /^Example/, "le rapport d'exemple doit se nommer comme tel, dans ses octets signés.");
  assert.match(html, /This is an example of the deliverable/, "la réserve « exemple, pas un résultat client » doit être dans le document signé.");
  assert.match(html, /verifier-rapport\.mjs/, "et il doit dire comment se vérifier.");
  /* Et le contrôle doit avoir lu un vrai rapport : un fichier vide passerait sinon. */
  assert.ok(r.octets > 2000, `${r.octets} octets signés : ce n'est pas un rapport.`);
});
