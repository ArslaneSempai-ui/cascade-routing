# Where should the next dollar go?

Four tiers — rules, a small model, a large one, a human — measured on held-out data, then
routed under a budget. The answer is rarely "buy the bigger model", and this says why.

<!-- figures:finding -->
**The finding.** Routing every field to the same tier is the default and it is wrong. Measured per field, 3 of the 5 fields are carried by regexes at **zero cost and up to 100 % accuracy**, and the money is worth spending on exactly the ones that need it. Total: **94.4 % for $201** of a $4,000 budget — the budget does not bind. No available budget buys a better routing. Measured on 1000 and 120 held-out cases depending on the tier — the tables carry each figure's own `n`.
<!-- /figures:finding -->

**[Try it in your browser →](https://arslanesempai-ui.github.io/cascade-routing/)** — take a
cell to send a field to another tier and read what your routing costs. No model is called:
the accuracy of each tier was measured once on held-out records and frozen, and the page
replays the arithmetic on those measurements. Measuring them yourself is `npm run measure`,
about two minutes.

![Taking cells to move a field from one tier to another](images/routage.gif)

<!-- figures:commandes -->
| Command | What it does, in the order that makes sense |
|---|---|
| `npm run test` | types, figures and the suite — start here, it needs nothing downloaded |
| `npm run measure` | measure the encoder tiers and freeze the profile (1.26 GB on the first run) |
| `npm run optimise` | the routing, and what the next improvement would cost |
| `npm run failures` | every case it gets wrong, with its input and its output |
| `npm run sensitivity` | which assumptions decide the answer, and which do not |
| `npm run figures` | regenerate every table on this page from the frozen profile |
| `npm run landing` | regenerate landing.json — the figures a published page reads, with their provenance |
| `npm run dossier` | the validation file a reviewer signs |
| `npm run start` | the screen, on localhost:4670 |
| `npm run measure:yours` | your own cases, from a CSV — nothing leaves your machine |
| `npm run benchmark` | the same measurement on a public labelled dataset |
| `npm run intake` | turn a filled-in questionnaire into the assumptions a run uses |
| `npm run egress` | watch the network while a measurement runs, and record what it sees |
| `npm run fuite` | what the prompt owes to the half it was tuned against (needs Ollama) |
| `npm run pages` | build docs/ and verify the published screen — required before publishing: docs/ carries a compiled copy of the code and goes stale silently |
| `npm run captures` | re-record the images on this page |
<!-- /figures:commandes -->

```bash
npm test           # types, README figures, and <!--p:portfolio.parDepot.cascade-->54<!--/p--> tests
```

Everything runs locally. No API key, nothing leaves the machine, and anyone who clones this
reproduces the numbers below.

**What it actually costs you to reproduce it:** about 400 MB of npm packages, then **1.26 GB
of model weights** on the first `npm run measure` — 474 MB for roberta-base-squad2, 448 MB for
multilingual-e5-small, 249 MB for distilbert, 86 MB for MiniLM. On a 50 Mbit line that is
three and a half minutes of download before anything is measured, and the encoder measurement
itself takes a few minutes more. The generative ladder is a further eight gigabytes and is
optional for exactly that reason.

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
| `rules` | 0.0 % | 100.0 % | 79.7 % | 100.0 % | 0.0 % | 0.0 ms |
| `small` | 46.6 % | 97.9 % | 57.7 % | 100.0 % | 43.0 % | 32.7 ms |
| `large` | 96.6 % | 100.0 % | 64.4 % | 100.0 % | 32.8 % | 64.9 ms |
| `gen-0.6b` | 80.8 % | 87.5 % | 70.0 % | 83.3 % | 75.0 % | 375.4 ms |
| `gen-4b` | 89.2 % | 99.2 % | 79.2 % | 100.0 % | 95.8 % | 1208.3 ms |
| `gen-8b` | 91.7 % | 100.0 % | 83.3 % | 100.0 % | 82.5 % | 1583.9 ms |
<!-- /figures:extraction -->

Two things fall out of that table, and neither is guessable:

<!-- figures:deuxfaits -->
On the address, **the large model is worse than the small one** — 32.8 % against 43.0 % — while costing several times as much. And on the identity number, **the free regex beats 4 of the 5 model tiers**: 79.7 % against 57.7 %, 64.4 %, 70.0 %, 79.2 %, for nothing.
<!-- /figures:deuxfaits -->

The second chain, classifying alert narratives, is where the keyword collapse is starkest:

<!-- figures:classification -->
| Tier | Accuracy | 95 % interval | Latency |
|---|---|---|---|
| `rules` | 21.3 % | [19–24] | 0.00 ms |
| `small` | 69.2 % | [66–72] | 5.34 ms |
| `large` | 40.5 % | [37–44] | 12.51 ms |
| `gen-0.6b` | 61.7 % | [53–70] | 437.07 ms |
| `gen-4b` | 94.2 % | [88–97] | 958.10 ms |
| `gen-8b` | 100.0 % | [97–100] | 1276.98 ms |
<!-- /figures:classification -->

Those keywords scored **100 %** against the templates they were written from. On
narratives phrased by someone else, three quarters of that performance was never there.

---

## The second ladder: real generative models

The fair objection to everything above is that these are encoder models — an extractive
question-answering head and a pair of embedding models — and that measuring them says nothing
about routing between generative ones. So the same corpus, the same held-out split and the
same scorer were run against a local Qwen3 ladder at 0.6B, 4B and 8B parameters.

<!-- figures:echelles -->
| Field | `rules` | `small` | `large` | `gen-0.6b` | `gen-4b` | `gen-8b` | Best |
|---|---|---|---|---|---|---|---|
| `name` | 0.0 % | 46.6 % | **96.6 %** | 80.8 % | 89.2 % | 91.7 % | `large` |
| `birth` | **100.0 %** | 97.9 % | 100.0 % | 87.5 % | 99.2 % | 100.0 % | `rules` |
| `document` | 79.7 % | 57.7 % | 64.4 % | 70.0 % | 79.2 % | **83.3 %** | `gen-8b` |
| `country` | **100.0 %** | 100.0 % | 100.0 % | 83.3 % | 100.0 % | 100.0 % | `rules` |
| `address` | 0.0 % | 43.0 % | 32.8 % | 75.0 % | **95.8 %** | 82.5 % | `gen-4b` |
<!-- /figures:echelles -->

**No family wins everywhere, and that is the entire finding.** A specialised extractive head
keeps one field, free regexes keep three, and a generative model takes the one nothing else
could read. The best assignment crosses all three families at once — which is precisely what
routing per document prevents you from discovering.

The ladders also disagree with themselves. On one chain a bigger generative model is worse
than a smaller one; on the other the same three models rank strictly by size. Same models,
same machine, same run, opposite verdicts depending on the task.

**It stays optional.** The encoder ladder is what `npm run measure` measures: a few tens of
megabytes, no server, and anyone who clones this reproduces those numbers in two minutes with
no API key. The generative ladder needs Ollama running and about eight gigabytes of models,
so it lives behind `npm run measure -- --llm`, and a run without the flag leaves its frozen
figures untouched rather than deleting them.

## The prompt was tuned on the test set, and that is my mistake

The generative tiers do not work at all without a worked example in the prompt: without one
the model answers with the field's own name, or with the whole document, and scores zero. The
example that fixed it was arrived at by running the measurement on the **held-out** half,
reading 0 %, changing the prompt, and running it again on the same half.

That is precisely the leak the split exists to prevent — the same error as writing regexes
against your own templates, which this repository already made once and documents above. It
was made again two months later, on a different object, by the person who had written the
defence.

**Two things follow, and both are in the code rather than in this paragraph.** The corpus now
has three halves, not two: `training` for writing rules, `dev` for tuning prompts, `heldout`
read once and deciding nothing but the published figure. A test fails if any two of them share
a phrasing.

And the size of the leak is measured rather than apologised for:

<!-- figures:fuite -->
Not measured yet — run `npm run fuite`. Until it is, the generative figures on this page carry a prompt tuned against the half they are scored on, and are optimistic by an unknown amount.
<!-- /figures:fuite -->

The number that matters is the gap. A prompt that transfers to phrasings it was never tuned
against costs little; one that does not was fitted to the test set, and the published accuracy
was borrowed rather than earned.

## What this sample cannot tell apart

A table of percentages invites the reader to rank them, and on a hundred and twenty cases a
good many of those rankings are noise. These pairs are **not distinguishable** here:

<!-- figures:egalites -->
| Field | Tier | Rate | Tier | Rate |
|---|---|---|---|---|
| `name` | `large` | 96.6 % [95–98], n=1000 | `gen-8b` | 91.7 % [85–95], n=120 |
| `name` | `gen-0.6b` | 80.8 % [73–87], n=120 | `gen-4b` | 89.2 % [82–94], n=120 |
| `name` | `gen-0.6b` | 80.8 % [73–87], n=120 | `gen-8b` | 91.7 % [85–95], n=120 |
| `name` | `gen-4b` | 89.2 % [82–94], n=120 | `gen-8b` | 91.7 % [85–95], n=120 |
| `birth` | `rules` | 100.0 % [100–100], n=1000 | `gen-4b` | 99.2 % [95–100], n=120 |
| `birth` | `small` | 97.9 % [97–99], n=1000 | `gen-4b` | 99.2 % [95–100], n=120 |
| `birth` | `small` | 97.9 % [97–99], n=1000 | `gen-8b` | 100.0 % [97–100], n=120 |
| `birth` | `large` | 100.0 % [100–100], n=1000 | `gen-4b` | 99.2 % [95–100], n=120 |
<!-- /figures:egalites -->

This section exists because it caught me. An earlier headline for this project claimed the
large model was worse than the small one on the address field. It is — by 4.2 points, with
intervals that overlap almost completely. The direction was right and the claim was not
supported, and I would have published it.

The optimiser now applies the same rule rather than merely reporting it: **where two tiers
cannot be told apart, it takes the cheaper one.** A difference inside the interval is not a
difference worth paying for, and it is the first thing anyone validating a model change will
ask about.

## The budget in seconds

Latency used to be recorded and play no part in the routing, which meant the optimiser would
happily send a real-time field to the slowest tier available. On the encoder ladder that was
nearly harmless — five fields summed to about fifty milliseconds. A generative tier costs
around a second per field, so the constraint stops being decorative.

<!-- figures:latence -->
| Ceiling per document | Accuracy | Cost | Actual | Routing |
|---|---|---|---|---|
| 2000 ms | 94.4 % | $201 | 1287.3 ms | `large` `rules` `rules` `rules` `gen-4b` |
| 500 ms | 83.9 % | $180 | 98.0 ms | `large` `rules` `rules` `rules` `small` |
| 50 ms | 65.3 % | $20 | 32.2 ms | `small` `rules` `rules` `rules` `rules` |
| 30 ms | 55.9 % | $0 | 0.0 ms | `rules` `rules` `rules` `rules` `rules` |

**What the promise costs.** Lift the ceiling entirely and the cheapest routing that is statistically indistinguishable in accuracy costs $91 instead of $201 — it just takes 2733 ms per document. **Your latency promise is worth $110**, and the money budget never binds at all. That is the shadow price nobody prices.
<!-- /figures:latence -->

Read it as the price list for a service level agreement: each row is what a tighter promise
costs in accuracy. A routing can be affordable and too slow, or fast and unaffordable, and
the two budgets bind independently.

---

## Against doing no work at all

A percentage without its baseline invites the one question you cannot answer. The keyword
classifier scores what it scores — is that bad? It was unanswerable until the trivial baseline was
computed.

<!-- figures:baselines -->
|  | Accuracy | Verdict |
|---|---|---|
| always the most common label | 25.0 % | *answers "fractionnement" every time, ignoring the input entirely* |
| uniform guess | 20.0 % | *picks one of 5 labels at random* |
| `rules` | 21.3 % | **loses to "always the most common label"** by 3.7 points |
| `small` | 69.2 % | beats "always the most common label" by 44.2 points |
| `large` | 40.5 % | beats "always the most common label" by 15.5 points |
| `gen-0.6b` | 61.7 % | beats "always the most common label" by 36.7 points |
| `gen-4b` | 94.2 % | beats "always the most common label" by 69.2 points |
| `gen-8b` | 100.0 % | beats "always the most common label" by 75.0 points |
<!-- /figures:baselines -->

Hand-written keyword rules, refined over an afternoon, carry no information that a
constant does not. That is not a claim I would have made from the accuracy alone, and the
baseline took four minutes to write.

---

## The routing, field by field

<!-- figures:routing -->
| Field | Tier chosen | Accuracy | Cost |
|---|---|---|---|
| name | `large` | 96.6 % | $160 |
| birth | `rules` | 100.0 % | $0 |
| document | `rules` | 79.7 % | $0 |
| country | `rules` | 100.0 % | $0 |
| address | `gen-4b` | 95.8 % | $40 |
| **total** |  | **94.4 %** | **$201** |
<!-- /figures:routing -->

<!-- figures:shadow -->
No budget buys better: the ceiling is in the tiers available.
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

## Measured on somebody else's data

Every other figure on this page comes from a corpus I wrote. That is the fair objection, and
a held-out split does not answer it: it defends against marking your own homework, it does not
turn invented documents into real ones.

So the same measurement — same scorer, same intervals, same trivial baselines — runs on a
public labelled set that somebody else published, with their labels and their oddities.

<!-- figures:public -->
Not run yet — `npm run benchmark`.
<!-- /figures:public -->

The dataset is not vendored here; its address, its checksum and the raw record are, which is
what a stranger needs to get the same numbers or find out why not. `npm run benchmark`
reproduces it.

## What this tool got wrong

Every measurement page shows what the system under test fails at. Almost none shows what the
**measurement** failed at — and that is the only evidence a figure was ever subjected to
anything. A validator can audit a history; they cannot audit a promise.

<!-- figures:retractations -->
| When | What was claimed | What was true | What caught it |
|---|---|---|---|
| 2026-06-14 | Les règles écrites à la main atteignent 100 % sur les cinq champs. | Elles atteignent 0 % sur deux d'entre eux. Les expressions régulières avaient été écrites contre les gabarits qui servaient à les noter. | Une relecture, avant publication. |
| 2026-07-02 | Le petit modèle ne sait pas lire un numéro d'identité — 0 %, pas un score faible. | 63 %. L'évaluateur comptait « IT - 5560 - K » comme un échec face à « IT-5560-K » : il mesurait le formatage, pas le contenu. | La galerie d'échecs, à sa première exécution. |
| 2026-08-19 | Le grand modèle est pire que le petit sur deux champs sur cinq. | Sur un seul champ — et sur 120 cas l'écart était de 4,2 points avec des intervalles qui se recouvraient presque entièrement. L'affirmation n'était pas seulement mal comptée, elle n'était pas soutenue. | Le générateur du dossier de validation, dont la section « ce que l'échantillon ne tranche pas » listait la paire. |
| 2026-08-19 | Sur l'échelle générative, plus gros est pire sur une tâche et meilleur sur l'autre. | La première moitié tient — 82,5 % contre 95,8 % sur l'adresse, écart réel. La seconde non : entre 4B et 8B, la classification ne bouge pas de façon mesurable. | Le test de significativité, appliqué aux quatre affirmations d'un coup. |
| 2026-08-19 | 79,7 % — non : « 83 % contre 68 % et 63 % » sur le numéro de document. | 79,7 % contre 64,4 % et 57,7 %. Les trois chiffres étaient justes le jour où ils ont été écrits et sont devenus faux à la remesure à mille cas, dans une phrase que rien ne régénérait. | Un contrôle écrit ce jour-là, qui refuse tout nombre tapé à la main dans la prose. |
| 2026-08-19 | La latence est mesurée mais ne joue aucun rôle dans le routage. | C'était vrai le matin et faux le soir : un budget en secondes existe désormais et c'est lui qui contraint, pas l'argent. La page se contredisait d'une section à l'autre. | L'audit des affirmations en gras contre les tests qui les tiennent. |
| 2026-08-19 | Le défaut de débordement touche les neuf démos publiées. | Une seule. Les huit autres portaient la même feuille de style et ne débordaient pas : il fallait aussi un parent sans rembourrage. | La vérification de l'affirmation, après l'avoir énoncée. |

6 of these 7 are now held by a named test, so the same mistake fails the build rather than reaching a reader.
<!-- /figures:retractations -->

Each line names what caught it, because that is the part worth copying. Two were caught by a
person re-reading, and the rest by a check that now runs on every commit — which is the whole
argument for turning a lesson into a test rather than a note.

## Where every number comes from

The separation is the most important thing in this repository, and it used to be a
paragraph I wrote by hand — which is the one form it must not take. A page that classifies
its own figures, typed out, goes stale the first time somebody adds one, and it goes stale
in the flattering direction: the figure you forget to declare is the one you were least
comfortable declaring. It is generated from the code now, and a test fails if anything the
tool runs on is missing from it.

<!-- figures:provenance -->
**4 measured**, **11 assumed**, **5 chosen**. What each kind means, and what you are entitled to ask of it:

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
| assumed | `machineHourlyCost` | what an hour of the machine running a local model costs you | a local model has no tariff — it occupies a box, and your infrastructure bill knows what that costs |
| assumed | `volume` | items to process over the period | your scenario, not mine |
| assumed | `budget` | money available over the period | your scenario; it decides which tiers are reachable at all |
| assumed | `latencyBudgetMs` | milliseconds allowed for one whole document, end to end | your service level agreement knows this exactly; it binds independently of the money |
| chosen | `CONFIANCE` | the confidence level every interval and every tie is decided at | 95 % because that is wilson()'s default, not because anyone weighed it — and it decides which findings survive |
| chosen | `corpus` | the synthetic documents the models are scored on, and their ground truth | the first measurement scored rules at 100 % because I wrote the regexes against my own templates |
| chosen | `TRAINING / HELDOUT` | which phrasings the rules may see and which they are scored on | the defence against marking my own homework; a test fails if the two share a shape |
| chosen | `FIELDS` | the 5 fields extracted from each document | a real onboarding form has more, and more of them ambiguous |
| chosen | `TIERS` | the 7 tiers a field may be routed to | more tiers make the routing finer and the optimisation no harder |
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

**Not "the accuracy printed above is the accuracy you would get."** It is the accuracy on a corpus I wrote,
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

**A measurement you record and never use is a measurement you do not have.** Latency was
recorded from the first version and played no part in the routing for months: the optimiser
would happily send a real-time field to the slowest tier, and nothing said so. It took a
generative tier — a second per field instead of twenty milliseconds — to make the omission
visible. There is a budget in seconds beside the budget in dollars now, and it turns out to
be the one that binds. The lesson is not about latency: it is that a column in a data file
proves nothing until a decision reads it.

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
