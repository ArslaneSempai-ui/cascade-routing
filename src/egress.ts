/**
 * La preuve que rien ne sort — et la précision qui la rend vraie.
 *
 * « Everything runs locally, nothing leaves the machine » est la phrase la plus importante de
 * ce dépôt pour quelqu'un qui manipule des données réelles, et c'était une affirmation. Tout
 * le reste de la page vend de la preuve contre de l'opinion ; celle-là faisait exception.
 *
 * ─── Ce que la mesure établit exactement ───
 *
 * Elle échantillonne les connexions réseau ouvertes par le processus de mesure, pendant qu'il
 * mesure, et rapporte ce qu'elle voit. Deux résultats sont possibles et **les deux méritent
 * d'être publiés** :
 *
 * - aucune connexion : la phrase est vraie telle quelle ;
 * - des connexions vers le dépôt de modèles au premier lancement : la phrase doit être
 *   précisée en « aucune de **vos** données ne sort ; le seul trafic est le téléchargement,
 *   une fois, de poids publics ».
 *
 * La seconde formulation est plus forte que la première, pas plus faible : elle est exacte, et
 * un lecteur qui vérifie trouvera exactement ce qui est écrit.
 *
 * ─── Ce qu'elle n'établit pas ───
 *
 * Un échantillonnage voit les connexions ouvertes aux instants où il regarde. Il ne prouve pas
 * l'absence d'un envoi bref entre deux relevés. Pour ça il faudrait une capture au niveau du
 * noyau, qui demande des privilèges que ce script n'a pas — et le dire est le seul moyen que
 * cette page reste du même genre que le reste.
 */

import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isMain } from "./cli.ts";
import { fileURLToPath } from "node:url";

const FICHIER = fileURLToPath(new URL("../data/egress.json", import.meta.url));

export type Connexion = { hote: string; port: string; etat: string; vu: number };

/**
 * Ce qu'un échec de `lsof` veut dire — isolé ici parce que c'est LA décision du fichier.
 *
 * Elle vivait dans un `catch {}` sans argument, donc elle n'était pas testable, donc elle
 * n'était pas testée, donc elle était fausse : les trois cas rendaient le même tableau vide et
 * le rapport en concluait « aucune connexion réseau observée ». Une décision qu'on ne peut pas
 * appeler depuis un test est une décision que personne ne relira.
 */
export function verdictDeLsof(err: { code?: string; status?: number }): "absent" | "sansSocket" | "inattendu" {
  if (err.code === "ENOENT") return "absent";
  if (err.status === 1) return "sansSocket";
  return "inattendu";
}

/** Les connexions réseau d'un processus, à cet instant. */
/**
 * La boucle locale n'est pas une sortie.
 *
 * `127.0.0.1` et `::1` désignent CETTE machine. Une connexion vers elles ne fait sortir
 * aucune donnée — c'est la définition même. Elles étaient pourtant comptées comme « hôtes
 * contactés », si bien que la seule présence d'un Ollama local empêchait l'outil de conclure
 * « rien n'est sorti » : le verdict le plus vendable du dépôt devenait impossible à
 * atteindre sur la machine où il est justement vrai.
 *
 * Elles restent RAPPORTÉES — savoir que la mesure a parlé à un modèle local est une
 * information — mais dans leur propre catégorie.
 */
export function estBoucleLocale(hote: string): boolean {
  const h = hote.replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost" || /^127\./.test(h);
}

export const ASSEZ_DE_RELEVES = 20;

/**
 * Ce qu'un relevé de trafic permet de conclure — et ce qu'il ne permet pas.
 *
 * Sorti en fonction pure pour la même raison que les autres : un témoin qui devrait lancer
 * une vraie passe ne pourrait éprouver ni la passe trop courte, ni la sortie réelle. Les deux
 * cas qui décident sont précisément ceux qu'on ne peut pas provoquer à volonté.
 */
export function verdictEgress(o: { releves: number; connexions: { hote: string; vu: number }[] }) {
  const locales = o.connexions.filter((c) => estBoucleLocale(c.hote));
  const sorties = o.connexions.filter((c) => !estBoucleLocale(c.hote));
  /*
   * LE PLANCHER GARDE LES DEUX SENS.
   *
   * Il ne refusait de conclure que sur « rien vu ». Une passe de cinq relevés qui avait vu
   * quelque chose publiait pourtant « ces hôtes-là » — alors que **ce qu'elle n'a pas vu,
   * elle ne l'a pas vu non plus**. Trop court est trop court dans les deux directions.
   */
  if (o.releves < ASSEZ_DE_RELEVES) {
    return { concluant: false, locales, sorties,
      verdict: `non concluant : ${o.releves} relevés, il en faut ${ASSEZ_DE_RELEVES}` };
  }
  return {
    concluant: true, locales, sorties,
    verdict: sorties.length === 0
      ? (locales.length === 0
        ? "aucune connexion observée pendant toute la passe"
        : `aucune sortie observée ; ${locales.length} connexion(s) vers cette machine seulement`)
      : `${sorties.length} hôte(s) hors de cette machine contacté(s)`,
  };
}

function connexions(pid: number): { hote: string; port: string; etat: string }[] {
  try {
    const sortie = execFileSync("lsof", ["-nP", "-i", "-a", "-p", String(pid)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return sortie.split("\n").slice(1).filter(Boolean).map((l) => {
      const champs = l.trim().split(/\s+/);
      const adresse = champs.find((c) => c.includes("->")) ?? champs.at(-2) ?? "";
      const cible = adresse.split("->")[1] ?? adresse;
      const i = cible.lastIndexOf(":");
      return { hote: i > 0 ? cible.slice(0, i) : cible, port: i > 0 ? cible.slice(i + 1) : "", etat: champs.at(-1) ?? "" };
    }).filter((c) => c.hote && c.hote !== "*");
  } catch (e) {
    /*
     * TROIS SITUATIONS RENDAIENT LE MÊME TABLEAU VIDE, ET LA TROISIÈME EST UN MENSONGE.
     *
     *   — `lsof` sort en 1 parce que le processus n'a aucune socket : c'est le cas nominal,
     *     et le vide est la bonne réponse.
     *   — `lsof` est absent de la machine : on n'a RIEN observé, et le vide se lisait
     *     « aucune connexion ».
     *   — `lsof` refuse par permission : idem.
     *
     * Le rapport conclut ensuite « Aucune connexion réseau observée » et adosse à cette
     * phrase la promesse la plus vendable du dépôt — « nothing leaves the machine ». Chez un
     * client dont la machine n'a pas `lsof`, ou le restreint, l'outil confirmait la promesse
     * SANS AVOIR REGARDÉ. Une absence d'observation ne se distinguait pas d'une observation
     * d'absence, et c'est précisément la confusion qu'un audit se fait payer pour éviter.
     */
    const err = e as { code?: string; status?: number };
    if (verdictDeLsof(err) === "absent") {
      throw new Error(
        "`lsof` est introuvable sur cette machine, donc RIEN n'a été observé.\n"
        + "  Cet outil refuse de conclure : « aucune connexion vue » et « aucune connexion »\n"
        + "  sont deux phrases différentes, et c'est toute la valeur de ce contrôle.\n"
        + "  Sur macOS `lsof` est livré avec le système ; sur Linux : apt install lsof.");
    }
    if (verdictDeLsof(err) === "inattendu") {
      throw new Error(
        `\`lsof\` a échoué avec le code ${err.status ?? "inconnu"} — ce n'est pas le code que\n`
        + "  rend un processus sans socket (1). L'observation n'a donc pas eu lieu, et rendre\n"
        + "  un tableau vide ici reviendrait à publier « aucune connexion » sans avoir regardé.");
    }
    return [];   // code 1 : le processus n'a aucune socket ouverte. Le vide est la mesure.
  }
}

/**
 * `lsof` répond-il, ici, maintenant ? Vérifié UNE FOIS avant de lancer quoi que ce soit.
 *
 * La garde ci-dessus n'attrape la panne qu'au premier relevé, c'est-à-dire après avoir lancé
 * la mesure surveillée — donc après avoir laissé partir le trafic qu'on prétendait observer.
 * Un contrôle qui découvre son impuissance en cours de route arrive trop tard pour la seule
 * chose qu'il devait empêcher.
 */
export function lsofRepond(): boolean {
  try {
    execFileSync("lsof", ["-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (e) {
    /* `lsof -v` écrit sa version sur stderr et sort parfois non nul : présent quand même. */
    return (e as { code?: string }).code !== "ENOENT";
  }
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  /*
   * PAS DE COMMANDE PAR DÉFAUT, ET SURTOUT PAS CELLE-LÀ.
   *
   * Elle lançait `src/measure.ts` — une passe de mesure complète, qui RÉÉCRIT le relevé gelé.
   * Vérifier la confidentialité ne doit pas avoir d'effet de bord, et encore moins celui-là :
   * lancer ce contrôle « pour voir » remplaçait les chiffres publiés par une passe que
   * personne n'avait décidé de prendre. C'est arrivé.
   */
  if (!args.length) {
    console.error(`\n  Ce contrôle surveille le réseau PENDANT une commande, et il faut lui dire`);
    console.error(`  laquelle. Il n'en choisit pas : la commande évidente — une mesure — réécrit`);
    console.error(`  le relevé gelé, et un contrôle de confidentialité ne doit rien réécrire.\n`);
    console.error(`      npm run egress -- src/measure.ts        surveille une vraie mesure`);
    console.error(`      npm run egress -- src/optimise.ts       surveille une passe qui ne mesure rien\n`);
    process.exit(1);
  }
  const commande = args;
  const intervalle = Number(process.argv.find((a) => a.startsWith("--every="))?.split("=")[1] ?? 250);

  if (!lsofRepond()) {
    console.error("\n`lsof` est introuvable : ce contrôle ne peut rien observer, donc il ne");
    console.error("  démarre pas. Publier « aucune connexion réseau observée » après n'avoir");
    console.error("  rien pu observer serait exactement le défaut que ce fichier existe pour");
    console.error("  empêcher.\n");
    process.exit(1);
  }

  console.log(`\nSurveillance du trafic réseau pendant : node ${commande.join(" ")}`);
  console.log(`Relevé toutes les ${intervalle} ms. Deux résultats sont publiables : aucune`);
  console.log(`connexion, ou des connexions vers le dépôt de modèles seulement.\n`);

  const enfant = spawn("node", commande, { stdio: ["ignore", "ignore", "ignore"] });
  const vues = new Map<string, Connexion>();
  let releves = 0;

  const minuteur = setInterval(() => {
    releves++;
    for (const c of connexions(enfant.pid!)) {
      const cle = `${c.hote}:${c.port}`;
      const deja = vues.get(cle);
      if (deja) deja.vu++;
      else vues.set(cle, { ...c, vu: 1 });
    }
  }, intervalle);

  const code: number = await new Promise((r) => enfant.on("exit", (c) => r(c ?? 0)));
  clearInterval(minuteur);

  const liste = [...vues.values()].sort((a, b) => b.vu - a.vu);

  /*
   * Assez de relevés pour que « rien vu » veuille dire quelque chose.
   *
   * Ce dépôt refuse de rapporter un taux sous vingt observations. Un seul coup d'œil pendant
   * une commande qui dure trois cents millisecondes n'établit pas plus l'absence de trafic
   * qu'un tirage sur quatre cas n'établit une exactitude — et un script qui conclurait quand
   * même serait exactement le genre d'outil que cette page passe sa vie à dénoncer.
   */
  const ASSEZ = ASSEZ_DE_RELEVES;
  /*
   * LE PLANCHER NE GARDAIT QU'UN SENS.
   *
   * Il refusait de conclure sur trop peu de relevés **quand rien n'avait été vu**, et
   * concluait sans broncher quand quelque chose l'avait été. Or une passe de cinq relevés
   * n'établit pas plus « ces hôtes-là et pas d'autres » qu'elle n'établit « aucun » : ce
   * qu'elle n'a pas vu, elle ne l'a pas vu non plus.
   */
  if (releves < ASSEZ) {
    console.log(`${releves} relevés seulement — trop court pour établir quoi que ce soit,`);
    console.log(`${liste.length ? `y compris que les ${liste.length} hôte(s) vus soient les seuls.` : `dans un sens comme dans l'autre.`}`);
    console.log(`Il en faut au moins ${ASSEZ} : surveiller une vraie mesure, pas une commande instantanée.\n`);
    process.exitCode = 1;
    writeFileSync(FICHIER, JSON.stringify({
      mesureLe: new Date().toISOString(), commande: `node ${commande.join(" ")}`,
      releves, intervalleMs: intervalle, codeSortie: code, connexions: [],
      verdict: `non concluant : ${releves} relevés, il en faut ${ASSEZ}`,
    }, null, 2));
    process.exit(1);
  }
  /* LA BOUCLE LOCALE À PART. Elle ne fait rien sortir, et la compter empêchait le verdict
     d'être atteignable sur la machine où il est justement vrai. */
  const locales = liste.filter((c) => estBoucleLocale(c.hote));
  const sorties = liste.filter((c) => !estBoucleLocale(c.hote));

  const releve = {
    mesureLe: new Date().toISOString(),
    commande: `node ${commande.join(" ")}`,
    releves, intervalleMs: intervalle, codeSortie: code,
    connexions: sorties,
    bouclesLocales: locales,
    verdict: sorties.length === 0
      ? (locales.length === 0
        ? "aucune connexion observée pendant toute la passe"
        : `aucune sortie observée ; ${locales.length} connexion(s) vers cette machine seulement`)
      : `${sorties.length} hôte(s) hors de cette machine contacté(s)`,
    limite: "Un échantillonnage voit les connexions ouvertes aux instants où il regarde ; il "
      + "n'exclut pas un envoi bref entre deux relevés. Une preuve complète demanderait une "
      + "capture au niveau du noyau, avec les privilèges correspondants.",
  };
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(releve, null, 2));

  console.log(`${releves} relevés, code de sortie ${code}.\n`);
  if (locales.length) {
    console.log("Vers cette machine — rien ne sort par là :");
    for (const c of locales) console.log(`  ${c.hote}:${c.port}  vu ${c.vu} fois  (${c.etat})`);
    console.log("");
  }
  if (!sorties.length) {
    console.log("Aucune connexion hors de cette machine. La phrase « nothing leaves the machine »");
    console.log("tient telle quelle pour cette exécution.\n");
  } else {
    console.log("Hôtes contactés HORS de cette machine :");
    for (const c of sorties) console.log(`  ${c.hote}:${c.port}  vu ${c.vu} fois  (${c.etat})`);
    console.log("\nSi ce sont des dépôts de modèles, la phrase à publier devient : « aucune de vos");
    console.log("données ne sort ; le seul trafic est le téléchargement, une fois, de poids publics ».\n");
  }
  console.log(`Relevé écrit dans data/egress.json.\n`);
}
