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
import { drapeauEntier } from "./cas-demandes.ts";

/*
 * LE RELEVÉ VA À LA RACINE, PAS DANS `data/`.
 *
 * Il écrivait dans `data/egress.json`, et `data/` est ignoré par git — délibérément : il
 * porte les mesures faites sur les données d'un client. Ce relevé-ci n'en contient aucune :
 * il enregistre les hôtes contactés pendant une passe et un verdict. Mais il ne voyageait
 * pas.
 *
 * Conséquence : le README promet « nothing leaves your machine » et un acheteur qui clone ne
 * trouve AUCUNE preuve — la commande qui l'établit existe, son résultat n'est nulle part.
 * Tous les autres relevés du dépôt sont publiés ; celui qui porte l'argument de vente le
 * plus fort était le seul à rester sur la machine de l'auteur.
 *
 * C'est « un chiffre dérivé de quelque chose que git ne transporte pas », que ce dépôt a
 * déjà payé sept fois.
 */
/** L'intervalle d'échantillonnage par défaut, en millisecondes. */
export const INTERVALLE_EGRESS = 250;

const FICHIER = fileURLToPath(new URL("../egress.json", import.meta.url));

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
        ? "no connection observed for the whole pass"
        : `no outbound traffic observed; ${locales.length} connection(s) to this machine only`)
      : `${sorties.length} host(s) outside this machine were contacted`,
  };
}

/**
 * TOUS LES PROCESSUS DE LA PASSE, PAS SEULEMENT CELUI QU'ON A LANCÉ.
 *
 * `lsof -p <pid>` ne regarde qu'un processus. Une commande qui lance un fils sortait donc
 * du champ de l'observation sans que rien ne le dise, et l'outil publiait « No connection
 * outside this machine. The sentence "nothing leaves the machine" holds as written for this
 * run. » pendant que le fils tenait une connexion établie.
 *
 * Fabriqué et mesuré le 26 août 2026 : un script qui `spawn`e un fils, lequel ouvre une
 * connexion TCP vers une adresse non-bouclée pendant quatre secondes. Trente relevés, code
 * de sortie 0, verdict « aucune connexion » — et le serveur d'en face a journalisé la
 * connexion pendant cette passe exacte. Le même script, la connexion ouverte par le PÈRE :
 * l'hôte est rapporté, vu 27 fois sur 32.
 *
 * La descendance se recalcule à CHAQUE relevé : un fils qui naît après le premier coup
 * d'œil doit entrer dans le champ, sinon on a déplacé l'angle mort au lieu de le fermer.
 *
 * Le fichier déclarait déjà une limite — l'échantillonnage ne voit pas un envoi bref entre
 * deux relevés — et c'est ce qui rendait celle-ci invisible : une limite écrite se lit comme
 * LA limite.
 */
export function pidsSurveilles(racine: number): number[] {
  const vus = new Set<number>([racine]);
  try {
    const sortie = execFileSync("ps", ["-Ao", "pid=,ppid="],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const enfantsDe = new Map<number, number[]>();
    for (const l of sortie.split("\n")) {
      const [pid, ppid] = l.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(pid!) || !Number.isFinite(ppid!)) continue;
      if (!enfantsDe.has(ppid!)) enfantsDe.set(ppid!, []);
      enfantsDe.get(ppid!)!.push(pid!);
    }
    const pile = [racine];
    while (pile.length) {
      for (const e of enfantsDe.get(pile.pop()!) ?? []) {
        if (vus.has(e)) continue;   /* une table de processus incohérente ne doit pas boucler */
        vus.add(e); pile.push(e);
      }
    }
  } catch {
    /* `ps` a échoué : on surveille au moins la racine, et le compte de PID publié le dira. */
  }
  return [...vus];
}

export function connexions(pids: number[]): { hote: string; port: string; etat: string }[] {
  if (pids.length === 0) return [];
  try {
    const sortie = execFileSync("lsof", ["-nP", "-i", "-a", "-p", pids.join(",")],
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
        "`lsof` is not on this machine, so NOTHING was observed.\n"
        + "  This tool refuses to conclude: \u201cno connection seen\u201d and \u201cno connection\u201d\n"
        + "  are two different sentences, and that difference is this check's whole value.\n"
        + "  On macOS `lsof` ships with the system; on Linux: apt install lsof.");
    }
    if (verdictDeLsof(err) === "inattendu") {
      throw new Error(
        `\`lsof\` failed with code ${err.status ?? "unknown"} — that is not the code a\n`
        + "  process with no socket returns (1). The observation therefore did not happen, and\n"
        + "  returning an empty table here would publish \u201cno connection\u201d without having looked.");
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
  /*
   * CETTE COMMANDE EST UN CAS À PART, ET SA GARDE S'ARRÊTE AU PREMIER NON-DRAPEAU.
   *
   * `egress` en surveille une autre : `egress --every=250 src/your-cases.ts --cases=x.csv`.
   * Les drapeaux qui suivent le nom de script appartiennent à la commande OBSERVÉE, et les
   * refuser ici réintroduirait précisément le défaut qu'on vient de corriger — celui qui
   * empêchait `egress` de regarder le chemin client.
   */
  /* En attente d'une borne haute dans `refuserDrapeauxInconnus` : voir PAS_ENCORE, où cette
     commande est déclarée non couverte AVEC sa raison, plutôt que couverte à moitié. */
  /*
   * LES ARGUMENTS DE LA COMMANDE SURVEILLÉE NE SE JETTENT PAS.
   *
   * Ce filtre écartait tout ce qui commence par `--`, y compris les arguments DESTINÉS à la
   * commande observée. Conséquence mesurée : `egress src/your-cases.ts --cases=fichier.csv`
   * lançait `node src/your-cases.ts` tout court, qui affiche son usage et s'arrête — zéro
   * relevé, verdict non concluant. La seule commande que ce contrôle ne pouvait pas observer
   * était le CHEMIN CLIENT, c'est-à-dire exactement celle dont il établit la promesse.
   *
   * Ce qui suit le nom du script lui appartient. Ce qui le précède est pour nous.
   */
  const tous = process.argv.slice(2);
  const iScript = tous.findIndex((a) => !a.startsWith("--"));
  const args = iScript === -1 ? [] : tous.slice(iScript);
  /*
   * PAS DE COMMANDE PAR DÉFAUT, ET SURTOUT PAS CELLE-LÀ.
   *
   * Elle lançait `src/measure.ts` — une passe de mesure complète, qui RÉÉCRIT le relevé gelé.
   * Vérifier la confidentialité ne doit pas avoir d'effet de bord, et encore moins celui-là :
   * lancer ce contrôle « pour voir » remplaçait les chiffres publiés par une passe que
   * personne n'avait décidé de prendre. C'est arrivé.
   */
  if (!args.length) {
    console.error(`\n  This check watches the network DURING a command, and you have to tell it`);
    console.error(`  which one. It does not choose: the obvious command — a measurement — rewrites`);
    console.error(`  the frozen record, and a confidentiality check must rewrite nothing.\n`);
    console.error(`      npm run egress -- src/measure.ts        watches a real measurement`);
    console.error(`      npm run egress -- src/optimise.ts       watches a pass that measures nothing\n`);
    process.exit(1);
  }
  const commande = args;
  /* L'intervalle par défaut est nommé et exporté : un relevé publié porte sa valeur, et une
     garde le confronte au code. Un chiffre de réglage recopié à deux endroits dérive. */
  const intervalle = drapeauEntier("every", INTERVALLE_EGRESS, "a sampling interval in milliseconds");

  if (!lsofRepond()) {
    console.error("\n`lsof` is not available: this check can observe nothing, so it does not");
    console.error("  start. Publishing \u201cno network connection observed\u201d after having been");
    console.error("  able to observe nothing would be exactly the defect this file exists to");
    console.error("  prevent.\n");
    process.exit(1);
  }

  console.log(`\nWatching network traffic during: node ${commande.join(" ")}`);
  console.log(`Sampled every ${intervalle} ms. Two results are publishable: no`);
  console.log(`connection, or connections to the model hub only.\n`);

  /*
 * CE QUI EST ENREGISTRÉ NE DOIT PAS PORTER MA MACHINE.
 *
 * Le relevé notait la commande telle quelle, arguments compris — donc un chemin absolu vers
 * un corpus d'épreuve, contenant le nom d'utilisateur système. Dans un fichier destiné à un
 * dépôt public. « Ce que la page révèle sans le dire : chemins de fichiers, noms
 * d'utilisateur système » est une règle de ce projet, et son propre relevé de confidentialité
 * la violait.
 *
 * Le nom du script suffit à dire ce qui a été observé ; le chemin d'un fichier d'entrée
 * n'apprend rien à un lecteur et le renseigne sur nous.
 */
/** Le commit sous lequel ce relevé a été pris, ou son absence dite. */
function commitCourant(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch { return "hors dépôt"; }
}

function commandePubliable(c: readonly string[]): string {
  return "node " + c.map((a) => {
    const m = /^(--[a-z-]+=)(.*)$/.exec(a);
    if (m) return `${m[1]}<file>`;
    return a.includes("/") && !a.startsWith("src/") ? "<file>" : a;
  }).join(" ");
}

const enfant = spawn("node", commande, { stdio: ["ignore", "ignore", "ignore"] });
  const vues = new Map<string, Connexion>();
  let releves = 0;
  /* Combien de processus la passe a comptés au plus : « 1 » dit au lecteur que la commande
     n'a jamais eu de fils, donc que l'angle mort d'origine ne pouvait pas jouer ici. */
  let pidsMax = 0;

  const minuteur = setInterval(() => {
    releves++;
    const pids = pidsSurveilles(enfant.pid!);
    pidsMax = Math.max(pidsMax, pids.length);
    for (const c of connexions(pids)) {
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
    /*
     * CE REFUS SORTAIT EN 1 AVEC UN STDERR VIDE.
     *
     * Les trois autres refus de ce fichier écrivent sur la sortie d'erreur ; celui-ci
     * écrivait sur la sortie standard. Un appelant qui lit `stderr` — un pas d'intégration
     * continue, un script, un `2>&1 | grep` — voyait un échec muet, et le seul message qui
     * dit quoi faire partait dans un canal que personne ne regardait à ce moment-là.
     *
     * Trouvé par `documents-3c` le 26 août 2026 dans un fichier que j'avais ouvert pour
     * autre chose. Mesuré : `node src/egress.ts <commande instantanée>` rendait le code 1 et
     * zéro octet sur `stderr`.
     */
    console.error(`\n${releves} samples only — too short to establish anything,`);
    console.error(`${liste.length ? `including that the ${liste.length} host(s) seen are the only ones.` : `in either direction.`}`);
    console.error(`At least ${ASSEZ} are needed: watch a real measurement, not an instant command.\n`);
    process.exitCode = 1;
    writeFileSync(FICHIER, JSON.stringify({
      mesureLe: new Date().toISOString(), commande: commandePubliable(commande),
    /* LE COMMIT, COMME TOUT RELEVÉ DE CE DÉPÔT. Sans lui, un lecteur ne peut pas extraire le
       code qui a produit ce verdict — et c'est la seule raison d'enregistrer un commit. */
    code: { commit: commitCourant() },
      releves, intervalleMs: intervalle, codeSortie: code, connexions: [],
      verdict: `inconclusive: ${releves} samples, ${ASSEZ} are needed`,
    }, null, 2));
    process.exit(1);
  }
  /* LA BOUCLE LOCALE À PART. Elle ne fait rien sortir, et la compter empêchait le verdict
     d'être atteignable sur la machine où il est justement vrai. */
  const locales = liste.filter((c) => estBoucleLocale(c.hote));
  const sorties = liste.filter((c) => !estBoucleLocale(c.hote));

  const releve = {
    mesureLe: new Date().toISOString(),
    commande: commandePubliable(commande),
    /* LE COMMIT, COMME TOUT RELEVÉ DE CE DÉPÔT. Sans lui, un lecteur ne peut pas extraire le
       code qui a produit ce verdict — et c'est la seule raison d'enregistrer un commit. La
       garde du dépôt l'a exigé dès que ce relevé est devenu versionné, ce qui est le bon
       moment pour l'exiger. */
    code: { commit: commitCourant() },
    releves, intervalleMs: intervalle, codeSortie: code,
    /* COMBIEN DE PROCESSUS ONT ÉTÉ REGARDÉS. « 1 » dit que la commande n'a jamais eu de fils
       — donc que l'angle mort d'origine ne pouvait pas jouer sur cette passe-là. Sans ce
       nombre, un lecteur ne peut pas distinguer « aucun fils » de « fils non regardés », et
       c'est exactement la distinction que ce fichier existe pour tenir. */
    processusRegardes: pidsMax,
    connexions: sorties,
    bouclesLocales: locales,
    verdict: sorties.length === 0
      ? (locales.length === 0
        ? "no connection observed for the whole pass"
        : `no outbound traffic observed; ${locales.length} connection(s) to this machine only`)
      : `${sorties.length} host(s) outside this machine were contacted`,
    limite: "Sampling sees the connections open at the instants it looks; it does not rule "
      + "out a short send between two samples. What it establishes is a floor, not a proof — "
      + "and the floor is what a buyer can check for themselves by re-running it. The whole "
      + "process tree is watched, recomputed at every sample, and processusRegardes says how "
      + "many were found: a child process used to fall outside the observation in silence.",
  };
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(releve, null, 2));

  console.log(`${releves} samples over ${pidsMax} process(es), exit code ${code}.\n`);
  if (locales.length) {
    console.log("To this machine — nothing leaves through these:");
    for (const c of locales) console.log(`  ${c.hote}:${c.port}  seen ${c.vu} times  (${c.etat})`);
    console.log("");
  }
  if (!sorties.length) {
    console.log("No connection outside this machine. The sentence \u201cnothing leaves the machine\u201d");
    console.log("holds as written for this run.\n");
  } else {
    console.log("Hosts contacted OUTSIDE this machine:");
    for (const c of sorties) console.log(`  ${c.hote}:${c.port}  seen ${c.vu} times  (${c.etat})`);
    console.log("\nIf these are model hubs, the sentence to publish becomes: \u201cnone of your");
    console.log("data leaves; the only traffic is the one-time download of public weights\u201d.\n");
  }
  console.log(`Record written to egress.json.\n`);
}
