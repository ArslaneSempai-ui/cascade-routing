import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { exigerHoteLocal, estLocal } from "./tiers.ts";

const dossier = fileURLToPath(new URL(".", import.meta.url));

test("un document ne part pas vers un hôte qui n'est pas cette machine", () => {
  assert.throws(() => exigerHoteLocal("http://192.0.2.10:11434"), /pas cette machine/);
  assert.throws(() => exigerHoteLocal("https://api.exemple.com"), /pas cette machine/);
  /* Le nom qui COMMENCE par une adresse locale et continue ailleurs. */
  assert.throws(() => exigerHoteLocal("http://127.0.0.1.evil.example:11434"), /pas cette machine/);
  assert.doesNotThrow(() => exigerHoteLocal("http://localhost:11434"));
  assert.doesNotThrow(() => exigerHoteLocal("http://127.0.0.1:11434"));
  assert.doesNotThrow(() => exigerHoteLocal("http://[::1]:11434"));
  assert.equal(estLocal("http://127.0.0.1.evil.example"), false);
});

test("le refus dit ce qui partirait, et comment consentir", () => {
  /* Un refus sans issue se fait commenter. Et l'issue doit être désagréable à lire :
     « --remote-ollama » s'écrit dans la commande, il ne se coche pas. */
  try { exigerHoteLocal("http://192.0.2.10:11434"); assert.fail("aucun refus"); }
  catch (e) {
    const m = (e as Error).message;
    assert.match(m, /données personnelles|pièce d'identité/);
    assert.match(m, /--remote-ollama/);
    assert.match(m, /OLLAMA_HOST/, "le message ne dit pas où le réglage a été pris.");
  }
});

test("LA FRONTIÈRE EST AU PASSAGE, PAS À CHAQUE PORTE D'ENTRÉE", () => {
  /*
   * La garde vivait dans `measure.ts`, au point d'entrée. Correcte, et au mauvais endroit :
   * `your-cases.ts` — le chemin CLIENT, celui qui traite de vrais dossiers — ne l'appelait
   * pas. `npm run measure:yours -- --llm` avec un OLLAMA_HOST hérité d'un .env envoyait chaque
   * dossier chez un tiers, sous une commande dont le README dit « nothing leaves your
   * machine ».
   *
   * Ce cas ne vérifie pas que CE chemin est gardé — il vérifie qu'il n'y a qu'un seul passage,
   * et qu'il l'est. Un nouveau point d'entrée hérite de la garde sans que personne y pense ;
   * un nouveau site d'envoi, lui, fait tomber ce cas.
   */
  const fichiers = readdirSync(dossier).filter((n) => /\.(ts|mjs)$/.test(n) && !n.endsWith(".test.ts"));
  assert.ok(fichiers.length >= 10, `${fichiers.length} fichier(s) lus : la lecture a échoué.`);

  const envois: string[] = [];
  for (const n of fichiers) {
    const src = readFileSync(join(dossier, n), "utf8");
    for (const m of src.matchAll(/\bfetch\s*\(\s*`?\$?\{?\s*OLLAMA\b/g)) {
      const avant = src.slice(0, m.index!);
      envois.push(`${n}:${avant.split("\n").length}`);
    }
  }
  /*
   * IL Y EN A QUATRE, PAS UN. Ma première version affirmait « un seul passage » et ce cas l'a
   * démentie aussitôt : deux envoient un prompt (`/api/generate`, dans tiers.ts et
   * contrainte.ts), deux ne demandent que des métadonnées (`/api/ps`, `/api/tags`). J'avais
   * gardé le premier et cru avoir couvert la frontière.
   *
   * Les quatre sont gardés. Une règle uniforme se tient ; une règle au cas par cas se
   * re-dérive à chaque ajout, et c'est à la troisième dérivation qu'on se trompe.
   */
  assert.ok(envois.length >= 4,
    `${envois.length} site(s) d'envoi trouvé(s) : la recherche a rétréci et ce cas ne vérifie plus rien.`);

  const nonGardes: string[] = [];
  for (const e of envois) {
    const [fichier, ligne] = e.split(":");
    const src = readFileSync(join(dossier, fichier!), "utf8").split("\n");
    const fenetre = src.slice(Math.max(0, Number(ligne) - 8), Number(ligne)).join("\n");
    if (!/exigerHoteLocal\(\)/.test(fenetre)) nonGardes.push(e);
  }
  assert.deepEqual(nonGardes, [],
    `site(s) d'envoi sans garde dans les huit lignes qui précèdent : ${nonGardes.join(", ")}.\n`
    + "  → chacun peut envoyer les dossiers d'un client à un hôte qui n'est pas cette machine.");
});

test("la promesse du README est tenue par du code, pas par une phrase", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const ligne = readme.split("\n").find((l) => l.includes("measure:yours"));
  assert.ok(ligne, "measure:yours n'est plus annoncée dans le README.");
  if (/nothing leaves your machine/i.test(ligne!)) {
    /* La phrase n'est vraie que parce que la garde existe. Si elle disparaît, cette
       affirmation devient un mensonge adressé à quelqu'un qui traite des dossiers KYC. */
    const tiers = readFileSync(new URL("./tiers.ts", import.meta.url), "utf8");
    assert.match(tiers, /export function exigerHoteLocal/,
      "le README promet que rien ne quitte la machine et plus rien ne l'impose.");
  }
});
