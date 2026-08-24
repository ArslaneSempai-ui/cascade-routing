/*
 * L'ÉVALUATION D'UNE EXPRESSION RÉGULIÈRE DU CLIENT, DANS UN FIL QU'ON PEUT ARRÊTER.
 *
 * Node n'offre aucun délai sur une expression régulière : `String.match` rend la main quand
 * il a fini, et sur un motif qui rétrograde catastrophiquement il ne finit pas. Mesuré le
 * 25 août 2026 : `(a+)+$` sur **un seul cas de 61 caractères** occupe le processus
 * 162 179 ms, en silence, puis se fait rapporter comme un palier ordinaire.
 *
 * `worker.terminate()`, lui, interrompt bien une expression régulière en cours — mesuré
 * aussi : rendu en 2,0 s au lieu de 162 s sur ce même motif. C'est la seule borne qui tient
 * en Node ; une analyse de la forme du motif ne serait qu'un filtre incomplet.
 *
 * Un message PAR CAS, pas un à la fin : c'est ce qui permet au fil principal de borner
 * chaque évaluation et de nommer le cas sur lequel le motif s'est arrêté.
 */
import { parentPort, workerData } from "node:worker_threads";

const { motif, textes } = workerData as { motif: string; textes: string[] };
const re = new RegExp(motif);

for (let i = 0; i < textes.length; i++) {
  const t0 = performance.now();
  const valeur = textes[i]!.match(re)?.[0] ?? "";
  parentPort!.postMessage({ i, valeur, ms: performance.now() - t0 });
}
parentPort!.postMessage({ fini: true });
