# Silence instead of a doubtful value

Measured 21 August 2026 from stored rows. No GPU.

Escalation is bounded: reaching `gen-8b` breaks the latency ceiling on four
fields of five, and the one admissible escalation completes no extra document.
Abstention is the remaining lever, and it costs neither a millisecond nor a euro.

30 documents, 150 fields, the recommended routing. A blank is visible; a wrong
value enters the file silently.

## The table

| rule | abstained | wrong removed | correct lost | exchange | delivered | correct delivered | delivered precision |
|---|---|---|---|---|---|---|---|
| none | 0 | 0 | 0 | — | 150 | 44 | 29.3 % [22.6–37.1] |
| **≥ 1 signal** | 103 | **91** | 12 | **7.58** | 47 | 32 | **68.1 % [53.8–79.6]** |
| ≥ 2 signals | 4 | 4 | 0 | — | 146 | 44 | 30.1 % [23.3–38.0] |
| oracle | 106 | 106 | 0 | — | 44 | 44 | 100 % [92–100] |

Delivered precision more than doubles, on intervals that do not overlap, over
more than a hundred values — so unlike the whole-document counts this is
quotable. The exchange, 7.58 wrong removed per correct lost, beats a random
abstention at the same rate, which manages 2.46.

## And it is worth nothing at the declared prices

The exchange ratio hides the thing that decides. Costed with the two prices
already in `assumptions` — `costWrongValue` and `costBlankField`, both 0.587:

| rule | total cost |
|---|---|
| none | 62.2 |
| ≥ 1 signal | **69.3** — worse |
| oracle | 62.2 — **identical** |

At equal prices abstention is worthless **by construction**. It converts an error
into a gap at the same price and throws away twelve correct values on the way. The
oracle, abstaining only on wrong values, lands exactly where doing nothing lands:
106 wrong become 106 blanks at the same price.

That is not a result about abstention. It is a result about the assumption.

## The number worth publishing is the break-even

At what ratio must an invented value cost more than a gap before silence pays?

| rule | break-even |
|---|---|
| **≥ 1 signal** | **×1.13** |
| ≥ 2 signals | ×1.00 |
| oracle | ×1.00 |

**Abstention pays as soon as a wrong value costs thirteen per cent more than a
missing one.** Below that it loses; above it, it wins immediately and keeps
winning.

That bar is low, and it is the client's to judge, not ours. A KYC file with an
invented passport number that nobody flags is not obviously in the same class as
one with a visibly empty field — but saying by how much is their business, and
the assumptions carry both prices precisely so it can be changed in one place.

The two-signal rule breaks even at ×1.00 because it never sacrifices a correct
value: four abstentions, four of them wrong. It is free at any ratio at or above
one, and it removes four errors out of a hundred and six.

## Reservations

**Thirty documents.** The whole-document counts stay under this repository's floor
of twenty successes and none of them is quotable. Delivered precision rests on
more than a hundred values and carries its interval.

**Measured on broken documents**, where 106 of 150 fields fail. On clean traffic
the base error rate is far lower, fewer values trigger a signal, and both the
exchange and the break-even move. What transfers is the shape of the argument,
not the numbers.

**The break-even is arithmetic over the measured counts** and does not depend on
either price — only on their ratio. It is the one figure here that survives a
client replacing our assumptions with theirs.
