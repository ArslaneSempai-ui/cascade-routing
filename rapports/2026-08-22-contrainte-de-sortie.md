# What the output constraint buys

Measured 22 August 2026, two passes, three tiers, both arms, 20 field extractions
each. Token cap 4,000.

## The counts reproduce exactly. The durations do not.

| tier | arm | tokens, pass 1 | tokens, pass 2 | median duration gap |
|---|---|---|---|---|
| `gen-0.6b` | schema | 13 [8–18] | 13 [8–18] | 48 % |
| `gen-0.6b` | none | 8 [3–8] | 8 [3–8] | 60 % |
| `gen-4b` | schema | 16 [11–19] | 16 [11–19] | 36 % |
| `gen-4b` | none | 2,480 [398–4,000] | 2,480 [398–4,000] | 16 % |
| `gen-8b` | schema | 13 [8–16] | 13 [8–16] | 23 % |
| `gen-8b` | none | 8 [3–11] | 8 [3–11] | 20 % |

**Every count is identical to the digit across both passes. Every duration moved,
by 16 to 60 per cent**, on a machine that went from 343 MB free to 113 between
them.

That is the counted-versus-timed rule, demonstrated rather than asserted. A token
count is a property of the model's output and reproduces; a duration is a property
of the machine and does not. Two figures from the same twenty calls, minutes
apart, and only one of them survives being taken somewhere else.

**The durations here are not transportable and are marked so in the file.** The
machine was below the one-gigabyte floor at both passes.

## One tier in three does not stop without the constraint

`gen-0.6b` returns 8 tokens unconstrained, `gen-8b` returns 8. `gen-4b` returns a
median of **2,480**, and **5 of 20 calls hit the 4,000 cap**.

So the runaway is a property of one tier, not of unconstrained generation. Anyone
who does not use `gen-4b` gains nothing here — which is worth more to them than a
general claim would be.

**Correction to what I wrote an hour ago.** The pilot ran one call, saw 3,508
tokens with a natural stop, and I wrote that the cap does not bind at 4,000. It
binds on a quarter of the calls. So `gen-4b`'s unconstrained length is *still* not
fully observed: the median is real, the maximum is my cap again. One call is not a
pilot, and I made the same mistake the retracted figure was made of, one order of
magnitude further out.

## The constraint does not cost accuracy. It buys it.

| tier | with schema | without |
|---|---|---|
| `gen-0.6b` | 95 % | **20 %** |
| `gen-4b` | 85 % | **45 %** |
| `gen-8b` | 100 % | 100 % |

This answers the question asked two days ago and left open: constraining the
output does not trade accuracy for price. On two tiers of three it roughly doubles
or quadruples accuracy, and on the third it changes nothing.

**With the reservation that belongs beside it.** The unconstrained arm is read by
a prose extractor declared before the measurement — last `\boxed{}`, then last
quoted string, then what follows "Answer:", then the last non-empty line — and its
failures count against that arm by design. So the 20 % and 45 % mix *the model
answered differently* with *our reader could not find the answer*. No output was
empty, so the extractor always returned something; whether it returned the right
something is exactly what is being counted.

That choice is the honest direction of error: a chain whose output you cannot read
is no better, to whoever runs it, than one that answers wrongly.

## What is publishable, and what is not

**Publishable, because counted:** `gen-4b` emits a median of 2,480 tokens without
an output schema and 16 with it — a factor of 155 in what it produces. The other
two tiers stop on their own. Accuracy with the schema is equal or better on all
three.

**Not publishable:** any ratio of durations from this bench. The machine was under
memory pressure at both passes and the medians moved by up to 60 per cent between
them. The file says so per row rather than in a footnote.
