import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sansChemins } from "./server.ts";

/*
 * UNE ERREUR RENVOYÉE NE PORTE PAS DE CHEMIN — PAR CONSTRUCTION, PAS PAR CHANCE.
 *
 * CodeQL signalait une fuite par trace de pile sur le gestionnaire d'erreurs. Éprouvée par
 * une session voisine : aucune erreur atteignable ne porte de chemin aujourd'hui, parce
 * qu'aucune route ne touche au disque. Faux positif comme fuite exploitable — et vrai comme
 * fragilité : le jour où une route lit un fichier, `ENOENT … open '/Users/…'` traverse le
 * gestionnaire tel quel, sans que personne ne l'ait modifié, donc sans que personne le voie.
 */

test("un chemin est caviardé, une route ne l'est pas", () => {
  const caviardes: Array<[string, string]> = [
    ["ENOENT: no such file or directory, open '/Users/x/data/a.json'", "<file>"],
    ["Cannot find module /private/tmp/abc/def.mjs", "<file>"],
    ["Error at file:///Users/x/server.ts:12:5", "<file>"],
    ["cannot load /Users/x/node_modules/onnx/model.onnx", "<file>"],
    ["C:\\Users\\x\\projet\\a.json introuvable", "<file>"],
  ];
  for (const [entree, attendu] of caviardes) {
    const sorti = sansChemins(entree);
    assert.match(sorti, new RegExp(attendu), `« ${entree} » n'a pas été caviardé`);
    assert.doesNotMatch(sorti, /\/Users\/|\/private\/|node_modules|[A-Za-z]:\\/,
      `« ${sorti} » porte encore un chemin`);
  }

  /* LE PENDANT, sans lequel un caviardage qui efface tout passerait aussi : ce qui n'est pas
     un chemin doit ressortir intact. Une route est l'information la plus utile d'un message
     d'erreur ; la retirer ferait écrire aux suivants un gestionnaire qui contourne celui-ci. */
  const intacts = [
    "unknown option: --fields. This command accepts: --cases",
    "no route /api/etat for method DELETE",
    "request too large (> 50000 bytes)",
    "rate limit reached: more than 240 requests in 60 s from 127.0.0.1",
  ];
  for (const t of intacts) {
    assert.equal(sansChemins(t), t, `« ${t} » a été caviardé alors qu'il ne porte aucun chemin`);
  }
});

test("tout message d'erreur renvoyé passe par le caviardage", () => {
  /*
   * LA COUTURE, DÉRIVÉE DE LA SOURCE. Vérifier le seul site connu ne dirait rien du
   * gestionnaire que quelqu'un ajoutera à côté — et c'est exactement ainsi que la fuite
   * arriverait : par un changement fait ailleurs.
   */
  const src = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");

  /** Les renvois d'erreur qui interpolent une exception attrapée. */
  const renvois = [...src.matchAll(/erreur:\s*([^\n]*?\((?:e|err|erreur) as Error\)[^\n]*)/g)].map((m) => m[1]!);
  assert.ok(renvois.length >= 1,
    `${renvois.length} renvoi(s) d'exception trouvé(s) dans server.ts — le motif ne lit plus `
    + "le gestionnaire, et un cas qui n'examine rien passerait toujours.");

  const nus = renvois.filter((r) => !r.includes("sansChemins"));
  assert.deepEqual(nus, [],
    `renvoi(s) d'exception sans caviardage :\n${nus.map((x) => "  - " + x.trim()).join("\n")}\n`
    + "  → envelopper dans `sansChemins(…)`, sinon un chemin sort le jour où une route lit un fichier.");

  /* TÉMOINS DU MOTIF : il doit reconnaître un renvoi écrit autrement, et se taire sur ce qui
     n'en est pas un. Sans eux, `nus` vide prouverait seulement que le motif ne trouve rien. */
  const voit = (s: string) => [...s.matchAll(/erreur:\s*([^\n]*?\((?:e|err|erreur) as Error\)[^\n]*)/g)].length;
  assert.equal(voit('json(res, { erreur: String((err as Error).message) }, 400);'), 1,
    "le motif ne reconnaît plus un renvoi d'exception : le vert ci-dessus est sans valeur.");
  assert.equal(voit('json(res, { erreur: `rate limit reached from ${adresse}` }, 429);'), 0,
    "le motif attrape un message qui ne vient pas d'une exception : il exigerait un caviardage inutile.");
});

test("sansChemins caviarde aussi les racines hors des sept d'origine", () => {
  /* /Volumes (disque externe macOS), /usr/local, /srv, /mnt : un dépôt lancé de là envoyait
     son chemin complet — nom d'utilisateur compris — dans la réponse HTTP. La liste reste une
     liste, et ce cas épingle au moins les racines usuelles des trois systèmes. */
  for (const chemin of ["/Volumes/WORK/cascade/src/a.ts", "/usr/local/lib/b.js",
                        "/srv/app/c.ts", "/mnt/d/e.ts", "/Library/Caches/f.bin"]) {
    /* Le `:12` part avec le chemin — `[^\s"')]*` le consomme, comportement historique du
       motif : un numéro de ligne colle au chemin sans espace. On épingle le comportement réel,
       relevé en le lançant, pas celui que j'avais imaginé. */
    assert.equal(sansChemins(`Error at ${chemin}:12`), "Error at <file>",
      `${chemin} n'est pas caviardé : le chemin partirait dans la réponse.`);
  }
});
