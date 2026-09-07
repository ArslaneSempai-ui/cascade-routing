# How the hard corpus is scored

**Written and committed before any measurement on this corpus.** Nothing below was
added, widened or narrowed after seeing a result. A scoring rule written after a
run selects itself to produce the result you wanted, and it is the first entry in
this repository's retraction journal.

## The three kinds of expected answer

**A value.** The tier must return it. Formatting is normalised on both sides —
spaces around separators, trailing punctuation, case — because a tokeniser adding
a space is not a model failing to read. Content is not normalised: a missing
word, a wrong span or a different value stays wrong.

**Several values.** Any listed reading scores correct. This covers two situations
that are the same arithmetic and different in kind: a country printed both in its
own language and in English (`HELLENIC REPUBLIC / Greece`), and a genuinely
ambiguous document where two readings are each defensible. Both are declared in
the corpus, before measurement, case by case.

**Silence.** For twenty-one of the hundred and fifty fields, the correct answer
is to return nothing — either the document is cut and the value is unrecoverable,
or the field is genuinely absent. Here a blank is correct and a value is wrong.
This is the inverse of the clean corpus, where a blank is always a failure, and
it is the reason these cases are worth measuring at all.

## Why every defensible reading counts as correct

A tier that returns a reading a competent human would defend has not failed.
Marking it wrong for choosing the other valid reading measures its agreement with
our preference, not its accuracy — and accuracy is what is being sold. The
penalty would land on whichever tier happens to disagree with whoever wrote the
key, which is not noise but a bias with a direction.

This decision was taken by the person running the project on 21 August 2026,
before any measurement, and reached this session through the coordinating
session rather than directly.

## What a published rate must carry

**Any accuracy figure from this corpus states its rule in the same sentence:**
*correct = any defensible reading declared before measurement.* A rate whose
scoring rule is not readable beside it is a number without its method — the same
defect as an accuracy with no formulation recorded in its provenance.

## Two failures counted separately, never folded into the rate

**Over-refusal** — the tier returns nothing where a value was recoverable. On a
cut document this is the cheap, visible failure: someone sees the blank.

**Over-answering** — the tier returns a value where the correct answer was
silence. This is the expensive one. It enters the record looking like data, and
nothing downstream marks it as invented.

Both are already inside the accuracy figure as failures. They are also reported
apart, because a tier at 80 % that over-answers and a tier at 80 % that
over-refuses are not the same product, and one number cannot say which you have.

## Disagreement between tiers, which is not an error

On a case with several defensible readings, two tiers can both be right and hand
the client two different values. That is not a failure and it does not enter the
rate.

It is measured separately, because it may be the most useful figure here: **how
often two tiers that are statistically indistinguishable produce different
files.** An indistinguishability result says two tiers score the same. It does
not say they agree, and the routing recommendation rests on treating them as
interchangeable.

## What this scoring cannot do

It cannot tell a tier that reasoned from one that guessed and landed on a listed
reading. Every declared reading counts equally, so a coin toss that lands well
scores as well as an argued answer. The corpus notes this per case where it
matters; no arithmetic here repairs it.
