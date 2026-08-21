# Malformed documents — 18 cases

**Count: 18.** Six kinds, three each: truncation (T1–T3), broken encoding
(E1–E3), OCR noise (O1–O3), absent field (M1–M3), duplicated field with
conflicting values (D1–D3), unusual order (R1–R3).

**Written 2026-08-21, before any measurement on this corpus.** No case was added,
dropped or re-graded after seeing a result.

**No real data.** Every document below is invented, including the damage. Any
resemblance to a real person or a real document is accident.

## What this file is for

The current corpus is clean. Documents that arrive are not: they are photographed
at an angle, cut off by a scanner bed, re-encoded twice by two systems that
disagreed about UTF-8, and filled in by someone who wrote the address in the
wrong box. A tier chosen on clean documents is chosen on a population that does
not exist.

## Blank beats wrong, and this file grades accordingly

§6 of the method treats a blank and a wrong value as different failures, and this
corpus is where that distinction earns its keep. Twelve of the eighteen cases
have **refusal as the correct answer** for at least one field — nineteen
field-cells in all. They are marked
**REFUSE** in the tables, and a tier that returns a plausible value there is
wrong — not partially right, not "close".

This is the grading decision most likely to be argued with, so it is stated
plainly: **a confident value recovered from damaged evidence is worse than a
blank**, because a blank routes to a reviewer and a wrong value does not. Where
the damage still leaves exactly one reading, the answer is that reading and
refusing is the failure. The two rules pull in opposite directions on purpose;
the cases below say which applies and why.

---

## Truncation

### T1 — cut mid-value, one reading survives

```
HELLENIC REPUBLIC — RESIDENCE PERMIT
Surname: KARAMANLI
Given name: NIKOLAOS
Date of birth: 03.11.19
```

| field | answer |
|---|---|
| full name | NIKOLAOS KARAMANLI |
| date of birth | **REFUSE** |
| document type | RESIDENCE PERMIT |
| country | HELLENIC REPUBLIC / Greece |
| address | **REFUSE** (absent, see M-series) |

**Why** — `03.11.19` could be a truncated `1900`–`1999` or a complete
two-digit-year date. Both readings are available and the document is cut, so the
value is unrecoverable rather than merely difficult. Returning `03.11.1919` or
`03.11.2019` is the expensive error. The name survives the cut intact and must
still be extracted: a tier that refuses the whole document because part of it is
damaged fails this case too, and that over-refusal is worth counting separately.

### T2 — cut mid-word, the word is recoverable

```
FRENCH REPUBLIC — CARTE NATIONALE D'IDENTIT
Nom: MOREA
Prénom: SYLVIE
Née le: 12/06/1980
Adresse: 8 rue des Lilas, 69003 LY
```

| field | answer |
|---|---|
| full name | SYLVIE MOREA |
| date of birth | 12/06/1980 |
| document type | CARTE NATIONALE D'IDENTIT | *accepted:* carte nationale d'identité / national identity card |
| country | FRENCH REPUBLIC / France |
| address | **REFUSE** |

**Why** — three truncations with three different verdicts, which is the point of
the case. The document type is missing one letter and has exactly one reading, so
completing it is correct. The surname `MOREA` may be complete or may be a cut
`MOREAU`, `MOREAS`, `MOREAULT` — but nothing marks it as cut, so it is taken
verbatim; inventing the `U` is the error. The address ends `69003 LY`, which is
visibly cut and has several completions (`LYON` is likely, not certain), so it
refuses. A tier that completes the address but not the document type has the rule
backwards.

### T3 — cut before the field list begins

```
REPUBLIC OF BULGARIA
IDENTITY CARD
Document no.: BG-4417
```

| field | answer |
|---|---|
| full name | **REFUSE** |
| date of birth | **REFUSE** |
| document type | IDENTITY CARD |
| country | REPUBLIC OF BULGARIA / Bulgaria |
| address | **REFUSE** |

**Why** — the degenerate case, and it is in the file to catch the opposite
failure from T1. Three fields are genuinely absent and two are present. A tier
that returns five blanks has failed twice; a tier that hallucinates a name from
the document number has failed expensively. The expected blank/wrong split on
this single case is 3 blanks and 2 values, and any other shape is an error.

---

## Broken encoding

### E1 — UTF-8 read as Latin-1, once

```
PORTUGUESE REPUBLIC â€” CARTÃƒO DE CIDADÃƒO
Nome: JoÃ£o SimÃµes
Data de nascimento: 27/03/1972
Morada: Rua das AmendoeiraÃ¬ 14, Ã‰vora
```

| field | answer |
|---|---|
| full name | João Simões |
| date of birth | 27/03/1972 |
| document type | CARTÃO DE CIDADÃO | *accepted:* citizen card |
| country | PORTUGUESE REPUBLIC / Portugal |
| address | **REFUSE** |

**Why** — classic mojibake, and it is deterministic: `Ã£` is `ã`, `Ãµ` is `õ`,
`Ã‰` is `É`. Where the mangling is reversible, the repaired value is the answer,
because there is exactly one reading — this is damage, not ambiguity. The address
refuses on a different ground: `AmendoeiraÃ¬` decodes to `Amendoeirà`, which is
not a Portuguese word form, so the mangling there is not a clean single pass and
the original cannot be recovered with confidence. One document, both verdicts.

### E2 — double-encoded, not recoverable in one pass

```
ESPAÃƒÂ‘A â€” DOCUMENTO NACIONAL DE IDENTIDAD
Apellidos: MuÃƒÂ±oz Iglesias
Nombre: RaÃƒÂºl
Fecha de nacimiento: 15/08/1990
```

| field | answer |
|---|---|
| full name | Raúl Muñoz Iglesias |
| date of birth | 15/08/1990 |
| document type | DOCUMENTO NACIONAL DE IDENTIDAD | *accepted:* national identity document |
| country | ESPAÑA / Spain |
| address | **REFUSE** (absent) |

**Why** — the same corruption applied twice: `ÃƒÂ±` is `ñ` after two passes.
It is still deterministic, so it is still repairable and refusal is still wrong —
this case exists to test whether a tier stops after one pass and returns
`MuÃ±oz`, which is a wrong value dressed as a partial success. Against E1 it
separates "can decode mojibake" from "can tell how many times it was applied".

### E3 — mojibake that produces a plausible different word

```
NORWAY — PASS
Etternavn: SÃ˜RENSEN
Fornavn: BJÃ˜RN
FÃ¸dselsdato: 04.02.1968
Adresse: StorgatÃ¦ 3, Bergen
```

| field | answer |
|---|---|
| full name | BJØRN SØRENSEN |
| date of birth | 04.02.1968 |
| document type | PASS | *accepted:* passport |
| country | NORWAY |
| address | **REFUSE** |

**Why** — the name decodes cleanly and is the answer. The address does not:
`StorgatÃ¦` decodes to `Storgatæ`, and the plausible intended street is
`Storgata` — a one-letter difference that a helpful tier will make and that is
not supported by the bytes. Refusing is correct. This is the sharpest test in the
E-series of the rule at the top of the file, because the "repaired" value looks
more right than the blank does.

---

## OCR noise

### O1 — digit/letter confusion in a date

```
IRELAND — DRIVING LICENCE
Name: CIARA O'BRlEN
Date of birth: l5 JAN 197O
Address: 4 Marlborough Terrace, Galway
```

| field | answer |
|---|---|
| full name | CIARA O'BRIEN |
| date of birth | 15 JAN 1970 |
| document type | DRIVING LICENCE |
| country | IRELAND |
| address | 4 Marlborough Terrace, Galway |

**Why** — nothing here refuses. `O'BRlEN` has a lowercase `l` where `I` belongs;
`l5` is `15` because `l5` is not a number; `197O` is `1970` because `197O` is not
a year. Each has exactly one valid reading under a constraint the field already
carries, so recovery is correct and refusal is over-caution. This case is in the
file to keep the R-series honest: a tier tuned to refuse whenever it sees noise
will fail here, and that cost must be visible.

### O2 — rn/m in a street name, no constraint to resolve it

```
NETHERLANDS — IDENTITEITSKAART
Naam: PIETER VAN DIJK
Geboortedatum: 19-09-1985
Adres: Darnstraat 22, Utrecht
```

| field | answer |
|---|---|
| full name | PIETER VAN DIJK |
| date of birth | 19-09-1985 |
| document type | IDENTITEITSKAART | *accepted:* identity card |
| country | NETHERLANDS |
| address | Darnstraat 22, Utrecht |

**Why** — `Darnstraat` may be an OCR rendering of `Damstraat`, or it may be
`Darnstraat`. Unlike O1 there is **no constraint** that rules one out: both are
well-formed street names. The verdict is **verbatim, not refusal** — the string is
readable and unambiguous as characters, and the doubt is about the world rather
than about the document. Copying what is written is the correct behaviour, and
"correcting" it to `Damstraat` is the error. This is the boundary case between
this file and `cas-ambigus.md`, and it stays here because only one answer is
defensible: what the document says.

### O3 — noise that destroys the value

```
CYPRUS — ΤΑΥΤΟΤΗΤΑ / IDENTITY CARD
Name: A_DR__S CH_IST_DOU
Date of birth: 2?/1?/19?4
Address: 15 Makarios Ave, Nicosia
```

| field | answer |
|---|---|
| full name | **REFUSE** |
| date of birth | **REFUSE** |
| document type | IDENTITY CARD | *accepted:* ΤΑΥΤΟΤΗΤΑ |
| country | CYPRUS |
| address | 15 Makarios Ave, Nicosia |

**Why** — the noise has removed information rather than substituted it.
`A_DR__S` is consistent with `ANDREAS`, `AUDRIS`, and others; `2?/1?/19?4` has
hundreds of readings. Both refuse. Two fields are undamaged and must still be
returned — the same over-refusal check as T1, applied to a document where most of
the damage is real.

---

## Absent field

### M1 — no address, and no marker saying so

```
GERMANY — REISEPASS
Name: HANNA WEBER
Geburtsdatum: 11.04.1993
Ausstellungsort: Hamburg
```

| field | answer |
|---|---|
| full name | HANNA WEBER |
| date of birth | 11.04.1993 |
| document type | REISEPASS | *accepted:* passport |
| country | GERMANY |
| address | **REFUSE** |

**Why** — German passports do not carry an address, so the field is legitimately
absent. `Hamburg` is a place of issue and returning it as the address is the
error this case is built around. The bait is deliberate and single: one
address-shaped string, in the wrong field.

### M2 — field label present, value empty

```
LATVIA — PERSONAS APLIECĪBA
Vārds, uzvārds: ILZE BĒRZIŅA
Dzimšanas datums:
Adrese: Brīvības iela 40-12, Rīga
```

| field | answer |
|---|---|
| full name | ILZE BĒRZIŅA |
| date of birth | **REFUSE** |
| document type | PERSONAS APLIECĪBA | *accepted:* identity card |
| country | LATVIA |
| address | Brīvības iela 40-12, Rīga |

**Why** — the label is printed and the value is not. Against M1 this separates
"the field does not exist on this document type" from "the field exists and was
left blank" — different causes, same correct answer, and a tier may handle one
and not the other. The address contains a hyphenated flat number (`40-12`) which
must be kept whole; splitting it is a wrong value.

### M3 — every field absent except one

```
SCANNED DOCUMENT — PAGE 2 OF 2
Address: 77 Camden High Street, London NW1
```

| field | answer |
|---|---|
| full name | **REFUSE** |
| date of birth | **REFUSE** |
| document type | **REFUSE** |
| country | **REFUSE** |
| address | 77 Camden High Street, London NW1 |

**Why** — four refusals and one value, and the country is the trap. `London NW1`
makes the United Kingdom obvious to any reader, and it is still the wrong answer:
the country field asks what the document says, and this fragment says nothing.
Inferring it is the single most tempting error in the whole file. If a client
wants inference, that is a different field with a different name, and the
distinction should be made before the measurement rather than after.

---

## Duplicated field, conflicting values

### D1 — two dates of birth, one document

```
ALBANIA — LETËRNJOFTIM
Emri: ARDIT HOXHA
Datëlindja: 06.02.1994
...
Data e lindjes: 06.02.1949
Adresa: Rruga e Durrësit 118, Tiranë
```

| field | answer |
|---|---|
| full name | ARDIT HOXHA |
| date of birth | **REFUSE** |
| document type | LETËRNJOFTIM | *accepted:* identity card |
| country | ALBANIA |
| address | Rruga e Durrësit 118, Tiranë |

**Why** — two labels, two values, no rule in the document for which governs.
`1994` and `1949` are a plausible transposition, which makes it tempting to pick
the first, or the more recent, or the one that looks less like a typo. All three
heuristics are inventions. **Refusal is correct, and a value plus a note is not a
refusal** — if the chain has a "flag for review" channel this is the case for it,
and if it does not, the blank is the channel.

### D2 — two addresses, both current-looking

```
ITALY — CARTA D'IDENTITÀ
Cognome e nome: GIULIA RINALDI
Data di nascita: 23/07/1989
Residenza: Via Cavour 8, Firenze
Indirizzo: Via Cavour 80, Firenze
```

| field | answer |
|---|---|
| full name | GIULIA RINALDI |
| date of birth | 23/07/1989 |
| document type | CARTA D'IDENTITÀ | *accepted:* identity card |
| country | ITALY |
| address | **REFUSE** |

**Why** — `8` and `80` on the same street. The two labels (`Residenza`,
`Indirizzo`) are near-synonyms in ordinary use, so neither outranks the other,
and the difference is exactly the kind a scanner introduces. Against D1 this
tests the same rule on a field where the values are similar rather than
transposed — a tier that refuses D1 and answers D2 is using value distance as its
criterion, which is not a rule anyone declared.

### D3 — duplicated field, values agree

```
POLAND — DOWÓD OSOBISTY
Nazwisko: NOWAK
Imię: KATARZYNA
Data urodzenia: 30.05.1977
Data ur.: 30.05.1977
Adres: ul. Piękna 5/3, Warszawa
```

| field | answer |
|---|---|
| full name | KATARZYNA NOWAK |
| date of birth | 30.05.1977 |
| document type | DOWÓD OSOBISTY | *accepted:* identity card |
| country | POLAND |
| address | ul. Piękna 5/3, Warszawa |

**Why** — duplication without conflict, and the answer is the value. This case is
the control for D1 and D2: a tier that refuses whenever it sees a repeated label
will fail here, and without this case that over-refusal would look like caution
rather than a defect. Three cases, two refusals, one value — a tier scoring 3/3
on the D-series has understood the rule, and a tier scoring 2/3 tells you
immediately which way it errs.

---

## Unusual order

### R1 — fields in reverse

```
ROMANIA — CARTE DE IDENTITATE
Str. Victoriei 21, Cluj-Napoca
14.12.1981
POPESCU ANDREI
```

| field | answer |
|---|---|
| full name | POPESCU ANDREI |
| date of birth | 14.12.1981 |
| document type | CARTE DE IDENTITATE | *accepted:* identity card |
| country | ROMANIA |
| address | Str. Victoriei 21, Cluj-Napoca |

**Why** — no labels and no conventional order. Every value is unambiguous by its
own shape: a date looks like a date, a street looks like a street. Nothing
refuses. This case exists to catch positional extraction — a tier that assumes
"first line after the header is the name" gets the address, and the error is
total rather than partial, which makes it easy to spot and easy to attribute.

### R2 — interleaved with unrelated content

```
APPLICATION FORM — ANNEX B
Reference: AX-9931
Country of issue: FINLAND
Notes: file transferred from regional office
Applicant: MIKKO HEIKKINEN
Processing fee: 45.00 EUR
Document applied for: RESIDENCE PERMIT
Date of birth of applicant: 02.10.1996
Previous address (do not use): Koulukatu 3, Tampere
Current address: Hämeenkatu 17 A 4, Tampere
```

| field | answer |
|---|---|
| full name | MIKKO HEIKKINEN |
| date of birth | 02.10.1996 |
| document type | RESIDENCE PERMIT |
| country | FINLAND |
| address | Hämeenkatu 17 A 4, Tampere |

**Why** — the five fields are present, scattered, and surrounded by
similar-looking values. The reference number and the fee are date-and-number
shaped; the previous address is address-shaped and explicitly marked not to be
used. Nothing refuses — every field has one supported answer — and the failure
mode is picking a neighbour. Note this is also a document *about* a document,
which is why `document type` is what was applied for rather than "application
form"; that reading is declared here because it is arguable.

### R3 — values before their labels

```
SLOVENIA
MARJETA KOVAČ — ime in priimek
28.03.1975 — datum rojstva
OSEBNA IZKAZNICA — vrsta dokumenta
Trg republike 3, Ljubljana — naslov
```

| field | answer |
|---|---|
| full name | MARJETA KOVAČ |
| date of birth | 28.03.1975 |
| document type | OSEBNA IZKAZNICA | *accepted:* identity card |
| country | SLOVENIA |
| address | Trg republike 3, Ljubljana |

**Why** — labels exist but follow their values, which breaks any extractor
matching "label, colon, value". Against R1 (no labels) and R2 (labels in place,
buried in noise), this completes a three-point spread on label handling, so a
failure across all three means positional parsing and a failure on R3 alone means
a rigid pattern.

---

## How to grade this file

**Count refusals as a separate outcome.** Twelve cases carry at least one
**REFUSE**; nineteen field-cells across the file are refusals. A tier that never
refuses cannot score above the ceiling those cells impose, and a tier that always
refuses fails O1, D3, R1 and the intact fields of T1, T3 and O3. Report the two
error kinds separately per §6 or this file measures nothing it was built for.

**Expected shape of a correct run:** 18 cases × 5 fields = 90 cells, of which 19
are refusals and 71 are values, distributed T:6 E:3 O:2 M:6 D:2 R:0. A run
reporting a different total has dropped cells; a run whose refusal count is far
from 19 has a systematic bias worth naming before its accuracy is read. The
R-series carries no refusals at all, which makes it the cleanest check on
over-refusal in the file.

**Grade the accepted alternatives as stated.** Many document-type cells accept
both the document's own words and an English category. That leniency is chosen,
it is not symmetric with the name and address fields, and it should be applied
identically across tiers or the comparison is void.

**Do not fold this file into an overall accuracy.** Malformed-document accuracy
and clean-document accuracy are two numbers about two populations. The mix of the
two that a client actually receives is an **assumed** input, and it belongs in
the §7 sweep rather than baked into a single headline rate.
