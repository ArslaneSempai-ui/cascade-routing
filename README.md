# Where should the next euro go?

Four tiers — rules, a small model, a large one, a human — measured on held-out data, then
routed under a budget. The answer is rarely "buy the bigger model", and this says why.

```
npm run measure    # measure each tier once, then freeze the profile
npm run optimise   # the routing, and the price of the next improvement
npm run failures   # what it gets wrong, and what kind of wrong
npm run figures    # regenerate every number on this page
npm test
```

Everything runs locally. No API key, nothing leaves the machine, and anyone who clones
this reproduces the numbers below.

---

## The first measurement was worthless, and that is the point

The rules scored **100 % on all five fields**. Not a result — I had written the templates,
then written the regexes against those templates. I was marking my own homework, which is
the exact error I had forbidden in writing two projects earlier.

The corpus is now split: the rules were developed on one set of phrasings and are measured
on another they never saw. Measured honestly, they collapse.

<!-- figures:extraction -->
| Tier | name | birth | document | country | address | Latency |
|---|---|---|---|---|---|---|
| `rules` | 0.0 % | 100.0 % | 83.3 % | 100.0 % | 0.0 % | 0.0 ms |
| `small` | 49.2 % | 100.0 % | 62.5 % | 100.0 % | 42.5 % | 20.7 ms |
| `large` | 96.7 % | 100.0 % | 67.5 % | 100.0 % | 38.3 % | 36.1 ms |
<!-- /figures:extraction -->

Two things fall out of that table, and neither is guessable:

On the address, **the large model is worse than the small one** while costing eight times
as much. Paying more degrades the result. And on the identity number, **the free regex
beats both models** — 83 % against 68 % and 63 %, for nothing.

An earlier version of this page said something stronger and wrong: that the small model
"cannot read an identity number at all — 0 %, not a low score". That 0 % was my scorer,
not the model. It was returning `IT - 5560 - K` where the truth was `IT-5560-K`, and I was
counting a tokeniser's spaces as a failure to find the field — despite a comment in that
very function saying formatting must not be measured. The failure gallery below surfaced
it on its first run; the real figure is 63 %, and the date field went from 52 % to 100 %
by the same correction.

The second chain, classifying alert narratives, is where the keyword collapse is starkest:

<!-- figures:classification -->
| Tier | Accuracy | 95 % interval | Latency |
|---|---|---|---|
| `rules` | 24.2 % | [17–33] | 0.01 ms |
| `small` | 67.5 % | [59–75] | 3.06 ms |
| `large` | 44.2 % | [36–53] | 7.84 ms |
<!-- /figures:classification -->

Those keywords scored **100 %** against the templates they were written from. On
narratives phrased by someone else, three quarters of that performance was never there.

---

## The routing, field by field

<!-- figures:routing -->
| Field | Tier chosen | Accuracy | Cost |
|---|---|---|---|
| name | `large` | 96.7 % | €160 |
| birth | `rules` | 100.0 % | €0 |
| document | `rules` | 83.3 % | €0 |
| country | `rules` | 100.0 % | €0 |
| address | `small` | 42.5 % | €20 |
| **total** |  | **84.5 %** | **€180** |
<!-- /figures:routing -->

<!-- figures:shadow -->
Budget used: **€180 of €4,000** — 4.5 %. The constraint **does not bind**.

The next real gain is **+8.5 points of accuracy**, it costs **€58,692 more** — 327× current spend — and it buys exactly one field: `address`.
<!-- /figures:shadow -->

That last sentence is the one worth carrying into a budget meeting. The instinct in the
room is "we need a bigger model" or "we need more budget". The measurement says the money
is not the constraint — no available tier can read an address, and the only thing that
fixes it costs a step, not a slope.

**The two chains want opposite things.** Chain A puts three fields on free rules and needs
the large model exactly once. Chain B finds rules useless and the *small* model better
than the large one. Any advice that does not begin with measuring your own chain is
selling you someone else's.

---

## What it gets wrong

Every tool in this set reported an aggregate accuracy and not one failure. That is the
wrong way round: a percentage is a claim you take on trust, while a named input with the
model's actual output beside the expected one is something you can check.

<!-- figures:gallery -->
552 failures across the machine tiers, grouped by what actually went wrong:

| Failures | Tier · field · what kind of wrong |
|---|---|
| 120 | rules · name · empty |
| 97 | rules · address · empty |
| 72 | large · address · fragment |
| 39 | small · name · wrong span |
| 38 | small · address · wrong span |
| 27 | large · document · over-long |

```
rules · name · empty   [D-0001]
  text      Marcus Ferreira — dob 21 October 1961 — doc no FR-1856-M — Portugal — lives 106 Odos Ermou, Rotterdam (updated by branch
  expected  "Marcus Ferreira"
  got       ""
```

```
rules · document · empty   [D-0008]
  text      re Viktor Vasquez / Italy — address 125 rue Victor Hugo, Lyon — idIT-2390-X — born 17 April 1968 — file opened pending r
  expected  "IT-2390-X"
  got       ""
```

```
rules · address · empty   [D-0001]
  text      Marcus Ferreira — dob 21 October 1961 — doc no FR-1856-M — Portugal — lives 106 Odos Ermou, Rotterdam (updated by branch
  expected  "106 Odos Ermou, Rotterdam"
  got       ""
```

```
small · name · over-long   [D-0002]
  text      KYC REVIEW ⏎ Subject ......... Leila Haddad ⏎ Birth ........... 10/07/1987 ⏎ Document ........ IT-5560-K ⏎ Citizenship .
  expected  "Leila Haddad"
  got       "Leila Haddad Birth........... 10 / 07 / 1987 Document........ IT - 5560 - K Citizenship..... Netherlands Postal"
```

```
small · document · fragment   [D-0002]
  text      KYC REVIEW ⏎ Subject ......... Leila Haddad ⏎ Birth ........... 10/07/1987 ⏎ Document ........ IT-5560-K ⏎ Citizenship .
  expected  "IT-5560-K"
  got       "5560"
```
<!-- /figures:gallery -->

Nothing here is curated for flattery. The gallery takes the first failure of each
tier-and-field pair, in order, and shows what came back.

---

## Measured, assumed, chosen

The separation is the most important thing in this repository.

**Measured** — accuracy and latency for the three machine tiers, run on held-out data and
frozen to `data/profiles.json`. Nothing else goes in that file.

**Assumed** — human accuracy sits at 85 %, below certainty, because an analyst on their
fortieth alert of the day is not perfect. It is *not* measurable here: there are no humans
in this repository. An earlier version had the human tier return ground truth, which made
it infallible by construction — an optimiser that believes that routes everything to
humans, and the conclusion goes wrong in the direction that costs the most.

**Assumed** — every price. What a model call costs depends on who hosts it; what a minute
of analyst time costs depends on the country. Both are editable, and mixing them into the
measurement file would pass a tariff off as a fact.

**Chosen** — volume and budget. Someone decided those.

---

## How it's built

```
src/
  corpus.ts      the two case sets, split into training and held-out halves
  tiers.ts       four tiers per chain: rules, a small model, a large one, a human
  measure.ts     measure once, freeze the profile
  assumptions.ts everything that is not measured, and why it cannot be
  optimise.ts    exhaustive routing under budget, and the price of the next step
  failures.ts    what it gets wrong, classified by what kind of wrong
  interval.ts    Wilson intervals — a rate without its sample size is not a measurement
  figures.ts     these tables, generated from the code rather than typed
```

Node with native TypeScript, no build step. `distilbert-squad` and `roberta-base-squad2`
for extraction, `all-MiniLM-L6-v2` and `multilingual-e5-small` for classification, all
local through `@huggingface/transformers`.

**The routing is exhaustive, not heuristic.** Five fields and four tiers is 1,024
combinations, which is instant — and it guarantees the optimum, which no heuristic does.

**The shadow price measures the step, not the slope.** A first version relaxed the budget
by 10 % and concluded "the next euro buys nothing" — true, and useless. The next gain does
not cost 10 % more; it costs an entire tier.

---

## What it doesn't do

- **No real cost data.** Latency is measured; prices are assumed and editable. Anyone
  quoting you a cost-per-thousand without your traffic profile is quoting someone else's.
- **No streaming, no batching, no caching.** All three change the economics substantially
  and none is modelled here.
- **Synthetic corpora.** Held-out, seeded and reproducible, but written by me. On your
  documents every figure needs re-measuring — which is the first finding of this whole set
  of tools, and the reason the measurement harness ships with it.
- **No human in the loop actually in the loop.** The human tier is a price and an
  assumption, not a queue.

---

Part of a set: [document search that refuses when it doesn't
know](https://github.com/ArslaneSempai-ui/compliance-document-search), [an onboarding
agent that escalates when it isn't
confident](https://github.com/ArslaneSempai-ui/kyc-triage-agent), [a bench that says
whether either still works](https://github.com/ArslaneSempai-ui/regression-bench),
[what a detection threshold costs](https://github.com/ArslaneSempai-ui/alert-triage-economics),
and this — where the next euro should go.

**Arslane Chaouche Ramdane** — six years in AML/KYC and financial crime operations,
moving into AI transformation work.
