/**
 * A property runner without a dependency.
 *
 * The suite wants property-based tests for the typed grader: hundreds of generated inputs
 * against a law, not five hand-picked examples. `fast-check` does this well and was removed
 * from this repository on purpose (TACHES.md: the dependency inventory is what a buyer
 * audits, and it is kept at what the tool needs to run). Two hundred lines cover what these
 * tests need: seeded generators, a fixed number of runs, and a failure that reports the
 * seed and the first input that broke the law, so it can be replayed.
 *
 * The random source is a linear congruential generator with a declared seed, the same
 * arithmetic `your-cases.ts` uses to draw a deterministic sample. Deterministic by design:
 * a property that fails on one machine fails on every machine, with the same input.
 */

export type Random = () => number;

export function rng(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export type Generator<T> = (r: Random) => T;

export const integer = (min: number, max: number): Generator<number> =>
  (r) => min + Math.floor(r() * (max - min + 1));

export const oneOf = <T>(items: readonly T[]): Generator<T> =>
  (r) => items[Math.floor(r() * items.length)]!;

export const boolean: Generator<boolean> = (r) => r() < 0.5;

export function arrayOf<T>(item: Generator<T>, min: number, max: number): Generator<T[]> {
  return (r) => {
    const n = integer(min, max)(r);
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(item(r));
    return out;
  };
}

export function stringOf(alphabet: string, min: number, max: number): Generator<string> {
  return (r) => arrayOf(oneOf([...alphabet]), min, max)(r).join("");
}

export function tuple<A, B>(a: Generator<A>, b: Generator<B>): Generator<[A, B]>;
export function tuple<A, B, C>(a: Generator<A>, b: Generator<B>, c: Generator<C>): Generator<[A, B, C]>;
export function tuple<A, B, C, D>(a: Generator<A>, b: Generator<B>, c: Generator<C>, d: Generator<D>): Generator<[A, B, C, D]>;
export function tuple(...gens: Generator<unknown>[]): Generator<unknown[]> {
  return (r) => gens.map((g) => g(r));
}

export function map<A, B>(g: Generator<A>, f: (a: A) => B): Generator<B> {
  return (r) => f(g(r));
}

export type Property<T> = (value: T) => boolean | void;

export type Report = { runs: number; seed: number };

/**
 * Run `law` on `runs` generated values. The law passes by returning true or nothing, and
 * fails by returning false or throwing. The error names the seed, the run and the value.
 */
export function forAll<T>(gen: Generator<T>, law: Property<T>, options: { runs?: number; seed?: number } = {}): Report {
  const runs = options.runs ?? 300;
  const seed = options.seed ?? 20260929;
  const r = rng(seed);
  for (let i = 0; i < runs; i++) {
    const value = gen(r);
    let held: boolean | void;
    try { held = law(value); }
    catch (e) {
      throw new Error(`property failed at run ${i + 1} of ${runs} (seed ${seed}) on ${JSON.stringify(value)}: ${(e as Error).message}`);
    }
    if (held === false) {
      throw new Error(`property failed at run ${i + 1} of ${runs} (seed ${seed}) on ${JSON.stringify(value)}`);
    }
  }
  return { runs, seed };
}
