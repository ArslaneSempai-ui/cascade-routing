# What the forced output schema is actually worth

*Written 21 August 2026. This report is a dated snapshot: it is not regenerated, and
the figures in it are those of that day.*

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

## Which half survives, and the rule that decides it

The two halves of this finding were measured in the same twenty calls, minutes
apart, by the same script. One survived the scrutiny and the other did not, and
the difference is not carefulness — it is what kind of fact each one is.

| | what it is | survives? |
|---|---|---|
| **15.6 tokens against 200** | a fact about the model's output | **yes** |
| 644 ms against 5,412 | a fact about the machine, its load, and the moment | no |

**A count is counted. A duration is timed.**

A token count is a property of what the model emitted. It reproduces on another
machine, under another load, a week later. It can be published as it stands, and
a buyer can check it in an afternoon without trusting us and without a stopwatch.

A duration is a property of the machine, its load and the instant. It holds only
for the pass that took it, and it is publishable only with its dispersion. This
repository already says a latency does not transfer between machines; this is the
same boundary seen from the other side, and it decided three times on 21 August
what could be published.

Two figures were withdrawn that night for confusing the two — this one, and a
cost ratio between tiers by document length. Both were timings quoted as though
they were properties.

The corollary is a question worth asking of any figure, and it caught this one:
**is this measured, or bounded by a limit I chose?** A mean of exactly 200.0
against a `num_predict` of 200 is not a length; it is the cap. No automatic check
finds that — only reading the number next to the setting.

`landing.json` now declares once, at the top level, that every duration it
publishes is derived from a single measured relevé whose dispersion lives in
`latencySpread.perDoc`, and that nothing in the file is a fresh timing. A test
holds the declaration and checks that the place it names really carries
percentiles in order — a declaration pointing at an empty object would be worse
than none.

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
