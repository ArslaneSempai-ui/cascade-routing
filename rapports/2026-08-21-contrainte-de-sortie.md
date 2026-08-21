# What the forced output schema is actually worth

Three questions were asked of the ×8.4 figure I wrote in passing. The answers are
weaker than the figure sounded, and the weakness is one I retracted a few hours
earlier on a different measurement.

## 1. Measured or deduced?

**Measured — durations, not derived from a token count.** 21 August, `gen-4b`,
same prompts, same documents, same machine, temperature 0, twenty extractions per
condition (four documents × five fields):

| | tokens produced | duration |
|---|---|---|
| with `format: schema` | 15.6 | 644 ms |
| without | **200.0** | 5,412 ms |

5,412 / 644 = 8.40.

**But it carries the defect I retracted this evening.** Twenty calls, means, and
**no spread reported** — on a machine whose single-call spread I later measured at
up to a factor of five. The point estimate is not reliable to two significant
figures, and I should not have written it as though it were.

What is solid is the token count, because it is counted rather than timed: 15.6
against 200.0.

## 2. Where does the factor come from?

The reading offered is right and understates it. Without the schema the model
generates reasoning prose — the first response begins *"We are given a document
string and a question. We need to co…"* — instead of the value.

**And the mean is exactly 200.0, which is `num_predict`.** Every single call hit
the cap. So the unconstrained length is **not measured at all**: it is at least
200 tokens and unknown. The factor is bounded below by my own cap, not observed.
Raise `num_predict` and the factor rises with it.

So ×8.4 is not a property of the model. It is a property of the model, the
prompt, and a cap I chose.

**And it was measured on one tier.** `gen-4b` only. With the schema, `gen-0.6b`
produces 14.2 tokens and `gen-8b` 12.8, so neither is verbose under constraint —
but I have never run either without it. The second machine reports the same
runaway on `gen-4b` and 5 to 8 tokens on the other two, which is consistent, and
consistency is not measurement.

## 3. Does it cost accuracy?

**Not measured, and not measurable without changing something else.**

The pipeline parses the response with `JSON.parse`. Remove the schema and prose
arrives, the parse fails, the value is empty, and the outcome is a blank. So in
this chain removing the constraint does not trade accuracy for cost — it removes
the answer entirely.

The comparison the question asks for — same accuracy, two prices — needs a second
parser that pulls a value out of prose. That is the second pipeline flagged over
the formulations, and it is the same piece of work.

## So the sentence does not hold

*"Constraining the format is worth more than changing the model"* is not supported
by anything I have. What is supported:

- Without a schema, `gen-4b` generates to the token cap on every call and returns
  reasoning instead of a value.
- With one, 15.6 tokens.
- **In this pipeline that difference is not a price/accuracy trade.** It is the
  difference between a parseable answer and none, because the parser reads JSON.

That is a narrower claim, and it is the one the data carries.

## What would settle it

One pass, no urgency, on an idle machine:

- three generative tiers × with and without the schema, on the same cases, with
  `num_predict` raised well past any plausible answer so the unconstrained length
  is observed rather than clipped;
- **per-call durations kept with their spread**, not means;
- a prose extractor for the unconstrained arm, so accuracy is comparable;
- and the token counts recorded, which are exact where durations are noisy.

Roughly twenty minutes for `gen-4b` alone, an hour for three. Until then the
figure should be quoted as "the model generates to the cap without the
constraint", with the token counts, and not as a price ratio.
