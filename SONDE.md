# Probe — does a local generative ladder change the finding?

*Run 19 August 2026, Apple M5 / 16 GB, Ollama 0.32.14. 20 held-out cases per chain, scored
by the repository's own `correct()`, on the same held-out split as every other figure here.*

**Re-run at full size on 19 August 2026: 120 held-out cases per chain, per tier, matching the
sample size behind every published figure in this repository.** The twenty-case probe that
preceded it got one conclusion wrong, and that correction is recorded below.

---

## What was asked

The repository's ladder is encoder models — extractive QA and embeddings. The standing
objection, and the fair one, is that this is not LLM routing. So: put real generative models
on the same corpus, judged by the same scorer, and see whether the finding survives.

Qwen3 at 0.6B, 4B and 8B, local through Ollama. 32B was ruled out before starting: at 4-bit
it needs roughly 20 GB of weights, and this machine has 16 GB of unified memory.

## Chain A — extraction, 120 held-out cases

| Field | rules | distilbert | roberta | qwen3:0.6b | qwen3:4b | qwen3:8b |
|---|---|---|---|---|---|---|
| `name` | 0.0 % | 49.2 % | **96.7 %** | 80.8 % | 89.2 % | 91.7 % |
| `birth` | **100.0 %** | 100.0 % | 100.0 % | 87.5 % | 99.2 % | 100.0 % |
| `document` | 83.3 % | 62.5 % | 67.5 % | 70.0 % | 79.2 % | **83.3 %** |
| `country` | **100.0 %** | 100.0 % | 100.0 % | 83.3 % | 100.0 % | 100.0 % |
| `address` | 0.0 % | 42.5 % | 38.3 % | 75.0 % | **95.8 %** | 82.5 % |

95 % intervals on the generative tiers:

| Field | qwen3:0.6b | qwen3:4b | qwen3:8b |
|---|---|---|---|
| `name` | [73–87] | [82–94] | [85–95] |
| `birth` | [80–92] | [95–100] | [97–100] |
| `document` | [61–77] | [71–85] | [76–89] |
| `country` | [76–89] | [97–100] | [97–100] |
| `address` | [67–82] | [91–98] | [75–88] |

## Chain B — classification, 120 held-out cases

| rules | MiniLM | e5-small | qwen3:0.6b | qwen3:4b | qwen3:8b |
|---|---|---|---|---|---|
| 24.2 % | 67.5 % | 44.2 % | 61.7 % | 94.2 % | **100.0 %** |

Intervals: 0.6b [53–70], 4b [88–97], 8b [97–100].

## Latency, per call

| rules | distilbert | roberta | qwen3:0.6b | qwen3:4b | qwen3:8b |
|---|---|---|---|---|---|
| 0.0 ms | 20 ms | 35 ms | 247 ms | 1,024 ms | 1,457 ms |

These move by 20–30 % between runs depending on what is warm. Treat them as an order of
magnitude, not a measurement — which is the same caveat the README already carries.

## The finding this changes, and why that is good news

The README's strongest sentence is currently that no available tier can read an address, and
that the next gain is a step and not a slope: +8.5 points, 327× current spend, buying exactly
one field.

**A 4B model reads the address at 95.8 %, interval [91–98].** Against roberta's 38.3 %, that is
+57.5 points on the one field the optimiser singled out, and the intervals are nowhere near
touching.

That does not refute the finding. It *pays it out.* The tool predicted, from measurement alone,
that the gain worth wanting was on the address field and that it would cost a step change
rather than more budget. Encoder to generative is exactly a step change, and it moved exactly
that field. A prediction that came true is a better result than a ceiling.

## The finding is now sharper, not weaker

At 20 cases the probe read 4B and 8B as indistinguishable on extraction. At 120 that is wrong,
and wrong in the interesting direction.

**On the address, the 8B model is worse than the 4B: 82.5 % against 95.8 %.** The intervals —
[75–88] against [91–98] — do not overlap. Doubling the model loses 13 points and costs 40 %
more latency.

**On classification the same ladder is strictly monotonic**: 61.7 %, 94.2 %, 100.0 %. Bigger is
better, cleanly, with no ambiguity.

Same three models, same machine, same run. Bigger is worse on one task and better on the other.
That is the thesis of this repository stated as sharply as it can be stated, and it is now
measured on real generative models rather than inferred from encoders.

## The encoders were not superseded

The result that would have been easy to assume — that a generative ladder simply wins — is
false here, on three of five fields:

- **`name`: roberta still wins**, 96.7 % against 91.7 % for a model twenty times its size and
  forty times slower. A small specialised extractive head beats an 8B generalist at its own job.
- **`birth` and `country`: free rules stay at 100 %.** Every generative tier is equal or worse,
  and 0.6B is much worse — 87.5 % and 83.3 %.
- **`document`: the free regex ties the 8B model**, 83.3 % against 83.3 %, at zero cost and
  1,457 ms less per call.

On accuracy alone, the best assignment now spans all three families at once — roberta for the
name, free rules for birth, document and country, a 4B generative model for the address, giving
95.2 % against the 84.5 % published today, with three of five fields still free. Which is the
argument for measuring per field, made without a single sentence of advocacy.

## What the probe cost me in wrong answers first

Two full runs scored 0.0 % on every field before anything worked, and both were the harness,
not the model.

**Free-text generation does not work at all here.** qwen3 reasons in ordinary prose — "We are
given a document string and we need to extract…" — not inside `<think>` tags, so `think: false`
suppresses nothing and `/no_think` returns an empty string. A JSON schema on the response is
not a refinement; it is the only thing that produces a value.

**And a schema alone is not enough.** With one, the model filled the field with the *question*
("the identity document number") or with the entire document. One worked example in the prompt
fixed both, and took the address from 0 % to 95 %.

Both were my errors, recorded because this is the third time in this repository that a broken
harness has been mistaken for a broken model, and the first two cost more than this one.

## What is not honest to claim yet

- **The probe's own reading of 4B versus 8B was wrong**, and it took the full 120 cases to see
  it. Twenty cases said "indistinguishable on extraction"; 120 said the 8B is 13 points worse on
  the address, with non-overlapping intervals. A conclusion drawn from twenty cases was
  confidently wrong in this repository three hours ago, which is the reason the figures here
  carry their intervals.
- **The generative tier got prompt engineering the encoders cannot receive.** A one-shot
  example and a constrained schema are not available to an extractive QA head. That is a
  property of the tier type rather than a thumb on the scale, but the comparison is not
  like-for-like and should say so.
- **The cost model does not fit a local tier.** Prices here are per thousand API calls. A model
  running on your own silicon costs time and electricity, and at 25–80× the encoder latency
  that is not a rounding error. A budget in seconds belongs beside the budget in dollars —
  which the README already lists as the thing it would do differently.

## What a full build would take

Ollama and the three models are installed and the probe harness works. What remains is the
adapter and the prompts as repository code, a full 120-case measurement per tier per chain
(about 25 minutes of inference for the ladder), the cost basis for a local tier, then figures,
README, tests and demo data regenerated. A day, and the prompts are the part that can overrun.

The recommendation stands: keep the encoder ladder as the default that reproduces in two
minutes with no download, and add the generative ladder behind a flag.
