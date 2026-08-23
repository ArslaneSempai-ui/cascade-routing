/*
 * UN GÉNÉRATEUR DE CHARGE, POUR QUE « SOUS CHARGE » SOIT REPRODUCTIBLE.
 *
 * Une latence dépend de ce que la machine fait à côté — c'est la thèse que cet outil
 * défend, et elle s'est démontrée contre lui : un pilote audio oublié valait un tiers de
 * la latence de la chaîne. Publier ce fait demande de pouvoir le refaire, donc de fabriquer
 * la charge au lieu de la subir.
 *
 * « J'ai chargé la machine à huit » ne se reproduit pas : ni par un lecteur, ni par son
 * auteur six mois plus tard, ni sur une machine qui n'a pas le même nombre de cœurs. Une
 * commande, si. Le relevé nomme donc ce script et son argument plutôt qu'une phrase, et
 * quiconque refait l'expérience exécute ce qui a été exécuté, pas son interprétation.
 *
 *     node src/charger.mjs 8        huit boucles, jusqu'à Ctrl-C
 *     node src/charger.mjs 8 600    huit boucles, dix minutes, puis s'arrête seul
 *
 * Chaque boucle occupe un cœur à saturer. La charge obtenue n'égale pas le nombre de
 * boucles — elle s'en approche par le bas, et le relevé enregistre la charge **constatée**
 * à côté de celle visée : c'est ce couple qui dit si l'expérience a fait ce qu'elle voulait.
 */

import { availableParallelism, loadavg } from "node:os";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Le fils d'abord, avant toute autre chose.
 *
 * Cette vérification était sous le contrôle des arguments, et `fork` n'en transmet aucun :
 * chaque fils lisait donc « zéro boucle », imprimait l'aide et mourait avant d'atteindre sa
 * boucle. Le père annonçait « 8 boucles » et la charge **descendait** — c'est la mesure qui
 * a signalé le défaut, l'inverse de ce qu'elle devait produire.
 *
 * Un fils n'a pas d'arguments à valider ; il n'a qu'à occuper un cœur.
 */
if (process.env.CHARGER_FILS) {
  for (;;) { /* saturer un cœur */ }
}

const boucles = Number(process.argv[2] ?? 0);
const secondes = Number(process.argv[3] ?? 0);

if (!Number.isInteger(boucles) || boucles < 1) {
  console.error("usage : node src/charger.mjs <boucles> [secondes]");
  console.error(`  cette machine a ${availableParallelism()} cœurs disponibles`);
  process.exit(1);
}

const fils = Array.from({ length: boucles }, () =>
  fork(fileURLToPath(new URL(import.meta.url)), { env: { ...process.env, CHARGER_FILS: "1" }, stdio: "ignore" }));

const arreter = () => { for (const f of fils) f.kill("SIGKILL"); process.exit(0); };
process.on("SIGINT", arreter);
process.on("SIGTERM", arreter);
if (secondes > 0) setTimeout(arreter, secondes * 1000);

console.log(`${boucles} boucle(s) sur ${availableParallelism()} cœurs — charge avant : ${loadavg()[0].toFixed(2)}`);
setInterval(() => console.log(`  charge : ${loadavg()[0].toFixed(2)}`), 30_000).unref?.();
