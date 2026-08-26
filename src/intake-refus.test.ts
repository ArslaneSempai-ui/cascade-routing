/*
 * LES QUATRE REFUS DE `intake`, ET CE QU'ILS PROTÈGENT : LE FICHIER DU CLIENT.
 *
 * Le balayage du 26 août 2026 les a tous rendus survivants. Ce sont pourtant les seules
 * choses qui séparent « votre questionnaire a été lu » de « on vous a rendu un rapport sur nos
 * valeurs par défaut, et votre fichier a disparu ».
 *
 * Le premier est le plus cher. Passer le chemin SANS `--file=` ne le lit pas — la commande
 * écrirait un gabarit vierge par-dessus, puis rendrait un rapport dont chaque chiffre vient de
 * nos défauts. **Un rapport parfaitement crédible sur des données qui ne sont pas celles du
 * client, et son fichier perdu.** Un refus est ici moins coûteux qu'un succès.
 *
 * Chaque cas exige le MESSAGE et pas seulement le code : un module absent ou un import cassé
 * rendent aussi un code non nul, et deux d'entre eux ont déjà été lus comme une garde qui se
 * déclenchait.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lancer, exigerRefus } from "./commande-eprouvee.ts";

const CMD = fileURLToPath(new URL("./intake.ts", import.meta.url));
const bac = () => mkdtempSync(join(tmpdir(), "intake-"));

test("un chemin passé sans --file= est refusé, et le fichier N'EST PAS touché", () => {
  const d = bac();
  const f = join(d, "questionnaire.json");
  const avant = JSON.stringify({ volume: 100000, reponse: "du client" });
  writeFileSync(f, avant);

  const r = lancer([CMD, f]);
  exigerRefus(r, /was passed without "--file="/, "un chemin sans le drapeau doit être refusé");
  assert.match(r.texte, /overwritten/,
    "le refus ne dit pas ce qui SERAIT arrivé : c'est la seule chose qui fait comprendre l'enjeu.");
  /* LA MESURE QUI COMPTE : le fichier est intact. Un refus qui laisse quand même le dégât
     n'est pas un refus — et c'est le dégât, pas le code de sortie, qui coûte au client. */
  assert.equal(readFileSync(f, "utf8"), avant,
    "LE FICHIER DU CLIENT A ÉTÉ ÉCRASÉ malgré le refus.");
});

test("un fichier absent est refusé, et aucun gabarit n'est écrit à sa place", () => {
  const d = bac();
  const f = join(d, "pas-la.json");
  const r = lancer([CMD, `--file=${f}`]);
  exigerRefus(r, /does not exist/, "un fichier absent doit être refusé");
  assert.equal(existsSync(f), false,
    "un gabarit a été écrit à la place du fichier absent : le prochain lancement le lirait\n"
    + "  comme s'il venait du client.");
});

test("un fichier vide est refusé — vide n'est pas « toutes les valeurs par défaut »", () => {
  const d = bac();
  const f = join(d, "vide.json");
  writeFileSync(f, "   \n  ");
  const r = lancer([CMD, `--file=${f}`]);
  exigerRefus(r, /is empty\. Nothing was read/, "un fichier vide doit être refusé");
  assert.match(r.texte, /template/, "le refus n'indique pas par où recommencer.");
});

test("un JSON invalide est refusé, et le refus dit POURQUOI il est invalide", () => {
  const d = bac();
  const f = join(d, "casse.json");
  writeFileSync(f, '{ "volume": 100000, }');
  const r = lancer([CMD, `--file=${f}`]);
  exigerRefus(r, /is not valid JSON/, "un JSON invalide doit être refusé");
  assert.match(r.texte, /Nothing was read and nothing was written/,
    "le refus ne dit pas que rien n'a été écrit : le client ne sait pas si son fichier a bougé.");
  assert.match(r.texte, /ends with a comma|every key is quoted/,
    "le refus ne dit pas comment corriger — un message d'erreur JSON nu envoie chercher.");
});
