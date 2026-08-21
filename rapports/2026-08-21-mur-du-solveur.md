# How far the exhaustive solver goes

Measured 21 August 2026 on the corrected solver, as instructed: the named gap is
filled with the numbers of the solver being sold, not the one it replaced.

## What was wrong

`optimiseExtraction` pushed every admissible solution into an array, then
filtered that array against the best one. The comment above it already said "two
passes" — it described the logic in two phases, not the implementation, which
materialised everything. A comment that reassures about a property the code does
not have.

The cost was never time. Seven tiers and seven fields is 823,543 assignments,
which this machine walks in a second or so. It was memory, and the tool did not
slow down — it **stopped**, heap exhausted, at seven tiers and eight fields.

## What it is now

Two enumerations, nothing retained between them but the reference solution.
Constant memory, twice the time. The routing is mutated in place rather than
copied at each node; the copy allocated an object per edge, which was not the
leak but fed it.

**Identical output.** Same routing, same accuracy, same cost, same ms per
document on the shipped relevé, and both generated files unchanged.

## The wall, in seconds

| tiers \ fields | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|
| 4 | 1 ms | 2 ms | 7 ms | 24 ms | 117 ms |
| 5 | 1 ms | 4 ms | 21 ms | 121 ms | 711 ms |
| 6 | 1 ms | 8 ms | 62 ms | 424 ms | 3.0 s |
| 7 | 2 ms | 19 ms | 155 ms | **1.3 s** | **10.2 s** |
| 8 | 4 ms | 37 ms | 347 ms | 3.3 s | **32.3 s** |
| 9 | 6 ms | 65 ms | 700 ms | 7.3 s | not run |

Seven tiers by eight fields — where the previous solver died — takes ten seconds.
Eight by eight, sixteen point eight million assignments, takes thirty-two.

The 9×8 point was not run: estimated past the forty-five second ceiling from the
point before it. Measuring a ten-minute point says nothing the previous one did
not, and holds the machine.

## Memory, measured rather than asserted

Net heap growth across the whole solve, sampled every 20 ms:

| problem | assignments | heap growth |
|---|---|---|
| 4 × 4 | 256 | 0.0 MB |
| 6 × 6 | 46,656 | 0.0 MB |
| 7 × 7 | 823,543 | 0.0 MB |
| 7 × 8 | 5,764,801 | 0.0 MB |
| 8 × 8 | 16,777,216 | 0.0 MB |

Flat across a sixty-five-thousand-fold increase in problem size. The previous
version would have been holding sixteen million solution objects at the last row.

## What the limit is now, and why that matters

**Time, not memory.** The difference is not cosmetic: a solve that takes a minute
is visible and can be reduced — fewer tiers, fewer fields, a coarser sweep. An
exhausted heap reports nothing about what should have been reduced, and it
arrives without warning.

So "exhaustive, not heuristic" is now a promise with a number attached: up to
eight tiers and eight fields in under a minute on this machine. Past that the
tool is honest about being slow rather than dishonest about being dead.

Both figures are for this machine — Apple M5, ten cores. They are combinatorics
and they will move with the processor, unlike the accuracy figures beside them.
