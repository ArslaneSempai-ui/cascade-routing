# Extraction cost audit: a worked example on synthetic receipts

**Everything in this folder is synthetic.** `generate.mjs` writes it from a fixed seed: sixty
receipts from shops that do not exist, two invented vendors, and their "extracted" values.
No shop, no person and no number is real, and every receipt text says so. Nothing here was
produced by Amazon, Google or Microsoft.

## Why synthetic, when a public dataset was asked for

Three labelled receipt datasets were checked on 2026-09-29 for a licence that allows
redistribution:

| Dataset | Licence found | Used |
|---|---|---|
| CORD (clovaai/cord) | the repository carries `LICENSE-CC-BY` and states CC BY 4.0: redistribution with attribution is allowed | no: its data lives on Google Drive and on the Hugging Face hub, and neither host was reachable from the environment that wrote this example |
| SROIE (ICDAR 2019) | not read: the competition site was not reachable from that environment | no |
| FUNSD | not read: its page was not reachable from that environment | no |

A dataset whose terms could not be read is not "clean", and a clean one that could not be
fetched cannot be vendored. So the example is generated, and says so. On a machine that
reaches the hub, CORD is the candidate to replace it, with its citation.

That run now exists: [`examples/cord-receipts`](../cord-receipts/) is the same audit on the 100 real receipts of
CORD's test split, with Google Document AI and Gemini outputs, under CC BY 4.0.

## What is here

| File | What it is |
|---|---|
| `generate.mjs` | the seeded generator; `node examples/extraction-audit/generate.mjs` rewrites the three files below identically |
| `receipts.csv` | sixty labelled cases; the header declares each field's kind: `total:amount`, `receipt_date:date`, `receipt_id:id`, `currency:currency` |
| `vendor-a-values.json` | what an invented vendor returned: mostly right, written in its own formats, wrong on purpose on a known share |
| `vendor-b-values.json` | a second invented vendor: cheaper, blind to the identifier on many receipts |
| `rules.json` | a regular expression per field, the free local tier |
| `receipts-vendor-a-outcomes.json`, `receipts-vendor-b-outcomes.json` | what `npm run grade` wrote from the two files above: outcomes only, no value |

## The run

The first two commands were run to produce the outcomes files committed here:

```
npm run grade -- --cases=examples/extraction-audit/receipts.csv --name=vendor-a \
    --values=examples/extraction-audit/vendor-a-values.json --price-per-thousand-pages=50
npm run grade -- --cases=examples/extraction-audit/receipts.csv --name=vendor-b \
    --values=examples/extraction-audit/vendor-b-values.json --price-per-thousand-pages=10
```

Their output, as printed: vendor A graded `total` clean on 56 of 60 (4 wrong), `receipt_date`
clean on 57 (3 blank), `receipt_id` clean on 49 (11 wrong), `currency` clean on 57 (3 blank);
vendor B graded `total` clean on 55 (5 blank), `receipt_date` clean on 55 (5 blank),
`receipt_id` clean on 36 (24 blank), `currency` clean on 53 (7 wrong). Those counts are the
generator's doing: the typed grader is what makes "36,73", "EUR 36.73" and "36.73" the same
amount, and "gbp" and "GBP" the same currency.

The third command needs the encoder weights (`npm run poids -- --prime` fetches them once):

```
npm run measure:yours -- --cases=examples/extraction-audit/receipts.csv \
    --sorties=examples/extraction-audit/receipts-vendor-a-outcomes.json \
    --sorties=examples/extraction-audit/receipts-vendor-b-outcomes.json \
    --rules=examples/extraction-audit/rules.json \
    --current=vendor-a --pages-per-year=1000000 --margin=5
```

It measures the local tiers on the same sixty receipts, then prints and writes the audit:
per field, the cheapest source the sample cannot show to be worse, its cost per thousand
pages, the recommended routing within the declared five-point margin, the saving a year
against vendor A, and every pick the sample cannot separate. Without `--margin` it lists, per
field, the options the sample cannot separate from the best and recommends nothing: "not
separable" is not "not worse". **No output of that command is committed here**: the environment that wrote
this example could not download the weights, so the run was not made, and a result that was
not produced is not published. The suite runs the same command where the weights exist
(`src/audit-command.test.ts`).
