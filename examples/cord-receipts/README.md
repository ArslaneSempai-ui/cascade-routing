# Extraction cost audit on 100 real receipts

This folder is a complete, public run of the extraction cost audit on real documents: the 100 receipts of the
[CORD v2](https://github.com/clovaai/cord) test split, three fields (total, subtotal, tax), eight sources. Two are
paid services whose real outputs are here (Google Document AI and Gemini). Six are the tool's own local tiers. The
sealed record is `cord-labels-grouped-measured.json`, seal `ac7d0adbe4907caf`, measured at commit `7e82950`.

## What it found

Share of values read right, with the 95 % interval, from the sealed record. Cases with an expected value:
total 95, subtotal 65, tax 40.

| Source | total | subtotal | tax |
|---|---|---|---|
| gemini-flash | 96.8 % [91-99] (pick) | 95.4 % [87-98] (pick) | 97.5 % [87-100] (pick) |
| google-expense | 93.7 % [87-97] | 89.2 % [79-95] | 70.0 % [55-82] |
| gen-4b | 81.1 % [72-88] | 78.5 % [67-87] | 27.5 % [16-43] |
| gen-0.6b | 77.9 % [69-85] | 40.0 % [29-52] | 27.5 % [16-43] |
| rules | 66.3 % [56-75] | 56.9 % [45-68] | 67.5 % [52-80] |
| large | 62.1 % [52-71] | 32.3 % [22-44] | 10.0 % [4-23] |
| gen-8b | 61.1 % [51-70] | 50.8 % [39-63] | 35.0 % [22-50] |
| small | 2.1 % [1-7] | 0.0 % [0-6] | 0.0 % [0-9] |

The audit routes all three fields to gemini-flash. On tax it is measurably better than google-expense (12 of the 13
disagreements go to it). On total and subtotal the sample cannot tell the two apart, and the record says so.
At 1,000,000 documents a year and the prices below, the routing costs $4,290 instead of
$100,000. Those prices and that volume are declared, not measured.

## How each file was made

**`cord-labels-grouped.csv`**: one row per receipt, in the case-file format of `npm run measure:yours`.
- The expected values come from CORD's own labels: `total.total_price`, `sub_total.subtotal_price` and
  `sub_total.tax_price`. They are written as plain numbers. The receipts print rupiah the Indonesian way, so
  "60.000" is sixty thousand. The header declares each field as `amount-grouped`, the grader's kind for that
  convention.
- A cell is empty when CORD has no such label, or labels it "-". CORD-TEST-099 prints two different taxes, so its
  tax is left empty rather than guessed. An empty cell is graded by nobody.
- The `text` column is what this repository's own OCR (`src/ocr.ts`, macOS Vision) read from each image, at the
  commit named above. The local tiers see only that text.

**`cord-google-outcomes.json`** and **`cord-google-values.json`**: Google Document AI, Expense Parser, region `us`, one
request per receipt image on 2026-09-29. The list price is $0.10 per count, and one count is a document of up to 10
pages; a receipt is one page, so it is declared here as $100 per 1,000 receipts. The source is the vendor's pricing
page, re-read on 2026-10-04 and carried as `google-document-ai-expense-parser` in `vendor-prices.json` (list price;
$0.09 and $0.08 per count under the 1-year and 3-year savings plans, which this run does not apply). The raw
responses weigh 311 MB and are not in the repository. The values file holds what the adapter reads
from each response: the first `total_amount`, `net_amount` and `total_tax_amount`. Grading the raw responses with
`--vendor=documentai --mapping=cord-mapping-docai.json`, or this values file with `--values`, gives the same verdict
on every case; that was checked.

**`cord-gemini-outcomes.json`** and **`cord-gemini-values.json`**: Gemini 3.8 Flash on Vertex AI, global endpoint, one
request per receipt image on 2026-09-29, temperature 0, a JSON schema with three nullable strings, and at most 1,024
output tokens. The prompt was:

> This is a photo of a shop receipt. Read three amounts from it, each exactly as printed on the receipt, digits and separators included: the total the customer pays, the subtotal, and the tax. Use null for any amount the receipt does not print.

CORD-TEST-056 hit the output ceiling and returned no usable answer, so it counts as blank on all three fields. The
cost, read from the usage metadata at the list price of that day, was $0.43 for the 100 receipts, declared here as
$4.29 per 1,000. The per-request token counts are not in the repository, so that figure cannot be recomputed from
it: it is declared, and the record marks it so.

**`cord-rules.json`**: the rules tier, one regular expression per field (the last amount on the line of its label).
Written once before the run and not tuned on its results.

## Run it again

The two grading commands write beside the CSV by default; `--out` points them at the committed files, which the
third command reads. `grade` refuses to overwrite a file that exists unless `--overwrite` is given.

```
npm run grade -- --cases=examples/cord-receipts/cord-labels-grouped.csv --name=google-expense \
    --values=examples/cord-receipts/cord-google-values.json --price-per-thousand-documents=100 \
    --out=examples/cord-receipts/cord-google-outcomes.json --overwrite
npm run grade -- --cases=examples/cord-receipts/cord-labels-grouped.csv --name=gemini-flash \
    --values=examples/cord-receipts/cord-gemini-values.json --price-per-thousand-documents=4.29 \
    --out=examples/cord-receipts/cord-gemini-outcomes.json --overwrite
npm run measure:yours -- --cases=examples/cord-receipts/cord-labels-grouped.csv \
    --sorties=examples/cord-receipts/cord-google-outcomes.json --sorties=examples/cord-receipts/cord-gemini-outcomes.json \
    --rules=examples/cord-receipts/cord-rules.json --llm --current=google-expense --margin=2 \
    --pages-per-document=1 --pages-per-year=1000000
```

The per-case verdicts come back identical to the committed files; only the grading date and the tool version in
the metadata move. The generative tiers need Ollama with qwen3 0.6b, 4b and 8b. Their accuracies on the same
commit should match the record; their timings depend on the machine. A vendor-only comparison needs no model
weights: add `--no-encoders` and drop `--llm`.

## What this sample cannot do

The 100 receipts separate the two vendors on tax (12 of 13 disagreements) and not on total (5 against 2, p = 0.45)
or subtotal (6 against 2, p = 0.29): two vendors three points apart on a field are not told apart by 100 pages.
CORD's test split has been public since 2022, so the vendors' models may have seen these receipts; the rates above
are what each vendor returns on them, not a guarantee on unseen pages. The local tiers read a text that this
repository's OCR (macOS Vision) produced from the images, so their rates include that OCR's errors; the two
vendors read the images themselves.

## The same receipts read by tesseract.js

The Vision text above exists only on macOS. On 4 October 2026 the same 100 images were read with
tesseract.js 7.0.0 (Apache-2.0, inside Node, on Linux, macOS and Windows), language files
tessdata_fast 4.1.0 `eng+ind` fetched once by `npm run tessdata -- --prime` and pinned by SHA-256,
with the network refused (`CASCADE_OFFLINE=1`) and the egress check watching: 403 samples over the
whole pass, no connection outside this machine. The record is `cord-labels-grouped-tesseract-measured.json`,
seal `1817f176853fc0e9`, signed (`.signature.json`, verified against `cle-publique.pem`), measured on a
working tree ahead of commit `10ef1b7` (the record says so). The vendors read the images, so their rates
do not move; the local tiers read the tesseract text. Cases with an expected value: total 95, subtotal 65,
tax 40, as above.

| Source | total | subtotal | tax |
|---|---|---|---|
| gemini-flash | 96.8 % [91-99] (pick) | 95.4 % [87-98] (pick) | 97.5 % [87-100] (pick) |
| google-expense | 93.7 % [87-97] | 89.2 % [79-95] | 70.0 % [55-82] |
| rules | 35.8 % [27-46] | 26.2 % [17-38] | 15.0 % [7-29] |
| large | 31.6 % [23-41] | 15.4 % [9-26] | 0.0 % [0-9] |
| small | 2.1 % [1-7] | 0.0 % [0-6] | 0.0 % [0-9] |

Against the Vision text, the rules tier falls from 66.3 % to 35.8 % on total, from 56.9 % to 26.2 % on
subtotal and from 67.5 % to 15.0 % on tax; `large` from 62.1 % to 31.6 %, from 32.3 % to 15.4 % and from
10.0 % to 0.0 %; `small` does not move. The routing and the saving are the same (all three fields to
gemini-flash, $95,710 a year at the declared prices and volume): the local tiers were not in the running on
either text. What this run does not carry: the generative tiers (`gen-0.6b`, `gen-4b`, `gen-8b`), because
Ollama was not running on the machine that measured; `npm run measure:yours -- --llm` on the same CSV adds
them. The files: `cord-labels-grouped-tesseract.csv` (the same labels, the text column from tesseract),
`cord-tesseract-google-outcomes.json` and `cord-tesseract-gemini-outcomes.json` (the vendors' values graded
against that CSV, identical verdicts), the record and its signature.

```
npm run tessdata -- --prime
npm run text-from-images -- --cases=examples/cord-receipts/cord-labels-grouped.csv --images=<folder of CORD-TEST-nnn.png> \
    --ocr=tesseract --lang=eng+ind --out=examples/cord-receipts/cord-labels-grouped-tesseract.csv --overwrite
npm run grade -- --cases=examples/cord-receipts/cord-labels-grouped-tesseract.csv --name=google-expense \
    --values=examples/cord-receipts/cord-google-values.json --price-per-thousand-documents=100 \
    --out=examples/cord-receipts/cord-tesseract-google-outcomes.json --overwrite
npm run grade -- --cases=examples/cord-receipts/cord-labels-grouped-tesseract.csv --name=gemini-flash \
    --values=examples/cord-receipts/cord-gemini-values.json --price-per-thousand-documents=4.29 \
    --out=examples/cord-receipts/cord-tesseract-gemini-outcomes.json --overwrite
npm run measure:yours -- --cases=examples/cord-receipts/cord-labels-grouped-tesseract.csv \
    --sorties=examples/cord-receipts/cord-tesseract-google-outcomes.json --sorties=examples/cord-receipts/cord-tesseract-gemini-outcomes.json \
    --rules=examples/cord-receipts/cord-rules.json --current=google-expense --margin=2 --pages-per-document=1 --pages-per-year=1000000
```

## Licence of this folder

The receipts' labels and the text read from their images come from CORD, which is released under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Every file in this folder that carries them
(`cord-labels-grouped.csv`, `cord-labels-grouped-tesseract.csv`, both values files) stays under CC BY 4.0, with this attribution:

> Park, Seunghyun, Seung Shin, Bado Lee, Junyeop Lee, Jaeheung Surh, Minjoon Seo and Hwalsuk Lee. "CORD: A
> Consolidated Receipt Dataset for Post-OCR Parsing." Document Intelligence Workshop at Neural Information
> Processing Systems, 2019.

The rest of the folder follows the repository's licence.
