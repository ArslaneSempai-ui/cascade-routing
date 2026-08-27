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

import { isMain } from "./cli.ts";
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
/*
 * AGIR À L'IMPORT EST UN EFFET DE BORD QUE PERSONNE N'A DEMANDÉ.
 *
 * Ce fichier lançait sa commande au niveau du module : l'importer l'exécutait, et il va
 * jusqu'à `process.exit` — donc importer ce module TUE le processus qui l'importe. Un test
 * qui voudrait éprouver une de ses fonctions n'a aucun moyen de le charger.
 *
 * `pathToFileURL`, jamais `"file://" + argv[1]` : la concaténation échoue sur un chemin
 * contenant un espace ou un accent, et son échec est silencieux — le fichier ne fait alors
 * rien du tout et sort en 0, ce qui se lit comme un succès.
 */
/*
 * LA DÉTECTION DU POINT D'ENTRÉE VIENT DE `cli.ts`, ELLE NE SE RÉÉCRIT PAS ICI.
 *
 * Cinq modules portaient chacun leur copie de `import.meta.url === pathToFileURL(argv1).href`,
 * chacune avec son commentaire expliquant le piège URL-contre-chemin. Cinq copies d'une
 * comparaison subtile, c'est cinq endroits où se tromper demain et une correction à faire cinq
 * fois — et elles rendent toutes le même résultat le jour où on les écrit, ce qui est
 * exactement ce qui les rend difficiles à voir.
 *
 * `isMain` est éprouvé équivalent avant ce remplacement, sur les quatre cas qui séparent les
 * deux formes : chemin accentué avec espaces, invocation relative, et lien symbolique — où les
 * deux rendent `false`.
 */

if (isMain(import.meta)) {
  if (process.env.CHARGER_FILS) {
    /*
     * UN FILS DE CHARGE NE PEUT PAS COMPTER SUR SON PÈRE POUR MOURIR.
     *
     * `for(;;){}` n'atteint jamais la boucle d'événements : aucun signal n'est traité, et la
     * fermeture du canal IPC ne se voit pas non plus. Le père tue ses fils sur SIGINT, SIGTERM
     * et à l'échéance — mais s'il est tué en SIGKILL (supervision, OOM, `kill -9`), personne
     * ne les tue, et N cœurs restent saturés indéfiniment. Sur une machine où six sessions
     * mesurent des temps réels, c'est une panne qui se paie ailleurs et longtemps.
     *
     * Le fils vérifie donc LUI-MÊME, dans sa boucle : son père a-t-il changé — un orphelin
     * est réattaché au processus 1 — et l'échéance est-elle passée. Le contrôle coûte un
     * accès de propriété tous les cinq millions de tours, soit indétectable devant la charge
     * qu'il produit.
     */
    const pere = Number(process.env.CHARGER_PERE ?? 0);
    const fin = Number(process.env.CHARGER_FIN ?? 0);
    for (let i = 0; ; i++) {
      if ((i & 0x4fffff) === 0) {
        if (pere && process.ppid !== pere) process.exit(0);
        if (fin && Date.now() > fin) process.exit(0);
      }
    }
  }

  const boucles = Number(process.argv[2] ?? 0);
  const secondes = Number(process.argv[3] ?? 0);

  if (!Number.isInteger(boucles) || boucles < 1) {
    console.error("usage: node src/charger.mjs <loops> [seconds]");
    console.error(`  this machine has ${availableParallelism()} core(s) available`);
    process.exit(1);
  }

  const fils = Array.from({ length: boucles }, () =>
    fork(fileURLToPath(new URL(import.meta.url)), {
      /* Le fils reçoit de quoi s'arrêter seul : le pid de son père, et l'échéance s'il y en
         a une. Sans ça, il dépend d'un père qui peut disparaître sans un mot. */
      env: {
        ...process.env, CHARGER_FILS: "1", CHARGER_PERE: String(process.pid),
        ...(secondes > 0 ? { CHARGER_FIN: String(Date.now() + secondes * 1000) } : {}),
      },
      stdio: "ignore",
    }));

  const arreter = () => { for (const f of fils) f.kill("SIGKILL"); process.exit(0); };
  process.on("SIGINT", arreter);
  process.on("SIGTERM", arreter);
  if (secondes > 0) setTimeout(arreter, secondes * 1000);

  console.log(`${boucles} loop(s) on ${availableParallelism()} core(s) — load before: ${loadavg()[0].toFixed(2)}`);
  setInterval(() => console.log(`  load: ${loadavg()[0].toFixed(2)}`), 30_000).unref?.();

}
