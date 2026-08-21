# What adding `qwen3:1.7b` as a tier would cost

**An estimate written before doing it**, so it can be checked against the actual
afterwards rather than remembered generously.

## The throughput number this rests on

Twelve extractions per model, same prompt, same documents, taken 21 August:

| model | median |
|---|---|
| `qwen3:0.6b` | 198 ms |
| `qwen3:1.7b` | **311 ms** |
| `qwen3:4b` | 606 ms |

**These are not published latencies and must not be quoted as any.** Twelve
samples, on a machine whose load was not controlled, taken to size a decision.
The repository's real latencies come from a measured pass on an idle machine and
are recorded per tier with the load they were taken under.

It does sit in the gap it was said to fill: roughly 1.6× the small model and half
the 4b.

## Machine time

| step | cost |
|---|---|
| held-out extraction pass, 120 cases × 5 fields | ~3 min |
| classification chain, 120 alerts | ~40 s |
| hard corpus, 164 fields | ~1 min |
| paired tests against every existing tier | **free** — a query over stored rows |
| **to have it as a measured tier** | **~5 minutes** |
| formulation sweep on dev, 5 × 5 × 120 (optional) | ~16 min |

The sweep is optional because the per-tier formulation result was refuted: no
formulation separates from its runner-up, and the repository uses `reference`
everywhere. Adding a tier does not revive that question.

## What it does not cost, and why

**No existing tier is re-measured.** Provenance is recorded per tier and `n` is
decoupled per tier, so the seven current tiers keep their numbers, their commits
and their loads untouched. Before that work — the same morning — adding an eighth
tier meant re-measuring everything, about forty minutes of GPU and a fresh set of
numbers to re-audit.

That is the whole return on the per-tier provenance work, and this is the first
time anything has claimed it.

## Code

Four declarations: the pinned tag and digest (`8f68893c685c`), the tier list, the
public generative list, the licence row. Nothing in the source hardcodes seven
tiers.

The optimiser enumerates every routing: 7⁵ = 16,807 becomes 8⁵ = 32,768, a factor
of 1.95. The decomposition is memoised, so the two price sweeps in the test suite
go from about 2.8 s each to roughly 5.5 s. Nothing else scales with tier count.

## What would make it worth it, and what would not

It is worth adding if it turns out **indistinguishable from `gen-4b` on some
fields while costing less**, because the routing would then change and the change
would be a result. It is not worth adding merely to have a fourth point on a
curve.

And the day's finding applies to it in advance: indistinguishability belongs to
the tier, the formulation and the corpus together. If `1.7b` is indistinguishable
from `4b` on the clean corpus, that says nothing about broken documents, where
`gen-4b` and `gen-8b` — indistinguishable on clean cases — separate 2–17.
