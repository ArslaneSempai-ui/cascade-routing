# Hard corpus — results

Measured 21 August 2026, commit at the head of `main`, machine Apple M5 / 17 GB,
external load 2.34 on ten cores before the pass. Scoring rule committed before
measurement: **correct = any defensible reading declared before measurement**.
For twenty-one of the hundred and sixty-four declared fields the declared answer
is silence, where a blank is correct and a value is wrong.

44 cases: 18 malformed documents, 12 non-Latin scripts, 14 ambiguous. Only the 30
tabular cases declare all five fields; the 14 ambiguous cases declare one each.

## Fields, and whole documents

| tier | fields correct | whole documents | over-refusals | over-answers |
|---|---|---|---|---|
| `rules` | 18.3 % | 0/30 | 133 | 0 |
| `small` | 15.9 % | 0/30 | 0 | 21 |
| `large` | 28.0 % | 0/30 | 14 | 21 |
| `gen-0.6b` | 50.6 % | 0/30 | 0 | 21 |
| `gen-4b` | 57.9 % | **1/30** | 0 | 21 |
| `gen-8b` | 67.1 % | **1/30** | 27 | 8 |

On the clean corpus `gen-4b` and `gen-8b` sit at 92.7 % and 91.5 %. Here the
field rate falls to 58 and 67, and **the document rate falls to one in thirty**.
Four of six tiers complete nothing at all.

The fall is the result, not an anomaly. A tool that misses nothing on perfect
documents has not been measured.

## The two whole documents are not the same document

`gen-4b` completes `documents-malformes#R3`. `gen-8b` completes
`documents-malformes#M3`. **The intersection is empty.**

The oracle — the best of all six tiers for each document, chosen with hindsight,
therefore impossible — completes 2 of 30 against 1 for the best single tier.

**No rate is quoted from this.** One document per tier is far below this
repository's own floor of twenty, under which a rate is not published. Two
disjoint successes out of thirty is two coin flips, not a finding about routing.
What it does establish is the ceiling: a per-document router, given perfect
foresight, would complete two documents where the best fixed tier completes one.

## Paired, on the same 164 fields

| pair | result |
|---|---|
| `gen-4b` vs `gen-8b` | 2–17, **separated** |
| `gen-0.6b` vs `gen-4b` | 5–17, separated |
| `rules` vs `large` | 21–37, separated |
| `rules` vs `small` | 22–18, inside the noise |

`gen-4b` and `gen-8b` are **indistinguishable on the clean corpus** and separated
here. The routing recommends `gen-4b` because the two score alike and one is
cheaper; that equality belongs to a hundred and twenty clean synthetic documents.
Indistinguishability is a property of the tier, the formulation and the corpus
together — never of the tier alone.

## Silence

Twenty-one fields have silence as their declared answer. `small`, `large`,
`gen-0.6b` and `gen-4b` answer all twenty-one with an invented value. `gen-8b`
refuses thirteen of them, and is the only generative tier that ever over-refuses.
`rules` never invents once in 164 fields and finds nothing 133 times.

Two tiers at the same accuracy are not the same product depending on which of
these they do.

## Disagreement, which is not error

`gen-4b` and `gen-8b` return different values on 3 of the 93 fields where both are
correct: `FRENCH REPUBLIC` against `FRANCE`, `REPUBLIC OF BULGARIA` against
`BULGARIA`, `Jordan` against `المملكة الأردنية الهاشمية`. Both readings declared
correct before measurement. Two different files for the client, and no accuracy
figure contains it.

## What was wrong before this file

The first version of these per-document numbers said twelve whole documents per
tier, eleven of them shared. That counted a one-field ambiguous case as a whole
document whenever its single field was correct. The real figures are one per
tier, sharing none. The error was twelvefold and the conclusion drawn from it —
that the two tiers save the same documents — was the opposite of the truth.
