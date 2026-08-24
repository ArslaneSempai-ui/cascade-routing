/**
 * Ce que la contrainte de sortie achète, mesuré au lieu d'être minoré par un plafond choisi.
 *
 * Le chiffre retiré hier — « contraindre le format divise le prix par 8,4 » — était borné par
 * mon propre `num_predict` de 200 : la moyenne non contrainte valait exactement 200,0, donc ce
 * n'était pas une longueur mais le plafond. Ce banc lève le plafond assez haut pour que la
 * longueur soit **observée**, et un pilote l'a vérifié avant de fixer la valeur : à 4 000
 * jetons autorisés, un appel des trois paliers s'arrête de lui-même.
 *
 * **Le pilote était un seul appel, et il avait tort.** Sur vingt, `gen-4b` atteint le plafond
 * de 4 000 cinq fois, aux deux passes. Sa médiane de 2 480 est réelle ; son maximum est encore
 * mon réglage. C'est la même faute que le chiffre qu'on remplace — une longueur qui est en fait
 * un plafond — un ordre de grandeur plus loin. `plafondAtteint` est émis à côté de la longueur
 * pour que le lecteur voie que le maximum est le réglage.
 *
 * **Et le pilote a déplacé la question.** Sans schéma, `gen-0.6b` rend 8 jetons et `gen-8b` en
 * rend 6 — ils s'arrêtent seuls. Seul `gen-4b` s'emballe, à 3 508 jetons. Ce n'est donc pas
 * « la contrainte de sortie vaut cher » mais « **un palier sur trois ne s'arrête pas sans
 * elle** », ce qui est plus étroit, plus surprenant, et actionnable pour quelqu'un qui n'emploie
 * pas ce palier-là.
 *
 * **Ce qui se compte et ce qui se chronomètre.** Le nombre de jetons est un fait sur la sortie
 * du modèle : il se reproduit ailleurs et se publie tel quel. Les durées sont des faits sur
 * cette machine, sa charge et l'instant — et elle est ce matin à 544 Mo libres avec 31 millions
 * de swapouts, donc **sous le seuil d'un gigaoctet que ce projet s'est donné**. Le banc relève
 * l'état mémoire au départ de chaque passe et le porte dans son relevé ; les durées y sont, avec
 * leur dispersion, marquées comme non transportables. Le titre du résultat est un compte.
 *
 * **Deux passes par point, au minimum.** Une machine qui ne rend pas deux fois le même nombre ne
 * mesure rien, et c'est la leçon d'un banc à deux machines qui a coûté une nuit.
 *
 *     npm run contrainte
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { isMain } from "./cli.ts";
import { PROMPTS, OLLAMA, MODELES_LOCAUX, correct, normaliserReponse } from "./tiers.ts";
import { FIELDS, generateRecords } from "./corpus.ts";

import type { Field } from "./corpus.ts";
import { fileURLToPath } from "node:url";

const SORTIE = fileURLToPath(new URL("../contrainte.json", import.meta.url));

/** Le plafond, choisi après un pilote qui a montré qu'il ne mord pas. */
export const PLAFOND_JETONS = 4000;

/** Le seuil sous lequel une durée de ce dépôt ne se transporte pas. */
export const MEMOIRE_LIBRE_MINIMALE_MO = 1024;

/** L'état de la machine, relevé et jamais supposé. */
/**
 * Ce qu'une sortie de `vm_stat` dit de la mémoire réellement disponible.
 *
 * Sorti en fonction pure pour une seule raison : le témoin. Une lecture qui shelle
 * directement ne peut être éprouvée que sur la machine qui la lance, donc jamais sur les cas
 * qui l'ont fait mentir — une autre taille de page, un inactif volumineux.
 */
export function memoireDisponibleMo(sortieVmStat: string): number {
  /*
   * LA TAILLE DE PAGE SE LIT, ELLE NE S'ÉCRIT PAS.
   *
   * Elle était en dur à 4096. `vm_stat` annonce **16384** sur cette machine — Apple Silicon —
   * donc chaque octet rendu ici valait le quart du vrai. La première ligne porte le chiffre ;
   * l'écrire à la main revenait à supposer un modèle de processeur.
   */
  const taillePage = Number(/page size of (\d+) bytes/.exec(sortieVmStat)?.[1] ?? 4096);
  const lire = (nom: string) => {
    const m = new RegExp(`${nom}:\\s+(\\d+)`).exec(sortieVmStat);
    return m ? Number(m[1]) * taillePage : 0;
  };
  /*
   * ET « LIBRE » SUR macOS N'EST PAS CE QUI EST DISPONIBLE.
   *
   * Le système garde les pages récemment libérées en INACTIF plutôt que de les rendre : elles
   * sont réutilisables immédiatement, et sur une machine qui travaille elles sont l'essentiel
   * du disponible. Les exclure faisait annoncer 532 Mo là où 5,6 Go étaient réutilisables, et
   * une garde qui crie à tort finit ignorée — avec elle, les vraies alertes.
   */
  return Math.round(
    (lire("Pages free") + lire("Pages speculative") + lire("Pages inactive")) / 1e6);
}

export function etatMachine() {
  const vm = execFileSync("vm_stat", { encoding: "utf8" });
  const taillePage = Number(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 4096);
  const lire = (nom: string) => {
    const m = new RegExp(`${nom}:\\s+(\\d+)`).exec(vm);
    return m ? Number(m[1]) * taillePage : 0;
  };
  const libreMo = memoireDisponibleMo(vm);
  return {
    chargeParCoeur: Number((loadavg()[0]! / cpus().length).toFixed(2)),
    charge: Number(loadavg()[0]!.toFixed(2)),
    coeurs: cpus().length,
    memoireLibreMo: libreMo,
    swapouts: lire("Swapouts") / 4096,
    dureesTransportables: libreMo >= MEMOIRE_LIBRE_MINIMALE_MO,
  };
}

/**
 * Sortir une valeur d'une réponse en prose.
 *
 * Sans schéma, `gen-4b` raisonne à voix haute et pose sa réponse quelque part dedans. Sans cet
 * extracteur, le bras non contraint aurait zéro d'exactitude et la comparaison mesurerait notre
 * incapacité à lire sa sortie plutôt que sa capacité à répondre.
 *
 * C'est une heuristique, déclarée avant la mesure et volontairement simple : le contenu du
 * dernier `\boxed{}`, sinon d'un guillemet, sinon ce qui suit le dernier « Answer: », sinon la
 * dernière ligne non vide. **Ses échecs comptent contre le bras non contraint**, ce qui est le
 * bon sens de l'erreur : une chaîne dont on ne sait pas lire la sortie ne vaut pas mieux qu'une
 * chaîne qui répond mal, du point de vue de qui l'exploite.
 */
export function extraireDeLaProse(texte: string): string {
  const t = texte.trim();
  if (!t) return "";
  const boxed = [...t.matchAll(/\\boxed\{([^}]*)\}/g)].pop();
  if (boxed) return boxed[1]!.trim();
  const guill = [...t.matchAll(/"([^"\n]{1,80})"/g)].pop();
  if (guill) return guill[1]!.trim();
  const apres = [...t.matchAll(/(?:Answer|Réponse)\s*:\s*(.+)/gi)].pop();
  if (apres) return apres[1]!.trim();
  const lignes = t.split("\n").map((l) => l.trim()).filter(Boolean);
  return lignes[lignes.length - 1] ?? "";
}

const SCHEMA = { type: "object", properties: { value: { type: "string" } }, required: ["value"] };

async function appeler(tag: string, invite: string, avecSchema: boolean) {
  const t0 = performance.now();
  const corps: Record<string, unknown> = {
    model: tag, prompt: invite, stream: false, think: false,
    options: { temperature: 0, num_predict: PLAFOND_JETONS },
  };
  if (avecSchema) corps.format = SCHEMA;
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps),
  });
  const j = await r.json() as { response?: string; eval_count?: number; done_reason?: string };
  const brut = String(j.response ?? "");
  let valeur = "";
  if (avecSchema) { try { valeur = String(JSON.parse(brut).value ?? ""); } catch { valeur = ""; } }
  else valeur = extraireDeLaProse(brut);
  return {
    ms: performance.now() - t0, jetons: j.eval_count ?? 0,
    arret: j.done_reason ?? "?", valeur, plafondAtteint: (j.eval_count ?? 0) >= PLAFOND_JETONS,
  };
}

if (isMain(import.meta)) {
  const cas = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 4);
  const passes = Number(process.argv.find((a) => a.startsWith("--passes="))?.split("=")[1] ?? 2);
  const dossiers = generateRecords(cas, "dev");
  const paliers = ["gen-0.6b", "gen-4b", "gen-8b"] as const;

  const depart = etatMachine();
  console.log(`\nContrainte de sortie — ${paliers.length} paliers × 2 bras × ${passes} passes `
    + `× ${cas} cas × ${FIELDS.length} champs.`);
  console.log(`Plafond de jetons : ${PLAFOND_JETONS}, choisi après un pilote qui a montré qu'il ne mord pas.`);
  console.log(`Machine au départ : charge ${depart.charge}, ${depart.memoireLibreMo} Mo libres — `
    + `durées ${depart.dureesTransportables ? "transportables" : "NON transportables"}.`);
  if (!depart.dureesTransportables) {
    console.log(`  Sous ${MEMOIRE_LIBRE_MINIMALE_MO} Mo, une durée de ce dépôt ne se transporte pas.`);
    console.log(`  Le banc tourne quand même : le résultat qu'il cherche est un **compte de jetons**,`);
    console.log(`  qui est un fait sur la sortie et non sur la machine. Les durées seront marquées.\n`);
  }

  const lignes: Record<string, unknown>[] = [];
  for (let passe = 1; passe <= passes; passe++) {
    const etat = etatMachine();
    console.log(`  passe ${passe} — charge ${etat.charge}, ${etat.memoireLibreMo} Mo libres`);
    for (const tier of paliers) {
      for (const avecSchema of [true, false]) {
        const jetons: number[] = [], ms: number[] = [];
        let justes = 0, plafonds = 0, vides = 0;
        for (const d of dossiers) for (const c of FIELDS) {
          const r = await appeler(MODELES_LOCAUX[tier]!.tag, PROMPTS.reference(d.text, c), avecSchema);
          jetons.push(r.jetons); ms.push(r.ms);
          if (r.plafondAtteint) plafonds++;
          if (normaliserReponse(r.valeur).length === 0) vides++;
          if (correct(r.valeur, d.truth[c as Field])) justes++;
        }
        const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
        const bas = (v: number[]) => Math.min(...v), haut = (v: number[]) => Math.max(...v);
        lignes.push({
          passe, tier, schema: avecSchema, n: jetons.length,
          /*
           * Le qualificatif appartient au nom, jamais à la clé d'à côté.
           *
           * `msMediane` accompagné d'un `dureesTransportables: false` voisin est un chiffre qui
           * perd sa réserve dès qu'on le cite seul — et un chiffre voyage seul. Les durées de ce
           * banc sont prises sous famine mémoire ; elles s'appellent donc ainsi, et personne ne
           * peut les recopier sans recopier ce qu'elles valent.
           */
          jetonsMediane: med(jetons), jetonsMin: bas(jetons), jetonsMax: haut(jetons),
          ...(etat.dureesTransportables
            ? { msMediane: Number(med(ms).toFixed(0)), msMin: Number(bas(ms).toFixed(0)),
                msMax: Number(haut(ms).toFixed(0)) }
            : { msMedianeNonTransportableFamineMemoire: Number(med(ms).toFixed(0)),
                msMinNonTransportableFamineMemoire: Number(bas(ms).toFixed(0)),
                msMaxNonTransportableFamineMemoire: Number(haut(ms).toFixed(0)) }),
          justes, exactitude: Number((justes / jetons.length).toFixed(4)),
          vides, plafondAtteint: plafonds,
          memoireLibreMoAuDepart: etat.memoireLibreMo,
          dureesTransportables: etat.dureesTransportables,
        });
        console.log(`    ${tier.padEnd(9)} ${avecSchema ? "avec schéma " : "sans schéma "}`
          + `jetons ${String(med(jetons)).padStart(5)} [${bas(jetons)}–${haut(jetons)}]   `
          + `${String(med(ms).toFixed(0)).padStart(6)} ms${etat.dureesTransportables ? "" : "*"} `
          + `[${bas(ms).toFixed(0)}–${haut(ms).toFixed(0)}]   `
          + `juste ${(100 * justes / jetons.length).toFixed(0)} %   plafond atteint ${plafonds}/${jetons.length}`);
      }
    }
  }

  writeFileSync(SORTIE, JSON.stringify({
    quoi: "Ce que la contrainte de sortie achète, à plafond de jetons non mordant.",
    plafondJetons: PLAFOND_JETONS,
    pilote: "Vérifié avant de fixer le plafond : à 4 000 jetons autorisés, les trois paliers "
      + "s'arrêtent d'eux-mêmes. Une moyenne égale au plafond n'est pas une longueur, c'est le "
      + "plafond — c'est ce qui avait rendu le chiffre d'hier faux.",
    compteVersusDuree: "Le nombre de jetons est un fait sur la sortie du modèle : il se reproduit "
      + "sur une autre machine et se publie tel quel. Les durées sont des faits sur cette "
      + "machine, sa charge et sa mémoire ; chaque ligne porte l'état mémoire de sa passe et "
      + "`dureesTransportables` dit si ce dépôt les considère utilisables.",
    seuilMemoireLibreMo: MEMOIRE_LIBRE_MINIMALE_MO,
    extracteurDeProse: "Heuristique déclarée avant la mesure : dernier \\boxed{}, sinon dernier "
      + "guillemet, sinon ce qui suit le dernier « Answer: », sinon la dernière ligne non vide. "
      + "Ses échecs comptent contre le bras non contraint, ce qui est le bon sens de l'erreur.",
    machineAuDepart: depart, mesureLe: new Date().toISOString(),
    cas, passes, lignes,
  }, null, 2) + "\n");
  console.log(`\nÉcrit dans ${SORTIE.split("/").pop()}\n`);
}
