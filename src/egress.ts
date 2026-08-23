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

/** Les connexions réseau d'un processus, à cet instant. */
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
  } catch {
    return [];   // lsof ne rend rien quand le processus n'a aucune socket : c'est le cas nominal
  }
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const commande = args.length ? args : ["src/measure.ts"];
  const intervalle = Number(process.argv.find((a) => a.startsWith("--every="))?.split("=")[1] ?? 250);

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
  const ASSEZ = 20;
  if (releves < ASSEZ && liste.length === 0) {
    console.log(`${releves} relevés seulement — trop court pour établir quoi que ce soit.`);
    console.log(`Il en faut au moins ${ASSEZ} : surveiller une vraie mesure, pas une commande instantanée.\n`);
    process.exitCode = 1;
    writeFileSync(FICHIER, JSON.stringify({
      mesureLe: new Date().toISOString(), commande: `node ${commande.join(" ")}`,
      releves, intervalleMs: intervalle, codeSortie: code, connexions: [],
      verdict: `non concluant : ${releves} relevés, il en faut ${ASSEZ}`,
    }, null, 2));
    process.exit(1);
  }
  const releve = {
    mesureLe: new Date().toISOString(),
    commande: `node ${commande.join(" ")}`,
    releves, intervalleMs: intervalle, codeSortie: code,
    connexions: liste,
    verdict: liste.length === 0
      ? "aucune connexion réseau observée pendant toute la mesure"
      : `${liste.length} hôte(s) contacté(s)`,
    limite: "Un échantillonnage voit les connexions ouvertes aux instants où il regarde ; il "
      + "n'exclut pas un envoi bref entre deux relevés. Une preuve complète demanderait une "
      + "capture au niveau du noyau, avec les privilèges correspondants.",
  };
  mkdirSync(dirname(FICHIER), { recursive: true });
  writeFileSync(FICHIER, JSON.stringify(releve, null, 2));

  console.log(`${releves} relevés, code de sortie ${code}.\n`);
  if (!liste.length) {
    console.log("Aucune connexion réseau observée. La phrase « nothing leaves the machine »");
    console.log("tient telle quelle pour cette exécution.\n");
  } else {
    console.log("Hôtes contactés :");
    for (const c of liste) console.log(`  ${c.hote}:${c.port}  vu ${c.vu} fois  (${c.etat})`);
    console.log("\nSi ce sont des dépôts de modèles, la phrase à publier devient : « aucune de vos");
    console.log("données ne sort ; le seul trafic est le téléchargement, une fois, de poids publics ».\n");
  }
  console.log(`Relevé écrit dans data/egress.json.\n`);
}
