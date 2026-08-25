import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLAFOND_CORPS } from "./server.ts";

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
