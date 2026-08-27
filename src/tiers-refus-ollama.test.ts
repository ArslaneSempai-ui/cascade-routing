/*
 * DEUX REFUS DE `tiers.ts` QUE RIEN N'ATTEIGNAIT, ET CE QUI PASSAIT POUR LEUR TÉMOIN.
 *
 * `digestsQuiDivergent` est éprouvée en fonction pure ; le REFUS qui s'en sert, dans
 * `loadGeneratifs`, ne l'était pas. Et le refus de `tailles()` sur un service qui répond mal
 * n'avait aucun cas du tout. Muter l'un ou l'autre ne rendait qu'un seul rouge : la clé de
 * cache de `failures-reference.json`, qui couvre le TEXTE des modules — un commentaire
 * parfaitement inoffensif ajouté à `tiers.ts` la fait bouger pareil. Mesuré le 26 août 2026 :
 * la suite complète est alors passée de moins d'une minute à plus de sept, parce que la
 * galerie se recalcule. **Un rouge qu'un commentaire déclenche ne dit rien d'une garde.**
 *
 * `OLLAMA` est lu au CHARGEMENT du module, depuis `OLLAMA_HOST` : ces cas passent donc par un
 * sous-processus, seule façon d'avoir un module qui regarde ailleurs. C'est aussi ce qui les
 * rend honnêtes — ils éprouvent la commande, pas une fonction extraite pour l'occasion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const tiers = fileURLToPath(new URL("./tiers.ts", import.meta.url));

/** Un faux Ollama qui répond ce qu'on lui dit, sur un port que l'OS choisit. */
async function faussaire(repondre: (chemin: string) => { code: number; corps: unknown }): Promise<{ url: string; fermer: () => void }> {
  const s: Server = createServer((req, res) => {
    const r = repondre(req.url ?? "/");
    res.writeHead(r.code, { "content-type": "application/json" });
    res.end(JSON.stringify(r.corps));
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const port = (s.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, fermer: () => s.close() };
}

/*
 * `spawnSync` A COÛTÉ TROIS QUARTS D'HEURE, ET SON SYMPTÔME RESSEMBLAIT AU DÉFAUT CHERCHÉ.
 *
 * Il BLOQUE la boucle d'événements du parent — donc le faux serveur, qui vit ici, ne pouvait
 * pas répondre. Les trois cas rendaient « The operation was aborted due to timeout » au bout
 * de dix secondes, et le témoin POSITIF passait au vert sur ce délai : il n'exige qu'une
 * absence, et une panne la fournit. C'est lui qui a montré que le montage était faux.
 */
async function chargerGeneratifs(hote: string): Promise<string> {
  const p = spawn(process.execPath,
    ["--input-type=module", "-e",
     `const t = await import(${JSON.stringify(tiers)});\n`
     + `try { await t.loadGeneratifs(); console.log("AUCUN REFUS"); }\n`
     + `catch (e) { console.log("REFUS: " + e.message); }\n`],
    { env: { ...process.env, OLLAMA_HOST: hote }, stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  p.stdout!.setEncoding("utf8"); p.stderr!.setEncoding("utf8");
  p.stdout!.on("data", (d: string) => { sortie += d; });
  p.stderr!.on("data", (d: string) => { sortie += d; });
  await new Promise((r) => p.on("exit", r));
  assert.doesNotMatch(sortie, /aborted due to timeout/,
    "le faux service n'a pas répondu : c'est le montage qui a échoué, pas la garde.\n"
    + `  obtenu : ${sortie.slice(0, 200)}`);
  return sortie;
}

test("un service qui répond mal n'est pas lu comme « aucun modèle installé »", async () => {
  const f = await faussaire(() => ({ code: 503, corps: { error: "service unavailable" } }));
  try {
    const r = { sortie: await chargerGeneratifs(f.url) };
    assert.match(r.sortie, /answered 503/,
      "un /api/tags qui répond 503 ne fait pas refuser. Une liste vide serait alors lue comme\n"
      + "  « aucun modèle installé », et la garde des empreintes passerait au vert sans avoir\n"
      + "  comparé quoi que ce soit.");
    assert.match(r.sortie, /not "no model installed"/,
      "le refus ne distingue plus les deux causes, qui n'ont pas le même remède.");
  } finally { f.fermer(); }
});

test("un modèle réinstallé sous le même nom fait REFUSER la commande, pas seulement la fonction", async () => {
  /*
   * Le corps ci-dessous porte les tags déclarés dans `MODELES_LOCAUX` avec de MAUVAISES
   * empreintes : c'est exactement « un `ollama pull` a changé le modèle sans qu'un seul
   * fichier du dépôt ne bouge ».
   */
  const f = await faussaire(() => ({ code: 200, corps: { models: [
    { name: "qwen3:0.6b", size: 522_000_000, digest: "sha256:000000000000deadbeef" },
    { name: "qwen3:4b", size: 2_600_000_000, digest: "sha256:111111111111deadbeef" },
    { name: "qwen3:8b", size: 5_200_000_000, digest: "sha256:222222222222deadbeef" },
  ] } }));
  try {
    const r = { sortie: await chargerGeneratifs(f.url) };
    assert.match(r.sortie, /are not the ones that were measured/,
      "des modèles installés sous les bons noms avec de mauvaises empreintes ne font pas\n"
      + "  refuser. `digestsQuiDivergent` est éprouvée en fonction pure ; c'est le POINT\n"
      + "  D'APPEL qui décide, et il ne l'était pas.");
    assert.match(r.sortie, /qwen3:/,
      "le refus ne nomme plus le modèle qui diverge : il faut remesurer sans savoir lequel.");
  } finally { f.fermer(); }
});

test("les bonnes empreintes ne font PAS refuser — sinon les deux cas ci-dessus ne prouvent rien", async () => {
  /*
   * TÉMOIN POSITIF, et il est indispensable : une garde qui refuse TOUT satisferait les deux
   * cas précédents. Le refus attendu ici est un autre — l'appel de `ping` à un faux service —
   * et ce qui compte est qu'il ne parle PAS d'empreintes.
   */
  const { MODELES_LOCAUX } = await import("./tiers.ts") as { MODELES_LOCAUX: Record<string, { tag: string; digest: string }> };
  const modeles = Object.values(MODELES_LOCAUX).map((m) => ({
    name: m.tag, size: 1_000_000, digest: `sha256:${m.digest}`,
  }));
  const f = await faussaire((chemin) => chemin.startsWith("/api/tags")
    ? { code: 200, corps: { models: modeles } }
    : { code: 200, corps: { response: "{}" } });
  try {
    const r = { sortie: await chargerGeneratifs(f.url) };
    assert.doesNotMatch(r.sortie, /are not the ones that were measured/,
      "les empreintes DÉCLARÉES sont refusées : la garde refuse tout, donc elle ne garde rien.");
  } finally { f.fermer(); }
});
