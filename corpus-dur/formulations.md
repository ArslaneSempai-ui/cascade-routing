# Prompt formulations — 20

**Count: 20.** F1 is the base. F2–F19 are eighteen variants, each differing from
F1 in **exactly one** named respect. F20 is a maximal anchor and changes many at
once, which is declared rather than hidden.

**Written 2026-08-21, before any measurement on this corpus.** Nothing here was
chosen after seeing a result. This matters more than it looks: a formulation set
assembled after the first run selects itself for the answer you wanted, and that
is the first retraction the log would ever have to carry.

**No real data.** Every document, name, address and number quoted below is
invented. Any resemblance to a real person or a real document is accident.

## Why one axis at a time

The purpose is not to find the best prompt. It is to answer the question that
governs everything else in the method: **does re-wording move the result as much
as changing tier?** If it does, tier comparison is measuring the wrong axis.

A set of twenty unrelated prompts answers "yes, wording matters" and nothing
more. You would know the prompt counts, without knowing what to fix. So each
variant names its parent and its single changed axis, and the entry says what a
failure would mean. When F8 fails and F1 does not, the cause is the output-format
instruction — not "the prompt".

## The axes

| Axis | Values | Varied in |
|---|---|---|
| A — length | terse / medium / verbose | F2, F3 |
| B — mood | imperative / descriptive / interrogative | F4, F5 |
| C — examples | none / one / three | F6, F7 |
| D — output format | none / named keys / strict JSON only | F8, F9 |
| E — missing-field rule | none / leave empty / null and do not guess | F10, F11 |
| F — presentation | prose / numbered list / table | F12, F13 |
| G — role framing | absent / present | F14 |
| H — field order | canonical / reversed | F15 |
| I — field naming | plain / abbreviated | F16 |
| J — negative constraints | absent / present | F17 |
| K — instruction language | English / Greek / French | F18, F19 |

The five fields, in canonical order, are **full name, date of birth, document
type, country, address**. `{document}` marks where the document text is inserted.

---

## F1 — base

*Parent: none. This is the reference every other formulation is measured
against.* Medium length, imperative, no example, no output format, no
missing-field rule, prose field list, no role, canonical order, plain field
names, no negative constraints, English.

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Document:
{document}
```

**If F1 itself is unstable across reruns**, stop. Every comparison below is
against F1, and a moving reference makes all nineteen differences unreadable.

## F2 — terse

*Parent: F1. Axis A (length): medium → terse.*

```
Extract: full name, date of birth, document type, country, address.

{document}
```

**A failure here and not in F1** says the model needed the sentence frame, not
the field list — the task was under-specified rather than mis-specified. Watch
for output that is a bare list of values with no field labels, which is a
formatting failure masquerading as an extraction failure.

## F3 — verbose

*Parent: F1. Axis A (length): medium → verbose.*

```
You will be given the text of an identity or travel document. Your task is to
read it and report five specific pieces of information that such documents
normally contain. The first is the full name of the person the document belongs
to. The second is that person's date of birth. The third is the type of the
document itself — for example a passport, an identity card, a residence permit,
or a driving licence. The fourth is the country associated with the document.
The fifth is the address recorded on it. Read the whole document before
answering, and report each of the five in turn.

Document:
{document}
```

**A failure here and not in F1** is the more interesting direction: it says
elaboration hurt. Two mechanisms to separate — the examples inside the prose
("a passport, an identity card…") may be anchoring the answer, and "the country
associated with the document" is vaguer than "country", which is a content
change smuggled in by length. If F3 degrades, check which of the two before
concluding that verbosity is the cause.

## F4 — descriptive

*Parent: F1. Axis B (mood): imperative → descriptive.*

```
The task is the extraction of five fields from the document below: full name,
date of birth, document type, country, and address. The output is the value of
each of those five fields.

Document:
{document}
```

**A failure here and not in F1** says the instruction needed to be an
instruction. Typical symptom: the model describes the task back, or comments on
the document, instead of extracting.

## F5 — interrogative

*Parent: F1. Axis B (mood): imperative → interrogative.*

```
What are the full name, date of birth, document type, country, and address in
the document below?

Document:
{document}
```

**A failure here and not in F1** is usually conversational drift — a
prose answer, hedging, or a refusal to commit. Distinguish from F4: F4 tests
whether a command is needed, F5 tests whether a question invites discussion.

## F6 — one example

*Parent: F1. Axis C (examples): none → one.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Example
Document: "HELLENIC REPUBLIC — IDENTITY CARD. Surname: VOULGARI. Given name:
DESPINA. Born: 12.07.1988. Residence: Nikis 8, Thessaloniki."
full name: DESPINA VOULGARI
date of birth: 12.07.1988
document type: identity card
country: Greece
address: Nikis 8, Thessaloniki

Document:
{document}
```

**A failure here and not in F1** means the example is teaching something you did
not intend. The example above carries at least four incidental decisions — given
name before surname, the date left in the document's own format, "identity card"
lower-cased, and Greece inferred from "Hellenic Republic" rather than copied.
Any of those can be imitated on a document where it is wrong. If F6 fails, name
which of the four was copied.

## F7 — three examples

*Parent: F1. Axis C (examples): none → three.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Example 1
Document: "HELLENIC REPUBLIC — IDENTITY CARD. Surname: VOULGARI. Given name:
DESPINA. Born: 12.07.1988. Residence: Nikis 8, Thessaloniki."
full name: DESPINA VOULGARI
date of birth: 12.07.1988
document type: identity card
country: Greece
address: Nikis 8, Thessaloniki

Example 2
Document: "REPUBLIC OF IRELAND — PASSPORT. Name: CIARAN O'DONOVAN. DOB:
30 NOV 1975. No fixed address recorded."
full name: CIARAN O'DONOVAN
date of birth: 30 NOV 1975
document type: passport
country: Ireland
address:

Example 3
Document: "PERMESSO DI SOGGIORNO. Cognome: FERRARO. Nome: LUCA. Data di
nascita: 04/09/2001. Indirizzo: Via Sannio 12, Roma."
full name: LUCA FERRARO
date of birth: 04/09/2001
document type: residence permit
country: Italy
address: Via Sannio 12, Roma

Document:
{document}
```

**A failure here and not in F6** separates "examples help" from "how many". A
failure in both, but not in F1, points at the examples themselves. Note that
Example 2 silently teaches a missing-field convention (empty) without stating
one, which is exactly the confound axis E exists to isolate — if F7 handles
absent fields well and F1 does not, the credit belongs to Example 2, not to
example-count.

## F8 — named output keys

*Parent: F1. Axis D (output format): none → named keys.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Report the result using these keys: name, date_of_birth, document_type,
country, address.

Document:
{document}
```

**A failure here and not in F1** is almost always parsing, not extraction: the
values are right and the shape is wrong. Score the two separately or this
formulation will be blamed for a scorer's strictness.

## F9 — strict JSON only

*Parent: F1. Axis D (output format): none → strict.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Return a single JSON object with exactly the keys name, date_of_birth,
document_type, country, address. Return nothing else — no explanation, no
code fence, no preamble.

Document:
{document}
```

**A failure here and not in F8** isolates strictness from structure. This is the
formulation most likely to fail for a reason that has nothing to do with the
document: a tier that cannot suppress a preamble fails every case identically.
That uniformity is the tell — a near-zero score with near-zero variance is a
format failure, not an accuracy one.

## F10 — missing field: leave empty

*Parent: F1. Axis E (missing-field rule): none → leave empty.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

If a field does not appear in the document, leave its value empty.

Document:
{document}
```

**A failure here and not in F1** would be surprising and worth investigating
directly. The interesting comparison is not failure but the *shape* of failure:
this formulation should shift errors from wrong toward blank, which §6 of the
method treats as a different and cheaper kind of error. Report the blank/wrong
split for F1, F10 and F11 side by side — that comparison is the point of the
axis.

## F11 — missing field: null, and do not guess

*Parent: F1. Axis E (missing-field rule): none → null and do not guess.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

If a field does not appear in the document, return null for it. Do not infer or
reconstruct a value that is not written in the document.

Document:
{document}
```

**Against F10**, this separates permission to be silent ("leave empty") from
prohibition on inference ("do not guess"). A tier that improves under F10 but
not F11 is not abstaining — it is formatting. A tier that improves under F11 and
not F10 was inventing values and has stopped. Those are opposite findings and
the two formulations exist to tell them apart.

## F12 — numbered list

*Parent: F1. Axis F (presentation): prose → numbered list.*

```
Extract the following from the document below:

1. full name
2. date of birth
3. document type
4. country
5. address

Document:
{document}
```

**A failure here and not in F1** is rare enough to be worth a second look before
believing it; the more likely observation is a change in output shape, with the
model numbering its answers. If the scorer is position-sensitive, that shape
change alone will register as an accuracy change, which is a scorer defect
surfacing as a prompt effect.

## F13 — table

*Parent: F1. Axis F (presentation): prose → table.*

```
Fill in the value column from the document below.

| field          | value |
|----------------|-------|
| full name      |       |
| date of birth  |       |
| document type  |       |
| country        |       |
| address        |       |

Document:
{document}
```

**Against F12**, this separates enumeration from tabulation. A table also
supplies an implicit output format without saying so, which makes F13 partly an
axis-D variant — declared here rather than discovered later. If F13 and F8 move
together, that shared format effect is the explanation.

## F14 — role framing

*Parent: F1. Axis G (role): absent → present.*

```
You are a document analyst who reads identity and travel documents and records
what they contain.

Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Document:
{document}
```

**A failure here and not in F1** would say the persona changed behaviour, and
the direction matters: a "document analyst" may become more cautious about
partial evidence, which improves the wrong/blank split while lowering raw
accuracy. Read this one against §6 rather than against the headline rate.

## F15 — reversed field order

*Parent: F1. Axis H (order): canonical → reversed.*

```
Extract these five fields from the document below: address, country, document
type, date of birth, and full name.

Document:
{document}
```

**A difference here at all** is the finding — it means the field list's order
carries information it should not, and every per-field rate measured under the
canonical order inherits an artefact. This is the cheapest formulation in the
set and potentially the most damaging one.

## F16 — abbreviated field names

*Parent: F1. Axis I (naming): plain → abbreviated.*

```
Extract these five fields from the document below: name, dob, doc_type, ctry,
addr.

Document:
{document}
```

**A failure here and not in F1** localises to whichever abbreviation was not
understood, and the per-field rates say which: `ctry` and `doc_type` are the
likely casualties, `dob` the likely survivor. This is the one formulation whose
failure should be read per field rather than in aggregate.

## F17 — negative constraints

*Parent: F1. Axis J (negative constraints): absent → present.*

```
Extract these five fields from the document below: full name, date of birth,
document type, country, and address.

Do not translate any value. Do not reformat dates. Do not correct spelling.
Report each value exactly as it appears in the document.

Document:
{document}
```

**A failure here and not in F1** most likely means the scorer and the prompt now
disagree: if the scorer normalises dates and the prompt forbids reformatting,
the tier is punished for obedience. Before recording a failure, check which of
the two changed. This formulation is also the direct partner of the non-Latin
corpus, where "do not translate" is the whole question.

## F18 — instruction in Greek

*Parent: F1. Axis K (instruction language): English → Greek.*

```
Εξαγάγετε τα εξής πέντε πεδία από το παρακάτω έγγραφο: ονοματεπώνυμο,
ημερομηνία γέννησης, τύπος εγγράφου, χώρα και διεύθυνση.

Έγγραφο:
{document}
```

**A failure here and not in F1** is not one finding but two, and they must be
separated: the tier may have understood the instruction and answered in Greek
(a scoring problem), or not understood it (an extraction problem). Record the
language of the output alongside the score, or this formulation is
uninterpretable. It is in the set because the documents that actually arrive are
read by people working in Greek.

## F19 — instruction in French

*Parent: F1. Axis K (instruction language): English → French.*

```
Extrayez les cinq champs suivants du document ci-dessous : nom complet, date de
naissance, type de document, pays et adresse.

Document :
{document}
```

**Against F18**, this separates "a non-English instruction" from "Greek
specifically". If F19 holds and F18 falls, the cause is script or training
coverage rather than instruction language. Same recording rule: log the output
language.

## F20 — maximal anchor

*Parent: F1. **Changes ten axes at once**, deliberately. This is not a
one-at-a-time variant and must never be read as one.*

```
You are a document analyst who reads identity and travel documents and records
what they contain.

You will be given the text of such a document. Read all of it before answering.
Report the following, in this order:

1. full name — the person's name as written on the document
2. date of birth — the date the document gives for the person's birth
3. document type — passport, identity card, residence permit, driving licence,
   or whatever else the document declares itself to be
4. country — the country the document is associated with
5. address — the address recorded on the document

Example
Document: "HELLENIC REPUBLIC — IDENTITY CARD. Surname: VOULGARI. Given name:
DESPINA. Born: 12.07.1988. Residence: Nikis 8, Thessaloniki."
{"name": "DESPINA VOULGARI", "date_of_birth": "12.07.1988",
 "document_type": "identity card", "country": "Greece",
 "address": "Nikis 8, Thessaloniki"}

If a field does not appear in the document, return null for it. Do not infer or
reconstruct a value that is not written in the document. Do not translate any
value. Do not reformat dates. Do not correct spelling.

Return a single JSON object with exactly the keys name, date_of_birth,
document_type, country, address. Return nothing else.

Document:
{document}
```

**What this one is for.** F2 is the floor and F20 is the ceiling: together they
bracket how far the whole axis space can move a tier. The gap between them is the
number that answers "does wording move the result as much as changing tier?" —
and it is the only number in this file that a single comparison produces.

**What it cannot do.** If F20 fails, nothing here says why. Ten axes moved. Its
failure sends you back to F2–F19 and buys nothing on its own, which is the
standing price of an anchor.

---

## How to read the results

**The headline comparison** is the spread across F1–F19 for one tier, against the
spread across tiers for F1. If the first is comparable to the second, tier
comparison under a single formulation is measuring the prompt, and §7 of the
method should treat the formulation as an assumption to be swept rather than as
part of the apparatus.

**Report per field, not only per formulation.** F16 predicts a country-and-type
failure with an intact date; F17 predicts a date failure and nothing else. Those
predictions are testable and an aggregate rate hides both.

**Report the blank/wrong split for every formulation**, per §6. Axis E exists
entirely to move that split, and a formulation that trades wrong answers for
blank ones has improved the chain even when its accuracy is unchanged.

**Count what ran.** Twenty formulations times the tier set times the case set: if
the number of results is not exactly that product, some cell failed silently, and
a missing cell reads as an absent finding rather than as an error.
