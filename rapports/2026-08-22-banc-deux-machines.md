# Trying to break the two-machine result

*Written 22 August 2026. This report is a dated snapshot: it is not regenerated, and
the figures in it are those of that day.*

**Three of the six points below are withdrawn.** They were wrong, and the
corrections came from the session I was refuting. What survives is at the end,
and it is less than what I claimed.

---

## Withdrawn 1 — "the attribution does not match the files"

It does. The files carry **two top-level fields that both mean load**:

    chargeMediane            3.48 · 3.01 · 7.02 · 2      load across the whole pass
    conditionsDepart.load1   2.86 · 2.40 · 3.48 · 1.58   load at the first instant

I read `load1` and reported that no run started at 7.02, which is true and
irrelevant: 7.02 is `charge-elevee`'s `chargeMediane`, and it is exactly where the
summary said it was. Nobody invented a number. A scalar named *charge* carries two
quantities, and two people reading carefully disagreed for a whole night over a
shared name.

**How I missed a top-level field.** My first pass printed `list(d.keys())[:12]`
and the results as `trouve[:4]`. `chargeMediane` sits past the twelfth key. Two
truncations written for readability removed the evidence, and the second search —
which found it — differed only in not truncating.

## Withdrawn 2 — "there is no decay on either machine"

`charge-elevee` decays clearly, across its five 8b repetitions:

    18.09 → 15.91 → 14.78 → 14.27 → 14.21     monotone, −21 %

I quoted `penteParMin`, which describes the **sustained** phase, and concluded
about the **generation** phase. Different phases of the same file. The M1 Pro's
own repetitions fall 1.7 % over five, and `pro-calme` not at all.

So there is one intra-pass decay among the four and it is the M5's, in the run
whose median load is 7.02. The thermal hypothesis is not supported, and it is not
dismissed either: it is confounded with external load, and these files do not
separate them.

## Withdrawn 3 — "the M5 does not repeat"

Within a single pass the M5 repeats better than almost anything here:

    banc-37de6cfe   24.40 · 24.67 · 24.51 · 24.73 · 24.79     under 2 % spread

My 14.78 and 24.67 are repetition 3 of one file and repetition 2 of another, at
median loads of 7.02 and 2 — a factor of 3.5. **That is a load test, not a
repeatability test**, and I presented it as the latter.

---

## What survives

**Repeatability before ranking** — but for the other session's reason, not mine.
Not because the M5 failed a repeatability test, but because **it was never played
twice under the same conditions**. The M1 Pro was: 23.07 at median load 3.01 and
22.94 at 3.48, one per cent apart. It is the only machine here whose repeatability
is demonstrated.

**Two measured candidate causes, neither tested.** The M5 has 4 performance cores
against the M1 Pro's 8, recorded in `hote`. And this M5 carries thirty times the
swapouts — 29.8 million against 0.97 — with one pass starting at 69 MB free on a
16 GiB machine. The second was confirmed on the live machine afterwards: 465 MB
free, 4.19 GB swapped, and three fresh passes refused by their own 1 GB threshold
at 434, 435 and 434 MB even after every session went quiet. **The system does not
return pages because a process stops asking.**

**The dropout does not carry the gap.** Keeping `pro-calme`'s 7.36 tok/s point
drops the M1 Pro from 23.07 to 21.39, still far above 15. And `banc-37de6cfe`
dropped a whole request, 21 of 22, so both machines have exclusions.

**Load as a queue length** remains right in general — a slower machine doing
identical work reports a higher load — and it is now the point that matters
rather than a caveat, since the two M5 passes differ by 3.5× in exactly that
quantity.

## What this cost, and what it is worth

A refutation with three wrong points, published to the session that asked for it.
It also produced the corrections: the shared-name defect, the intra-pass decay,
and the load-versus-repeatability confusion were all found by someone reading my
refutation as carefully as I read their summary.

The asymmetry worth keeping: **the summary I was given was accurate, and my
reading of the files was not.** "Read the files, not the summary" was the right
instinct and it is not sufficient — a file read with a truncated view is a summary
one has written oneself, without noticing.
