# Where should the next dollar go?

Four tiers — rules, a small model, a large one, a human — measured on held-out data, then
routed under a budget. The answer is rarely "buy the bigger model", and this says why.

<!-- figures:finding -->
**The finding.** Routing every field to the same tier is the default and it is wrong. Measured per field, 3 of the 5 fields are carried by regexes at **zero cost and up to 100 % accuracy**, and the money is worth spending on exactly the ones that need it. Total: **84.5 % for $180** of a $4,000 budget — the budget does not bind. The next real gain costs 327× current spend and buys one field.
<!-- /figures:finding -->

*No hosted demo for this one: it measures real models, which means downloading them. The
other three run in your browser — this one runs on your machine, and `npm run measure`
takes about two minutes.*

```bash
npm run measure    # measure each tier once, then freeze the profile
npm run optimise   # the routing, and the price of the next improvement
npm run failures   # what it gets wrong, and what kind of wrong
npm run sensitivity # which assumptions decide the answer, and which don't
npm test           # types, README figures, and 14 tests
```

Everything runs locally. No API key, nothing leaves the machine, and anyone who clones this
reproduces the numbers below.

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
| `small` | 49.2 % | 100.0 % | 62.5 % | 100.0 % | 42.5 % | 20.0 ms |
| `large` | 96.7 % | 100.0 % | 67.5 % | 100.0 % | 38.3 % | 35.4 ms |
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
| `small` | 67.5 % | [59–75] | 3.10 ms |
| `large` | 44.2 % | [36–53] | 6.86 ms |
<!-- /figures:classification -->

Those keywords scored **100 %** against the templates they were written from. On
narratives phrased by someone else, three quarters of that performance was never there.

---

## Against doing no work at all

A percentage without its baseline invites the one question you cannot answer. The keyword
classifier scores 24.2 % — is that bad? It was unanswerable until the trivial baseline was
computed.

<!-- figures:baselines -->
|  | Accuracy | Verdict |
|---|---|---|
| always the most common label | 25.0 % | *answers "fractionnement" every time, ignoring the input entirely* |
| uniform guess | 20.0 % | *picks one of 5 labels at random* |
| `rules` | 24.2 % | indistinguishable from "always the most common label" on 120 cases — this measurement does not show the system doing anything |
| `small` | 67.5 % | beats "always the most common label" by 42.5 points |
| `large` | 44.2 % | beats "always the most common label" by 19.2 points |
<!-- /figures:baselines -->

Hand-written keyword rules, refined over an afternoon, carry no information that a
constant does not. That is not a claim I would have made from the accuracy alone, and the
baseline took four minutes to write.

---

## The routing, field by field

<!-- figures:routing -->
| Field | Tier chosen | Accuracy | Cost |
|---|---|---|---|
| name | `large` | 96.7 % | $160 |
| birth | `rules` | 100.0 % | $0 |
| document | `rules` | 83.3 % | $0 |
| country | `rules` | 100.0 % | $0 |
| address | `small` | 42.5 % | $20 |
| **total** |  | **84.5 %** | **$180** |
<!-- /figures:routing -->

<!-- figures:shadow -->
Budget used: **$180 of $4,000** — 4.5 %. The constraint **does not bind**.

The next real gain is **+8.5 points of accuracy**, it costs **$58,692 more** — 327× current spend — and it buys exactly one field: `address`.
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

## Where every number comes from

The separation is the most important thing in this repository, and it used to be a
paragraph I wrote by hand — which is the one form it must not take. A page that classifies
its own figures, typed out, goes stale the first time somebody adds one, and it goes stale
in the flattering direction: the figure you forget to declare is the one you were least
comfortable declaring. It is generated from the code now, and a test fails if anything the
tool runs on is missing from it.

<!-- figures:provenance -->
**4 measured**, **9 assumed**, **4 chosen**. What each kind means, and what you are entitled to ask of it:

- **measured** — running the code in this repository produces it. *run it yourself — the draws are seeded.*
- **assumed** — an input nobody here can know; yours to supply. *put your own figure in, and read the band around it.*
- **chosen** — my judgement and nothing else. *check whether the sweep says it decides anything.*

| Kind | Name | What it is | Note |
|---|---|---|---|
| measured | `profiles` | per-field accuracy and latency for each tier | real models pinned by revision, scored on a held-out split, on the chosen corpus below |
| measured | `routing` | the cheapest assignment of tiers to fields that fits the budget | exhaustive over all 1,024 combinations — no heuristic, nothing to tune |
| measured | `shadowPrice` | the smallest budget increase that actually buys a better routing | a step, not a slope: differentiating a staircase says the next euro buys nothing |
| measured | `REVISIONS` | the exact model revisions the figures were produced with | pinned, so a stranger reproduces the table rather than a different one |
| assumed | `humanAccuracy` | how often a human reviewing their fortieth file of the day gets it right | moved here from being infallible by construction, which made the human tier unbeatable |
| assumed | `humanSeconds` | seconds a human spends on one item | your own handling times |
| assumed | `analystAnnualCost` | loaded annual cost of an analyst | your finance team knows this exactly |
| assumed | `productiveHoursPerDay` | hours genuinely productive per day | never eight; weeks of work to establish |
| assumed | `workingDaysPerYear` | working days in your calendar | your HR calendar knows this exactly |
| assumed | `pricePerThousandSmall` | cost per thousand calls to the small model | your provider's price list, on your traffic |
| assumed | `pricePerThousandLarge` | cost per thousand calls to the large model | same, and it moves faster than any other figure here |
| assumed | `volume` | items to process over the period | your scenario, not mine |
| assumed | `budget` | money available over the period | your scenario; it decides which tiers are reachable at all |
| chosen | `corpus` | the synthetic documents the models are scored on, and their ground truth | the first measurement scored rules at 100 % because I wrote the regexes against my own templates |
| chosen | `TRAINING / HELDOUT` | which phrasings the rules may see and which they are scored on | the defence against marking my own homework; a test fails if the two share a shape |
| chosen | `FIELDS` | the 5 fields extracted from each document | a real onboarding form has more, and more of them ambiguous |
| chosen | `TIERS` | the 4 tiers a field may be routed to | more tiers make the routing finer and the optimisation no harder |
<!-- /figures:provenance -->

The load-bearing chosen thing is the corpus. The accuracies above are real measurements —
real models, pinned by revision, scored on a held-out split — taken on documents I wrote.
The split defends against the worst version of that problem, which this repository already
walked into once: the first measurement scored the rules at 100 % because I had written the
regexes against my own templates. A held-out split stops you marking your own homework. It
does not turn an invented corpus into documents a bank would send.

What survives is exact: **the method is the finding, the accuracies are illustration.**
That a cheap model carries some fields and not others, that its ceiling is a property of
the field rather than of the budget, that routing per field beats routing per document —
that holds for any corpus with this structure. That birth dates reach 100 % on the small
model holds for mine.

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

---

## What this does not let you conclude

**Not "small models are good enough."** Small models are good enough *for three of these
five fields*, and hopeless at the fourth. The finding is that the question has to be asked
per field, which is precisely what routing per document prevents you from discovering.

**Not "84.5 % is the accuracy you would get."** It is the accuracy on a corpus I wrote,
with a held-out split that defends against the worst version of that problem and does not
turn invented documents into real ones. The method travels; the number does not.

**Not "the budget does not matter."** It does not bind *here*, at this volume, with these
prices. Multiply the volume by fifty or drop the budget by a hundred and it binds
immediately — which the sensitivity sweep says explicitly rather than reporting the tiers
as insensitive.

**Not "the human tier is not worth it."** The human tier costs more than the entire budget
at this volume, so it is never selected and its quality never enters the calculation. That
is a statement about price, not about people, and the sweep reports it as priced out rather
than as irrelevant.

---

## What I would do differently

**Write the held-out split before the first measurement, not after it.** The first run
scored the rules at 100 % because I had written the regexes against my own templates. It
took a full rebuild of the corpus to fix, and thirty minutes of discipline up front would
have avoided it.

**Check the scorer before believing the scores.** 133 of 685 recorded failures were format
mismatches — `10 / 07 / 1987` against `10/07/1987`. Correcting the comparison moved one
field from 51.7 % to 100 % and retired a claim on this page. A scorer that measures
formatting is worse than no scorer, because it produces confident wrong numbers.

**Measure latency the same way as accuracy.** Latency is recorded but plays no part in the
routing, which means the optimiser will happily route a real-time field to the slowest
tier. A budget in seconds belongs beside the budget in dollars.

---

## What a reviewer can check without running anything

| Claim | Where it is checked |
|---|---|
| Every figure on this page | Generated from the frozen profile; `npm test` fails if the page drifts |
| The models | Pinned by exact revision, so a clone measures the same thing |
| The split | A test fails if training and held-out phrasings share a shape |
| Every assumption | Declared in the inventory and swept, with "priced out" told apart from "irrelevant" |
| The routing | Exhaustive over all 1,024 combinations — no heuristic, nothing tuned |
| Every failure | Published in full, by kind, rather than summarised into a rate |

---

**Arslane Chaouche Ramdane** — six years in AML/KYC and financial crime operations,
moving into AI transformation work.
