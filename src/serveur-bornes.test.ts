import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { creerEcouteur, PLAFOND_CORPS } from "./server.ts";

/*
 * TOUTE ROUTE POST PORTE LA BORNE DE CORPS — ET LA LISTE VIENT DU ROUTEUR.
 *
 * `/api/optimum` ne lisait pas le corps : il n'en avait pas besoin, donc il n'appelait pas
 * `corps()`, donc `PLAFOND_CORPS` ne s'y appliquait pas. Mesuré : 100 Mo répondaient 200 là où
 * les deux autres routes coupaient la socket. L'impact mémoire était nul, mais une garde
 * portée par deux routes sur trois n'est pas une garde — et la quatrième route copiera
 * peut-être celle qui ne l'a pas.
 *
 * La liste des routes se DÉRIVE de `server.ts`. Écrite à la main, elle aurait le même défaut
 * que la garde qu'elle contrôle : une route neuve arriverait non couverte, et le vert du cas
 * dirait seulement que les trois routes connues vont bien.
 */

const source = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");

/** Les routes POST telles que le routeur les déclare. */
export function routesPost(src: string): string[] {
  return [...src.matchAll(/url\.pathname === "([^"]+)"\s*&&\s*req\.method === "POST"/g)].map((m) => m[1]!);
}

test("la liste des routes POST se dérive du routeur, et elle n'est pas vide", () => {
  const routes = routesPost(source);
  assert.ok(routes.length >= 3,
    `${routes.length} route(s) POST trouvée(s) dans server.ts — le motif ne lit plus le routeur, `
    + "et un cas qui n'examine rien passerait toujours.");
  /* TÉMOIN : le motif doit reconnaître une route déclarée autrement écrite. */
  assert.deepEqual(
    routesPost(`if (url.pathname === "/api/neuve" && req.method === "POST") {`),
    ["/api/neuve"],
    "le motif ne reconnaît plus une déclaration de route : le compte ci-dessus est sans valeur.");
  assert.deepEqual(
    routesPost(`if (url.pathname === "/api/etat") return json(res, etat());`),
    [],
    "le motif attrape une route qui n'est pas POST : il compterait des routes sans corps.");
});

test("chaque route POST refuse un corps au-delà de la borne", { timeout: 120_000 }, async () => {
  const routes = routesPost(source);
  const port = 4790 + Math.floor(Number(process.env.NODE_UNIQUE_ID ?? 0));
  const base = `http://127.0.0.1:${port}`;
  const serveur = spawn("node", [fileURLToPath(new URL("./server.ts", import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const dors = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/etat"); break; } catch { await dors(250); } }

    const trop = "x".repeat(PLAFOND_CORPS * 4);
    const passees: string[] = [];
    for (const route of routes) {
      let refuse = false;
      try {
        const r = await fetch(base + route, { method: "POST",
          headers: { "content-type": "application/json" }, body: trop });
        refuse = r.status === 413 || r.status >= 400;
      } catch { refuse = true; }        /* socket détruite : c'est le refus le plus net */
      if (!refuse) passees.push(route);
    }
    assert.deepEqual(passees, [],
      `route(s) POST acceptant ${trop.length} octets alors que la borne est ${PLAFOND_CORPS} : `
      + `${passees.join(", ")}\n  → appeler \`corps(req)\` même quand la route n'a pas besoin du corps.`);

    /* LE PENDANT : un corps normal doit passer, sinon le vert ci-dessus dirait seulement
       que le serveur refuse tout. */
    const normal = await fetch(base + routes[0]!, { method: "POST",
      headers: { "content-type": "application/json" }, body: "{}" });
    assert.notEqual(normal.status, 413,
      "un corps normal est refusé : le cas ci-dessus ne prouve rien de la borne.");
  } finally {
    serveur.kill();
  }
});

/**
 * LA BORNE COMPTE DES UNITÉS UTF-16, PAS DES OCTETS.
 *
 * Le cas voisin envoie de l'ASCII, où un caractère vaut un octet : il ne peut pas voir l'écart.
 * `corps()` accumule `brut += b` — une CHAÎNE — puis compare `brut.length` au plafond. Un corps
 * de caractères à trois octets passe donc la borne en octets sans l'atteindre en unités.
 *
 * Mesuré sur le serveur réel, corps JSON valides, route POST réelle :
 *
 *     60 008 octets / 60 008 unités ASCII   → socket coupée, refusé
 *     135 008 octets / 45 008 unités UTF-8  → 200, ACCEPTÉ
 *
 * Deux fois et demie la borne, accepté. Les deux premières mesures étaient confondues — un 404
 * sur une route inexistante, puis un 400 qui disait « JSON invalide » et non « trop gros » —
 * et c'est en isolant avec un corps valide sur une route réelle que le défaut apparaît.
 */
test("la borne de corps compte des octets, pas des unités UTF-16", { timeout: 120_000 }, async () => {
  const port = 4990 + Math.floor(Number(process.env.NODE_UNIQUE_ID ?? 0));
  const base = `http://127.0.0.1:${port}`;
  const serveur = spawn("node", [fileURLToPath(new URL("./server.ts", import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const dors = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    let debout = false;
    for (let i = 0; i < 80 && !debout; i++) {
      try { await fetch(base + "/api/etat"); debout = true; } catch { await dors(25); }
    }
    /* SANS CE CONTRÔLE, UN SERVEUR MORT FERAIT PASSER LE CAS : toute requête lèverait, et une
       levée se lit ici comme un refus. */
    assert.ok(debout, "le serveur n'a pas démarré : rien de ce qui suit ne prouverait quoi que ce soit");

    /* Valide en JSON, sous la borne en unités, bien au-dessus en octets. */
    const corps = JSON.stringify({ a: "\u3042".repeat(45000) });
    assert.ok(corps.length < PLAFOND_CORPS,
      "le montage est faux : ce corps doit être SOUS la borne en unités UTF-16");
    assert.ok(Buffer.byteLength(corps, "utf8") > PLAFOND_CORPS * 2,
      "le montage est faux : ce corps doit être bien AU-DESSUS de la borne en octets");

    let refuse = false;
    try {
      const r = await fetch(base + "/api/hypotheses", { method: "POST",
        headers: { "content-type": "application/json" }, body: corps });
      refuse = r.status >= 400;
    } catch { refuse = true; }
    assert.ok(refuse,
      `un corps de ${Buffer.byteLength(corps, "utf8")} octets doit être refusé par une borne de `
      + `${PLAFOND_CORPS} octets. Accepté, il fait entrer deux fois et demie ce que la borne `
      + "annonce, et la borne devient une phrase.");
  } finally {
    try { process.kill(serveur.pid!); } catch { /* déjà parti */ }
  }
});

test("la politique de contenu est stricte ET la page reste exécutable", { timeout: 120_000 }, async () => {
  /*
   * ─── L'EN-TÊTE DE SÉCURITÉ QUI A DÉTRUIT LE PRODUIT EN SILENCE ───
   *
   * Le 25 août 2026, `script-src 'self'` a été posé sur toutes les réponses. `ui.html` porte
   * son programme dans un `<script type="module">` EN LIGNE, que `'self'` refuse. Mesuré dans
   * un vrai navigateur : la page passait de 2 figures, 1 SVG, 2 boutons et 35 cellules à ZÉRO
   * PARTOUT. Le titre s'affichait encore, et l'outil de console n'a rapporté AUCUNE erreur.
   *
   * Aucun contrôle du dépôt ne l'a vu — ils lisent des fichiers, ils n'exécutent pas la page.
   * Ce cas ferme l'écart sans navigateur, en éprouvant l'INVARIANT qui a cassé : chaque script
   * en ligne de la page servie porte un jeton, et ce jeton est celui de l'en-tête.
   *
   * Les deux sens comptent. Une politique laxiste (`unsafe-inline`) rétablirait la page et
   * viderait la protection : elle est refusée ici aussi. On ne peut donc pas faire passer ce
   * cas en affaiblissant la politique — la seule sortie est un jeton correct.
   */
  const port = 4830 + Math.floor(Number(process.env.NODE_UNIQUE_ID ?? 0));
  const base = `http://127.0.0.1:${port}`;
  const serveur = spawn("node", [fileURLToPath(new URL("./server.ts", import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const dors = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + "/api/etat"); break; } catch { await dors(250); } }

    const r = await fetch(base + "/");
    const csp = r.headers.get("content-security-policy");
    assert.ok(csp, "aucune politique de contenu sur la page : l'en-tête a disparu.");

    /* Une politique qui s'autorise l'inline ne protège de rien — c'est la sortie facile. */
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/,
      `la politique s'est ouverte : « ${csp} ». Un script en ligne refusé se règle par un jeton, `
      + "pas en autorisant tout code écrit dans la page.");
    assert.match(csp, /script-src[^;]*'nonce-/,
      `la politique n'accorde aucun jeton : « ${csp} ». Le script en ligne de ui.html sera refusé `
      + "et la page s'affichera VIDE, sans erreur visible.");

    const jeton = csp.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(jeton, "jeton illisible dans la politique");

    const html = await r.text();
    const enLigne = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)];
    assert.ok(enLigne.length > 0,
      "aucun script en ligne trouvé dans la page servie : ce cas n'examine plus rien, et un "
      + "vert rendu ici ne dirait rien. La page a-t-elle changé de forme ?");
    const sansJeton = enLigne.filter((m) => !m[1]!.includes(`nonce="${jeton}"`)).length;
    assert.equal(sansJeton, 0,
      `${sansJeton} script(s) en ligne sur ${enLigne.length} ne portent pas le jeton de l'en-tête. `
      + "Le navigateur les refusera et la page sera vide — mesuré : 2 figures et 35 cellules "
      + "tombent à zéro, sans une erreur de console.");

    /* CONTRE-ÉPREUVE DU JETON LUI-MÊME : deux réponses ne doivent pas porter le même, sinon
       une injection qui a lu la page une fois connaît le jeton de la suivante. */
    const csp2 = (await fetch(base + "/")).headers.get("content-security-policy");
    assert.notEqual(csp2?.match(/'nonce-([^']+)'/)?.[1], jeton,
      "le jeton est constant d'une réponse à l'autre : il se devine, donc il ne protège plus.");
  } finally {
    serveur.kill();
  }
});

/*
 * ─── LA GARDE QUI REFUSE UNE PAGE DONT LE SCRIPT EN LIGNE N'A PAS PU ÊTRE MARQUÉ ───
 *
 * Le cas ci-dessus tient le sens « la vraie page part bien marquée ». Il ne dit RIEN de
 * l'autre sens : ce qui arrive quand la balise change de forme. Et rien ne pouvait le dire,
 * parce que le chemin de la page était calculé depuis `import.meta.url` — le seul moyen de
 * servir une page d'une autre forme aurait été de réécrire le `src/ui.html` du dépôt vivant,
 * que cinq fichiers lisent dans des processus PARALLÈLES. `creerEcouteur(chemin)` prend donc
 * le chemin en paramètre, avec la production pour valeur par défaut.
 *
 * On frappe la ROUTE, pas une fonction en isolation : c'est le point d'appel qui portait les
 * deux défauts mesurés le 26 août 2026 — l'ordre du `writeHead`, et une condition trop large.
 */
async function servir(page: string): Promise<{ fermer: () => void; url: string }> {
  const f = join(mkdtempSync(join(tmpdir(), "cascade-ui-")), "ui.html");
  writeFileSync(f, page);
  const s = createServer(creerEcouteur(f));
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return { fermer: () => s.close(), url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/` };
}

test("une balise en ligne que le jeton ne marque pas refuse la page, et le DIT",
  /* LA BORNE DE TEMPS EST DE LA MESURE, PAS DE LA PRUDENCE. Le défaut de l'ordre réintroduit
     à la main le 26 août 2026 : la réponse ne partait JAMAIS, et sans borne le fichier restait
     suspendu — j'ai dû le tuer après 133 s. Un rouge qui pend se lit comme une machine lente,
     pas comme une garde qui a parlé. */
  { timeout: 30_000 }, async () => {
  /* `defer` suffit : la balise n'est plus littéralement `<script type="module">`, donc le
     remplacement la manque, donc elle partirait NUE sous une politique qui la refuse. */
  const { fermer, url } = await servir(
    '<!doctype html><title>x</title><script type="module" defer>1</script>');
  try {
    const r = await fetch(url);
    assert.equal(r.status, 400,
      `une page dont le script en ligne n'a pas pu être marqué rend ${r.status}. Elle doit être `
      + "REFUSÉE : servie telle quelle, le navigateur rejette le script et l'écran est vide, "
      + "sans une erreur de console.");
    const { erreur } = await r.json() as { erreur: string };
    /*
     * L'ASSERTION PORTE SUR LE MESSAGE, ET C'EST ELLE QUI A FORCÉ LA RÉPARATION.
     *
     * Mesuré le 26 août 2026 : la garde partait bien, et son texte n'atteignait PERSONNE.
     * `res.writeHead(200, …)` précédait le contrôle, donc le `catch` du routeur rappelait
     * `writeHead` sur une réponse déjà engagée → `ERR_HTTP_HEADERS_SENT` levé dans le
     * gestionnaire d'erreur, hors de toute capture. Côté client : « Empty reply from server »,
     * aucun statut, aucun texte ; puis `GET /api/etat` → 000, SERVEUR MORT. Un cas qui se
     * serait contenté d'exiger « ça jette » serait resté vert sur ce défaut-là.
     */
    assert.match(erreur, /inline <script> the nonce could not mark/,
      `le refus ne nomme pas la cause : « ${erreur} ». Sans elle, celui qui touche à ui.html ne `
      + "sait pas que c'est la forme de sa balise qui a vidé la page.");
    assert.match(erreur, /rather than weakening the policy/,
      `le refus ne ferme pas la sortie facile : « ${erreur} ». Le réflexe devant un script `
      + "refusé est d'ajouter 'unsafe-inline', qui vide la politique de tout intérêt.");
  } finally { fermer(); }
});

test("un script EXTERNE de même origine n'est pas un script nu", { timeout: 30_000 }, async () => {
  /*
   * CONTRE-ÉPREUVE DE LA CONDITION, ET ELLE A ÉTÉ ROUGE.
   *
   * La condition d'origine — « le remplacement n'a rien changé » — disait autre chose que
   * « un script en ligne est resté nu ». Mesuré le 26 août 2026 sur cette page exacte :
   * refus, « Empty reply from server », serveur mort. Or sortir le script en ligne dans un
   * fichier est le durcissement qu'on RECOMMANDE, et `script-src 'self'` l'autorise
   * pleinement. Sans ce cas, la réparation de la condition se reperdrait au premier
   * remaniement qui la trouverait « plus simple » écrite comme avant.
   */
  const { fermer, url } = await servir(
    '<!doctype html><title>x</title><script type="module" src="/graphes.js"></script>');
  try {
    const r = await fetch(url);
    assert.equal(r.status, 200,
      `une page dont le seul script est externe et de même origine est refusée (${r.status}). `
      + "La garde lit l'effet du remplacement au lieu de l'invariant, qui est : aucun script EN "
      + "LIGNE ne reste nu.");
  } finally { fermer(); }
});
