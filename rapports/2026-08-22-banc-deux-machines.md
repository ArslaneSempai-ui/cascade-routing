# Trying to break the two-machine result

Asked to refute before it is written anywhere. It does not survive in the form
proposed, and what replaces it is narrower and better.

Everything below is read from the four files in `cascade-banc/`, not from the
summary of them.

## The finding that breaks it: one machine repeats, the other does not

| file | chip | burst 8b (median of 5) | sustained plateau | sustained ÷ burst |
|---|---|---|---|---|
| `pro.json` | M1 Pro | 23.07 | 22.64 | 98 % |
| `pro-calme.json` | M1 Pro | 23.07 | 23.07 | 100 % |
| `charge-elevee.json` | M5 | **14.78** | 16.09 | 109 % |
| `banc-37de6cfe.json` | M5 | **24.67** | 15.07 | 61 % |

**The M1 Pro's two burst medians agree to four figures. The M5's differ by a
factor of 1.67**, same bench version, same model, same machine.

So "each machine repeats itself" holds for one of them. And two machines cannot
be ranked when one of them does not repeat.

It also decides which run the headline rests on. *"In burst the M5 wins
everywhere, +11.8 / +3.7 / +6.9 %"* compares `pro-calme` against
`banc-37de6cfe` — the M5 run where it happened to be fast. Compared against
`charge-elevee`, the M5 **loses** in burst: 14.78 against 23.07. The conclusion
depends on which of the M5's two runs is picked, and nothing in the files says
which one to pick.

Likewise the sustained drop. In one M5 run the plateau is 61 % of burst; in the
other it is 109 % — no drop at all. A 40 % sustained collapse that appears in one
run of two is not yet a property of the chip.

## The machine and load attribution in the summary does not match the files

| | summary says | files say |
|---|---|---|
| `pro.json` | M1 Pro, load 3.48 | M1 Pro, **load1 2.86** (load5 3.45) |
| `charge-elevee.json` | M5, load 7.02 | M5, **load1 3.48** (load5 3.64) |
| `pro-calme.json` | M1 Pro, load 3.01 | M1 Pro, **load1 2.40** (load5 1.91) |
| `banc-37de6cfe.json` | M5, load 2 | M5, **load1 1.58** (load5 2.19) |

**3.48 is the M5's load, not the M1 Pro's** — which settles the question Écriture
raised about two sessions giving opposite attributions. And **no run started at
7.02**; the highest `load1` in the four files is 3.48.

## The thermal explanation has no support in these files

All four recorded slopes are **positive** — throughput rising over the run, not
decaying:

    M1 Pro  pro.json          +0.0025 /min      22.62 → 22.64
    M1 Pro  pro-calme.json    +0.5825 /min      23.07 → 23.07
    M5      charge-elevee     +0.1025 /min      14.94 → 16.21
    M5      banc-37de6cfe     +0.6800 /min      15.00 → 15.19

There is no "2.5 %/min against 4.5 %" decay in the data, and the slopes do not
sort by machine: the flattest and the steepest are both the M1 Pro's. Cooling is
recorded as "ventilated (inferred from the model)" — inferred, so assumed, and it
is the weakest of the three candidate causes on this evidence rather than the
leading one.

## Two candidate causes that are measured rather than inferred

**The M5 has half the performance cores.** `hote` records 8 performance and 2
efficiency cores for the M1 Pro, against **4 performance and 6 efficiency** for
the M5. For a sustained single-model generation that saturates performance cores,
that is a plain explanation needing no thermals — and it is in the file.

**This M5 is under heavy memory pressure.** Swapouts: 29.5 and 29.8 million on
the M5, against 0.89 and 0.97 million on the M1 Pro — a factor of thirty. One M5
run started with **69 MB free**. Both machines have 16 GiB. That is a property of
this machine's state, not of the chip, and it is a strong candidate for both the
instability and the sustained drop.

Neither is tested. Both are checkable, and both beat an inferred cooling label.

## The dropout question, answered

Requests kept: `pro.json` 34/34, `pro-calme` 32/32, `charge-elevee` 24/24, and
**`banc-37de6cfe` 21 of 22 — the M5 dropped one**. So both machines have
exclusions, and the M5's is a rejected request while the M1 Pro's is a
plateau-window exclusion.

The 7.36 tok/s point sits inside `pro-calme`'s `fin` window, dragging its mean to
21.39 against a median of 23.07. Keeping it, the M1 Pro's sustained figure falls
from 23.07 to 21.39 — still far above the M5's 15. **The dropout does not carry
the gap.** It is the reproducibility that does.

## Load as a queue length

The worry is right in general: load average is a run-queue length, so a slower
machine doing identical work reports a higher load, and comparing 2.40 against
1.58 across machines compares nothing.

For this comparison it does not bite, and the data says why: within the M5, the
higher-load run is the *faster* one — 16.09 at load1 3.48 against 15.07 at 1.58.
Load is not driving the plateau in this range. But that also means "comparable
load" was never doing the work it was credited with.

## What can be said

- **The M1 Pro reproduces; this M5 does not.** Two figures agreeing to four
  significant digits against two differing by 67 %.
- **A machine that does not reproduce cannot be ranked**, in either direction.
- The sustained-versus-burst framing is the right one, because it compares each
  machine with itself and so needs no cross-machine load comparability — but it
  needs the M5 to repeat before it says anything.

## What would settle it

Three more M5 runs, on an idle machine with memory pressure recorded and free
memory above a declared floor. If the burst median lands near 24.67 each time,
the earlier 14.78 was a bad run and the sustained drop is real. If it scatters
between 15 and 25 again, the M5 measurements do not support any ranking and the
question is about this machine's state, not about chips.

Cheap, and it decides a claim that would otherwise go on a page.
