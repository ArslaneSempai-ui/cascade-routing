# Validation file — task-level model routing

Generated from the frozen measurement of `2026-08-20T10:40:28.826Z`, produced by commit `64bdacf`. Every figure below is
produced from that same file: this document cannot disagree with the tables elsewhere in
the repository, because it is not written by hand.

Accuracy and latency do not always come from the same pass, and they are not the same
kind of number: accuracy is deterministic, latency measures the machine as much as the
model. Each carries its own provenance rather than borrowing the other's.

| Tier | Measured | At | Commit | Load during |
|---|---|---|---|---|
| `rules` | accuracy | 2026-08-20T10:08:32.094Z | `64bdacf` | 2.54 external / 10 cores |
| `rules` | latency | 2026-08-20T10:08:32.094Z | `64bdacf` | 2.54 external / 10 cores |
| `small` | accuracy | 2026-08-20T10:10:22.725Z | `64bdacf` | 2.54 external / 10 cores |
| `small` | latency | 2026-08-20T10:10:22.725Z | `64bdacf` | 2.54 external / 10 cores |
| `large` | accuracy | 2026-08-20T10:14:19.727Z | `64bdacf` | 5.48 external / 10 cores |
| `large` | latency | 2026-08-20T10:14:19.727Z | `64bdacf` | 5.48 external / 10 cores |
| `gen-0.6b` | accuracy | 2026-08-20T10:17:08.107Z | `64bdacf` | 5.54 external / 10 cores |
| `gen-0.6b` | latency | 2026-08-20T10:17:08.107Z | `64bdacf` | 5.54 external / 10 cores |
| `gen-4b` | accuracy | 2026-08-20T10:26:31.441Z | `64bdacf` | 2.12 external / 10 cores |
| `gen-4b` | latency | 2026-08-20T10:26:31.441Z | `64bdacf` | 2.12 external / 10 cores |
| `gen-8b` | accuracy | 2026-08-20T10:40:28.800Z | `64bdacf` | 1.52 external / 10 cores |
| `gen-8b` | latency | 2026-08-20T10:40:28.800Z | `64bdacf` | 1.52 external / 10 cores |
| `human` | accuracy | 2026-08-20T10:14:19.755Z | `64bdacf` | 5.54 external / 10 cores |
| `human` | latency | 2026-08-20T10:14:19.755Z | `64bdacf` | 5.54 external / 10 cores |

**This file does not certify anything.** It assembles what a reviewer needs in order to
decide, and states what the evidence will not support. The decision is the committee's.

## 1. What changes

Each field is assigned to the cheapest tier that is not measurably worse than the best
available one. Where two tiers cannot be told apart on this sample, the cheaper is taken
— a difference inside the confidence interval is not a difference to pay for.

The interval is **Wilson**, not Wald. The distinction matters at the extremes, which is
where per-record rates live: Wald leaves [0, 1] near 0 % or 100 % and narrows wrongly on
a small sample — an interval that is too tight makes a difference look real when it is
not, and this table decides on exactly that. Wilson stays inside the bounds and widens
correctly: 0 of 20 gives [0 – 16.1 %], and 20 of 20 gives [83.9 % – 100 %]. Both values
are pinned in the suite, so no change can move them without saying so.

| Field | Tier | Accuracy | 95 % interval | Sample | Cost at volume |
|---|---|---|---|---|---|
| `name` | `large` | 96.6 % | [95–98] | n=1000 | $160 |
| `birth` | `rules` | 100.0 % | [100–100] | n=1000 | $0 |
| `document` | `rules` | 79.7 % | [77–82] | n=1000 | $0 |
| `country` | `rules` | 100.0 % | [100–100] | n=1000 | $0 |
| `address` | `gen-4b` | 95.8 % | [91–98] | n=120 | $31 |

Overall: **94.4 %** for **$191** against a budget of $4,000
(4.8 % consumed), at **968 ms** per document
against a ceiling of 2000 ms (48.4 % consumed).

**Per record, which is the unit that gets filed: 76.7 % [68–83], n=120.** A record counts as
complete only when all 5 fields are right together —
92 of 120. This is a true proportion and
carries an interval; the 94.4 % above is a mean of 5 rates measured on
different samples and carries none, which is why this file does not give it one.

A routing that optimises for complete records rather than the mean per field delivers
95 of 120 for $54, worse on no record in this
sample. On 3 discordant pairs the sample cannot separate the two rates, so
what it establishes is the cost and not the accuracy. It is not the recommendation above,
and the difference is stated here rather than left for a reader to find.

## 2. Where the sample cannot decide

These pairs are **not distinguishable on this sample**. The routing picked one of them,
and a larger sample could reverse that pick without any model changing. A reviewer
should read these as ties, not as findings.

| Field | Chosen | Indistinguishable from | Chosen rate | Other rate |
|---|---|---|---|---|
| `name` | `large` | `gen-8b` | 96.6 % [95–98], n=1000 | 91.7 % [85–95], n=120 |
| `birth` | `rules` | `large` | 100.0 % [100–100], n=1000 | 100.0 % [100–100], n=1000 |
| `birth` | `rules` | `gen-4b` | 100.0 % [100–100], n=1000 | 99.2 % [95–100], n=120 |
| `birth` | `rules` | `gen-8b` | 100.0 % [100–100], n=1000 | 100.0 % [97–100], n=120 |
| `document` | `rules` | `gen-0.6b` | 79.7 % [77–82], n=1000 | 70.0 % [61–77], n=120 |
| `document` | `rules` | `gen-4b` | 79.7 % [77–82], n=1000 | 79.2 % [71–85], n=120 |
| `document` | `rules` | `gen-8b` | 79.7 % [77–82], n=1000 | 83.3 % [76–89], n=120 |
| `country` | `rules` | `small` | 100.0 % [100–100], n=1000 | 100.0 % [100–100], n=1000 |
| `country` | `rules` | `large` | 100.0 % [100–100], n=1000 | 100.0 % [100–100], n=1000 |
| `country` | `rules` | `gen-4b` | 100.0 % [100–100], n=1000 | 100.0 % [97–100], n=120 |
| `country` | `rules` | `gen-8b` | 100.0 % [100–100], n=1000 | 100.0 % [97–100], n=120 |

## 3. What it was measured on

**A held-out split, and that is the load-bearing control.** The rules were developed on
one set of phrasings and scored on another they never saw. The first run of this project
scored the hand-written rules at 100 % on all five fields because the regexes had been
written against the very templates used to score them. A test in this repository fails if
the training and held-out phrasings ever share a shape.

**The corpus is synthetic.** It is seeded and reproducible, and it was written by the
author. A held-out split defends against marking your own homework; it does not turn
invented documents into the ones your customers send. On your own documents every figure
in section 1 needs re-measuring, which is what the shipped harness is for.

**The models are pinned by revision**, so a re-run measures the same thing rather than
whatever was published last under the same name.

| Tier | Model | Pinned at | Licence |
|---|---|---|---|
| `small` | distilbert-base-cased-distilled-squad | `bdbb0a5e9c61` | Apache-2.0 |
| `large` | roberta-base-squad2 | `6d1aeed784b6` | CC-BY-4.0 ⚠ |
| `embSmall` | all-MiniLM-L6-v2 | `751bff37182d` | Apache-2.0 |
| `embLarge` | multilingual-e5-small | `761b726dd34f` | MIT |
| `gen-0.6b` | `qwen3:0.6b` | `7df6b6e09427` | Apache-2.0 |
| `gen-4b` | `qwen3:4b` | `359d7dd4bcda` | Apache-2.0 |
| `gen-8b` | `qwen3:8b` | `500a1f067a9f` | Apache-2.0 |

⚠ **roberta-base-squad2** — CC-BY-4.0: attribution required — the only practical condition in the whole set.
Every other model here is permissive with no practical condition. A routing that places
that tier on a field takes on an obligation the others do not, and no accuracy table
would ever show it.

## 4. What gets worse

A routing that improves an average still loses ground somewhere, and that is the part a
reviewer must see. Against the best accuracy available on each field regardless of price:

| Field | Chosen | Best available | Accuracy given up | Why |
|---|---|---|---|---|
| `document` | `rules` | `gen-8b` | 3.6 % | inside the interval — not a measurable loss |

The repository also publishes every individual failure with its input and output rather
than a summary rate — run `npm run failures`. A reviewer who wants to know what the
system gets wrong should read those, not this percentage.

## 5. What is assumed rather than measured

Nothing in section 1 depends on the author's opinion except through these. Each is an
input you replace with your own, and the sensitivity sweep (`npm run sensitivity`) says
which of them change the answer and which do not.

| Input | Kind | Value |
|---|---|---|
| `humanAccuracy` | assumed | 0.85 |
| `humanSeconds` | assumed | 45 |
| `analystAnnualCost` | assumed | 62000 |
| `productiveHoursPerDay` | assumed | 6 |
| `workingDaysPerYear` | assumed | 220 |
| `pricePerThousandSmall` | assumed | 0.2 |
| `pricePerThousandLarge` | assumed | 1.6 |
| `machineHourlyCost` | assumed | 1.2 |
| `volume` | assumed | 100000 |
| `budget` | assumed | 4000 |
| `latencyBudgetMs` | assumed | 2000 |
| `costWrongValue` | assumed | 0.587 |
| `costBlankField` | assumed | 0.587 |

The human tier's accuracy is an assumption and never a measurement. An optimiser that
believes a human is infallible routes everything to them, and the conclusion goes wrong
in the direction that costs the most.

## 6. Ongoing monitoring

**A routing decision expires.** It was taken against pinned revisions on a fixed sample;
a provider updating a model, or your own traffic drifting, invalidates it silently — no
error is raised, the accuracy simply moves. Three things follow, and they are the
obligation this document creates rather than a recommendation:

1. **Re-measure on a schedule and on every model change.** The harness ships with the
   routing; `npm run measure` reproduces the whole table. Anything else is trusting a
   number whose expiry date has passed.
2. **Compare runs rather than reading the latest one.** A rising aggregate can hide cases
   that used to pass and no longer do; only a run-to-run diff surfaces those.
   `npm run diff <before> <after>` compares two sealed runs case by case, and refuses
   the comparison — naming the cell and the reason — rather than returning a zero it
   cannot support.
3. **Watch the input distribution, not only the output.** Accuracy falls after the
   population has already moved, which makes it the last indicator to react.
   `npm run entree` computes a population stability index on the documents alone — no
   labels, so it runs where no ground truth exists, which is production. It reports that
   index next to its own noise floor: what the same sample size produces on a population
   that has **not** moved. An index below the floor is a draw, not a drift, and the floor
   is what decides whether the 0.2 threshold means anything at that sample size — on
   this corpus it is 0.260 at 120 observations, which is above the threshold, and
   0.061 at 350, which is below it. That is why the tool
   refuses to read under 350: any smaller and the threshold fires
   on a population that never moved.

## 7. What this does not establish

- **Not that the chain is fit for production.** 94.4 % is a routing result on
  a synthetic corpus, not a control effectiveness statement. Where the field feeds a
  regulatory obligation, the escalation boundary decides that, not this average.
- **Not that the tiers rank this way on your data.** The two chains in this repository
  rank them in opposite orders. Any conclusion that does not begin with measuring your
  own chain is describing someone else's.
- **Not that the cost is what you will pay.** Prices here are assumed and editable;
  batching, caching and streaming each change the economics substantially and none is
  modelled.
- **Not that latency is safe under load.** It is measured one item at a time on an idle
  machine. Queueing behaviour is a different measurement and is not in this file.
- **Not that these rates survive a scan.** Everything above is measured on text. The same documents read back from images through the operating system's OCR recover 99.4 % of words, and `small` gives up 10.5 points. Those images are rendered rather than photographed, so that gap is a floor: a photographed page brings columns, skew and reading order that these do not.

---

*Generated by `npm run dossier` from `data/profiles.json` and `ocr.json`. Regenerating it after any
re-measurement is the only supported way to keep it true.*
