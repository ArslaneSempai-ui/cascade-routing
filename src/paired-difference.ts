/**
 * The interval on the difference of two accuracies measured on the SAME cases.
 *
 * Two sources graded on the same cases are not two samples, they are one sample judged
 * twice, and the interval on their difference has to be paired. The bound the audit used
 * until 2026-09-29 rescaled a Wilson interval on the share of disagreements that go to the
 * head, `(2 * wilson(gains, m) - 1) * m / n`, which treats the disagreement rate m/n as
 * known: when every disagreement favours the head the upper bound collapses onto the point
 * estimate, and an identical candidate (m = 0) came out LESS favourably than a worse one.
 * Reviewed and reproduced on 2026-09-29 (n = 60, six-point margin).
 *
 * This is Newcombe's hybrid score interval for paired proportions (method 10 in "Improved
 * confidence intervals for the difference between binomial proportions based on paired
 * data", Statistics in Medicine 1998). Each proportion gets its Wilson interval; the two are
 * combined with the phi coefficient of the 2x2 table, so an identical candidate has a tight
 * interval around zero and a candidate that only loses cases has a bound that moves with
 * every case it loses. A property test holds the second part: turning a case both got
 * right into a case only the head got right never lowers the head's worst-case advantage.
 *
 * `comparaison-appariee.ts` keeps the older bound: it is a shared file whose source is the
 * identite repository, copied byte for byte across the family, and it is not edited here.
 * The audit reads this module; `recommander()` will follow when identite carries it.
 */

import { wilson, pairedVerdict, ENOUGH } from "./interval.ts";

export type PairedTable = {
  /** Both right. */ a: number;
  /** Head right, candidate wrong. */ b: number;
  /** Candidate right, head wrong. */ c: number;
  /** Both wrong. */ d: number;
};

export type PairedDifference = {
  /** Cases graded on both sides. */
  n: number;
  table: PairedTable;
  /** Head accuracy minus candidate accuracy, on the paired cases. */
  difference: number;
  /** The interval on that difference, as proportions. `high` is the head's worst-case advantage,
      that is the most the candidate may be behind at this confidence. */
  low: number;
  high: number;
  /** McNemar exact on the discordant pairs; null without a disagreement. */
  p: number | null;
  /** The interval excludes zero: the sample separates the two. */
  separable: boolean;
  /** Fewer paired cases than the floor: nothing here should decide anything. */
  tooFew: boolean;
};

/** Count the 2x2 table from two verdict strings ("1", "0", anything else = not graded). */
export function pairedTable(head: string, candidate: string): PairedTable & { n: number } {
  if (head.length !== candidate.length) {
    throw new Error(`pairedTable(): ${head.length} verdict(s) against ${candidate.length}: not the same cases.`);
  }
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < head.length; i++) {
    const h = head[i], k = candidate[i];
    if ((h !== "1" && h !== "0") || (k !== "1" && k !== "0")) continue;
    if (h === "1" && k === "1") a++;
    else if (h === "1") b++;
    else if (k === "1") c++;
    else d++;
  }
  return { a, b, c, d, n: a + b + c + d };
}

/**
 * Newcombe method 10 on a 2x2 table. Returns null when no case is paired: an interval on
 * nothing is not a wide interval, it does not exist, and the caller must say so.
 */
export function newcombe(t: PairedTable, z = 1.96): PairedDifference | null {
  const n = t.a + t.b + t.c + t.d;
  if (n === 0) return null;
  const p1 = (t.a + t.b) / n, p2 = (t.a + t.c) / n;
  const [l1, u1] = wilson(t.a + t.b, n, z);
  const [l2, u2] = wilson(t.a + t.c, n, z);
  /* The phi coefficient of the table; zero when a marginal is empty, as Newcombe prescribes. */
  const marginals = (t.a + t.b) * (t.c + t.d) * (t.a + t.c) * (t.b + t.d);
  const phi = marginals > 0 ? (t.a * t.d - t.b * t.c) / Math.sqrt(marginals) : 0;
  const difference = p1 - p2;
  const delta = Math.sqrt(Math.max(0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2));
  const epsilon = Math.sqrt(Math.max(0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2));
  const low = Math.max(-1, difference - delta), high = Math.min(1, difference + epsilon);
  const discordant = t.b + t.c;
  const verdict = pairedVerdict(t.b, t.c);
  const p = discordant === 0 ? null : (verdict as { p: number }).p;
  return {
    n, table: { a: t.a, b: t.b, c: t.c, d: t.d }, difference, low, high, p,
    separable: low > 0 || high < 0,
    tooFew: n < ENOUGH,
  };
}

/** The whole comparison from two verdict strings; null when nothing is paired. */
export function pairedDifference(head: string, candidate: string, z = 1.96): PairedDifference | null {
  const t = pairedTable(head, candidate);
  return newcombe(t, z);
}
