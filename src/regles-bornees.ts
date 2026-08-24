/*
 * LE PALIER GRATUIT DU CLIENT, BORNÉ — ET REFUSÉ PLUTÔT QUE RALENTI.
 *
 * Une expression régulière fournie par le client qui ne s'arrête pas n'est pas une règle
 * lente : c'est une règle qu'on ne peut pas évaluer. Enregistrer son temps la ferait entrer
 * dans le chiffre qu'on vend — le temps par palier — et un client dont un export contient
 * `(a+)+$` verrait un palier « lent » qui ne l'est pas. Le chiffre serait faux, et faux dans
 * le sens qui accuse notre outil.
 *
 * Donc : une borne par évaluation, un refus qui nomme la règle et le cas, un temps rapporté
 * qui EXCLUT les règles refusées et qui PORTE LEUR COMPTE. Et le refus arrive avant la
 * mesure des modèles, pas au dossier quatre mille.
 */
import { Worker } from "node:worker_threads";

/**
 * Le temps qu'une évaluation a le droit de prendre, par cas.
 *
 * CHOISI, à partir d'une mesure. Sur le corpus d'essai du 25 août 2026, une règle ordinaire
 * (`Acme Ltd|Globex|Initech|Umbrella|Soylent`) évalue un cas en quelques microsecondes ; le
 * démarrage du fil coûte une vingtaine de millisecondes, une fois par règle. Deux cent
 * cinquante millisecondes laissent donc quatre ordres de grandeur de marge à une règle qui
 * travaille, et arrêtent en un quart de seconde une règle qui ne termine pas.
 */
export const MS_PAR_EVALUATION = 250;

export type ReglesEvaluees = {
  /** Par champ, la valeur trouvée pour chaque cas, dans l'ordre des cas. */
  valeurs: Record<string, string[]>;
  /** Par champ refusé, la raison — nommant le cas où l'évaluation s'est arrêtée. */
  refusees: Record<string, string>;
  /** Par champ retenu, le temps médian par cas. Les refusés n'y sont pas. */
  ms: Record<string, number>;
};

/** Le médian, parce qu'une moyenne sur des temps est tirée par sa queue. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)]!;
}

type Issue = { valeurs: string[]; ms: number } | { refus: string };

async function evaluerUne(motif: string, textes: string[], msMax: number): Promise<Issue> {
  const w = new Worker(new URL("./regles-ouvrier.ts", import.meta.url),
    { workerData: { motif, textes } });
  const valeurs: string[] = new Array(textes.length).fill("");
  const durees: number[] = [];
  let vus = 0;
  return await new Promise<Issue>((resoudre) => {
    let minuteur: ReturnType<typeof setTimeout>;
    const arreter = (r: Issue) => { clearTimeout(minuteur); void w.terminate(); resoudre(r); };
    /* La borne est réarmée à CHAQUE cas : c'est une borne par évaluation, pas par passe.
       Une règle qui met 200 ms sur chacun de dix mille cas est lente mais évaluable ; une
       règle qui ne rend pas la main sur un seul cas ne l'est pas. */
    const armer = () => {
      minuteur = setTimeout(() => arreter({
        refus: `did not finish within ${msMax} ms on case ${vus + 1} of ${textes.length}`,
      }), msMax);
    };
    armer();
    w.on("message", (m: { i?: number; valeur?: string; ms?: number; fini?: boolean }) => {
      if (m.fini) return arreter({ valeurs, ms: median(durees) });
      clearTimeout(minuteur);
      valeurs[m.i!] = m.valeur!;
      durees.push(m.ms!);
      vus++;
      armer();
    });
    w.on("error", (e) => arreter({ refus: `could not be evaluated — ${e.message}` }));
  });
}

/**
 * Évalue toutes les règles du client AVANT que le moindre modèle soit chargé.
 *
 * Découvrir au dossier quatre mille qu'une règle ne termine pas coûte tout ce qui précède.
 */
export async function evaluerRegles(
  regles: Record<string, RegExp>, textes: string[], msMax = MS_PAR_EVALUATION,
): Promise<ReglesEvaluees> {
  const out: ReglesEvaluees = { valeurs: {}, refusees: {}, ms: {} };
  for (const [champ, re] of Object.entries(regles)) {
    const r = await evaluerUne(re.source, textes, msMax);
    if ("refus" in r) out.refusees[champ] = r.refus;
    else { out.valeurs[champ] = r.valeurs; out.ms[champ] = r.ms; }
  }
  return out;
}

/**
 * La phrase à dire au client — un compte, et ce qu'il écarte.
 *
 * Un chiffre issu d'une sélection porte le compte de ce qu'il écarte, sinon le palier
 * gratuit a l'air d'avoir été mesuré en entier.
 */
export function direLesRefus(r: ReglesEvaluees): string | undefined {
  const noms = Object.keys(r.refusees);
  if (noms.length === 0) return undefined;
  const retenues = Object.keys(r.valeurs).length;
  return `⚠ ${noms.length} of your ${noms.length + retenues} rule(s) were refused, not `
    + `measured as slow:\n`
    + noms.map((n) => `    ${n}: ${r.refusees[n]}`).join("\n")
    + `\n  A pattern that does not return is not a slow rule, it is one that cannot be `
    + `evaluated.\n  Timing it would put it in the per-tier figure and make this tool look `
    + `slow for it.\n  The free tier below therefore covers ${retenues} rule(s), not `
    + `${noms.length + retenues}.`;
}
