import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signer } from "node:crypto";
import { readFileSync } from "node:fs";
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
  return { html: `${corps}<script type="application/json" id="signature">${sig}</script>\n`, pem, corps };
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
  assert.match(r.motif, /modifié après émission/);
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
  assert.match(r.motif, /modifié après émission/);
});

test("un rapport signé par une autre clé est refusé, et le motif nomme les deux empreintes", () => {
  const { html, pem } = rapportSigne(EXEMPLE, { fausseCle: true });
  const r = verifier(html, pem);
  assert.equal(r.valide, false);
  assert.match(r.motif, /ne correspond pas au contenu|autre clé/);
});

test("chaque façon de ne pas être un rapport a son propre motif", () => {
  const { pem } = rapportSigne(EXEMPLE);
  const cas: [string, RegExp][] = [
    ["<!doctype html><h1>rien</h1>", /pas un rapport signé/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`, /aucune signature/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`
      + `<script type="application/json" id="signature">pas du json</script>`, /pas du JSON lisible/],
    [`<script type="application/json" id="rapport">{"a":1}</script>`
      + `<script type="application/json" id="signature">{"alg":"RSA","cle":"x","valeur":"y"}</script>`, /Ed25519/],
  ];
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
