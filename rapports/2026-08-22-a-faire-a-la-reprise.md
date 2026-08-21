# Two things owed at the resumption, written during the pause

No code is changed here and nothing is run — the machine is held for three bench
passes that need it idle. This is the design, so the work starts rather than
begins at the resumption.

## 1. My own journals cannot answer the question that just broke the bench

The M5's non-reproducibility is best explained by memory famine: one bench pass
started with 69 MB free while the machine now sits at 465 MB free and 4.19 GB
swapped, under four sessions.

**Every latency this repository recorded today ran on that machine, and none of
the journals records free memory.** The run header carries `chargeAvant`, the
footer carries load sampled during, and both are load — a run queue, not memory.
So for any pass of today I can say what the load was and I cannot say whether it
was starving.

That is the same gap the bench just closed, in my own records, and I did not see
it until it was found elsewhere.

**At the resumption:** free memory and swap at the run header, memory pressure
sampled into the footer beside the load, and `chargeExterneAvantSousLeSeuil`
joined by a memory equivalent. Existing journals get an appended note rather than
a rewrite — the append-only format exists for exactly this.

What it does not do is repair today's passes. Their durations stay unusable for
comparison across the day, which was already true for other reasons on several of
them.

## 2. Refusing to start becomes a rule, not a property of one harness

Promised earlier and still owed: anything that produces a duration should refuse
to start under conditions that would invalidate it, rather than record the
conditions and let a reader notice.

The shape, so it does not become a guard that cries wrongly — the failure mode
already met twice tonight:

- the threshold is a **parameter with a declared default**, not a constant, and it
  is written into the run header before the first attempt;
- it judges **external** conditions at the start — load per core, and now free
  memory — never the load the pass itself creates, which is the mistake that made
  the first version condemn every pass;
- a refusal names the reading and the threshold, so the operator can raise it
  deliberately rather than delete the check;
- and an override is recorded in the header, exactly as `--allow-load` already is
  in `measure.ts`, so a pass taken under protest says so in its own file.

`measure.ts` already has the load half of this. The other seven scripts that
produce durations do not, and they are the ones that produced most of today's
figures.

## Why both belong to the same lesson

A condition that invalidates a measurement has to be **recorded** to be
noticeable and **refused** to be prevented, and today produced one of each
failure: figures whose load was recorded but not refused, and figures whose
memory was neither.
