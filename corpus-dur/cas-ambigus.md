# Genuinely ambiguous cases — 14

**Count: 14.** Every case carries **at least two defensible answers**, each one
justified below. A case with a single confident answer is not ambiguous and is
not in this file.

**Written 2026-08-21, before any measurement on this corpus.** No case, and no
list of accepted readings, was added or widened after seeing a result. Widening
an accepted-reading list after a run is how a corpus is quietly tuned to flatter
a tier, and it would be the first thing to disclose if it ever happened.

**No real data.** Every document below is invented. Any resemblance to a real
person or a real document is accident.

## Why this file exists, and why it is the dangerous one

A case where the truth is contestable, recorded with one confident answer,
**poisons the measurement**. The tier that picks the other reading is marked
wrong for being right, and the penalty lands on whichever tier happens to
disagree with whoever wrote the key. That is not noise — it is a bias with a
direction, and it favours tiers that share the key-writer's habits.

So the rule here is inverted from the rest of the corpus: **every listed reading
scores as correct**. A reading not listed is wrong. If a tier produces a
defensible reading that is not listed, that is a defect in this file, and the fix
is to add it *and say when it was added*.

## The test for admission

Two readings, each defensible in a sentence, without appeal to the tier's
convenience. If a second reading cannot be justified, the case is not ambiguous —
it is merely hard, and it belongs in `documents-malformes.md`. Ten cases failed
this test while this file was being written; they are listed at the end, with the
reason each was moved. That list is not an appendix. It is the argument that the
fourteen above it are real.

---

### AM1 — a date with no convention stated

```
INTERNATIONAL DELIVERY MANIFEST — ANNEX
Consignee: R. OKONKWO
Date of birth: 03/04/1990
```

**Why ambiguous** — the document states no date convention and carries no other
date to calibrate against. Both components are ≤ 12.

**Defensible readings**
- `3 April 1990` — day/month/year, the convention across most of Europe and the
  document's likely origin.
- `4 March 1990` — month/day/year, the United States convention, and this is an
  international manifest.

**Not defensible** — `1990-03-04` reported as a normalised date without saying
which reading it encodes. It looks like an answer and is a coin toss with the
evidence hidden.

**Preferred outcome** — a tier that returns the string verbatim, or refuses, is
doing better than one that picks. If the chain has a flag-for-review channel,
this is what it is for.

### AM2 — several surnames, no marker

```
BRAZIL — CARTEIRA DE IDENTIDADE
Nome: MARIA CARMEN DA SILVA SANTOS
Data de nascimento: 18/11/1984
```

**Why ambiguous** — Portuguese-language naming commonly carries two family names,
maternal before paternal, and `MARIA CARMEN` is a common compound given name. The
document marks no boundary.

**Defensible readings** — for a `full name` field, `MARIA CARMEN DA SILVA
SANTOS` verbatim is correct and unambiguous. The ambiguity bites only if the
field is split:
- given `MARIA CARMEN`, family `DA SILVA SANTOS`
- given `MARIA`, family `CARMEN DA SILVA SANTOS`
- given `MARIA CARMEN DA SILVA`, family `SANTOS` — a single-surname reading, with
  `DA SILVA` treated as part of the given names.

**How to score** — if the chain extracts `full name` whole, score verbatim only
and this case is easy. It is in this file because the moment anyone asks for a
surname column, three readings open at once, and that request usually arrives
after the corpus is frozen.

### AM3 — two lines that may be two addresses

```
UNITED KINGDOM — UTILITY CORRESPONDENCE
Name: DECLAN FAIRWEATHER
D.O.B.: 22.06.1979
Address: 14 Bridge Street
         Ashford Mill, Kent TN23
```

**Why ambiguous** — `Ashford Mill` can be read as a locality on the second line
of one address, or as the name of a separate property. Line breaks in addresses
carry no reliable structure.

**Defensible readings**
- one address: `14 Bridge Street, Ashford Mill, Kent TN23`
- two addresses, of which the postal one is `Ashford Mill, Kent TN23` and
  `14 Bridge Street` is a sub-premise.

**Note** — the second reading is weaker than the first, and it is still
defensible, which is the standard this file uses. A reading being less likely is
not the same as being wrong, and the accuracy interval of §3 is the wrong
instrument for the difference.

### AM4 — the first of January

```
GREECE — ΑΙΤΗΣΗ ΑΣΥΛΟΥ / ASYLUM APPLICATION
Applicant: SAMUEL TEKLE
Date of birth: 01/01/1990
Address: reception centre, Lesvos
```

**Why ambiguous** — `01/01` is the placeholder convention when only a birth year
is known, and it is also a real birth date carried by real people. The document
does not say which this is.

**Defensible readings**
- `1 January 1990` — verbatim, the value the document records.
- unknown day and month, year 1990 — the placeholder reading, and the one a
  caseworker would apply.

**Why it matters more than the others** — this is not a curiosity. In the
population these documents come from, the placeholder reading is common, and a
chain that treats every `01/01` as a real date will be confidently wrong at a
rate nobody measures. Neither reading may be assumed; which one governs is an
**assumed** input belonging to whoever is paying, and it should be swept per §7.

### AM5 — a two-digit year that could go either way

```
CANADA — HEALTH CARD (REPLACEMENT SLIP)
Holder: J. TREMBLAY
Born: 15.03.25
```

**Why ambiguous** — `25` could be `1925` or `2025`. Unlike a truncated date the
field is complete: two digits is the format, not damage.

**Defensible readings**
- `15 March 1925`
- `15 March 2025`

**Not defensible** — resolving it by plausibility ("nobody is 101") is an
inference from outside the document, and it is wrong often enough to matter on a
document type that is issued to newborns. A tier that returns `15.03.25` verbatim
satisfies both readings and is the best available answer.

### AM6 — the document calls itself two things

```
HELLENIC REPUBLIC
ΑΔΕΙΑ ΔΙΑΜΟΝΗΣ ΕΝΙΑΙΟΥ ΤΥΠΟΥ — RESIDENCE PERMIT
Serves as an identity document within the territory.
Holder: AMARA DIALLO
Date of birth: 09.09.1998
```

**Why ambiguous** — the document names itself a residence permit and states that
it functions as an identity document. Both descriptions are printed.

**Defensible readings**
- `residence permit` — what the document is titled.
- `identity document` — what the document says it serves as, printed with equal
  authority.

**How to score** — both. And note that the two readings route differently
downstream, which is the real cost: a chain that classifies this as an identity
document may apply rules that do not belong to it. That consequence is outside
this measurement and worth saying out loud anyway.

### AM7 — three countries, one field

```
IRELAND — PASSPORT
Surname: NOWAK
Given names: PIOTR
Date of birth: 12.05.1987
Place of birth: KRAKÓW, POLAND
Nationality: IRISH
```

**Why ambiguous** — the field is called `country` and the document offers three:
the issuing state, the nationality, and the country of birth. The field name does
not choose.

**Defensible readings**
- `IRELAND` — country of issue, the header of the document.
- `IRISH` / Ireland — nationality, the field explicitly labelled as such.
- `POLAND` — country of birth, if `country` is read as belonging with the
  person rather than with the document.

**The real finding** — this case says the field is under-specified in the method,
not that the document is unclear. `country` should be renamed before the next
audit. Until it is, all three score, and the per-tier distribution of which one
they pick is more informative than the accuracy number.

### AM8 — where the surname starts

```
NETHERLANDS — RIJBEWIJS
Naam: JOHANNES VAN DER MEULEN
Geboren: 03.08.1962
Adres: Prinsengracht 271, Amsterdam
```

**Why ambiguous** — the tussenvoegsel `van der` is part of the surname in
everyday use and is conventionally dropped for alphabetisation, so "the surname"
has two established answers in the same country.

**Defensible readings** (again, only if the field is split)
- family name `VAN DER MEULEN`
- family name `MEULEN`, with `van der` recorded separately

**Against AM2** — both are surname-boundary cases and they fail differently: AM2
is under-determined by the document, AM8 is over-determined by two conventions
that both exist. A tier may handle one and not the other.

### AM9 — one name, and nothing else

```
INDONESIA — KARTU TANDA PENDUDUK
Nama: SUHARTI
Tanggal lahir: 27.02.1971
Alamat: Jl. Melati 6, Yogyakarta
```

**Why ambiguous** — mononyms are ordinary in Indonesia. `SUHARTI` is the person's
entire name. But a `full name` field, and any consumer expecting two parts, has
to decide what the missing part is.

**Defensible readings**
- full name `SUHARTI`, and no surname exists — a blank in any surname field.
- full name `SUHARTI`, with `SUHARTI` repeated as the surname, which is what
  several official systems require.

**Not defensible** — refusing. The name is printed plainly and the document is
undamaged. This case is the counterweight to the refusal-heavy malformed file:
ambiguity about structure is not doubt about the value.

### AM10 — family name first, with no marker

```
REPUBLIC OF KOREA — 주민등록증
Name: KIM MIN JUN
Date of birth: 1994.06.30
```

**Why ambiguous** — `KIM` is a family name and appears first, which is the
convention. `JUN` is also a possible family name, and Latin-transliterated Korean
names are frequently reordered to given-name-first for international documents,
without any marker saying whether it has happened.

**Defensible readings**
- family `KIM`, given `MIN JUN` — the untouched convention.
- family `JUN`, given `KIM MIN` — the reordered reading, available because the
  document is in Latin script and may already have been reordered once.

**How to score** — the `full name` field takes the string verbatim and this is
easy. It is here for the same reason as AM2 and AM8: the ambiguity is dormant
until someone asks for the parts, and by then the corpus is frozen.

### AM11 — an address that may belong to someone else

```
GERMANY — CORRESPONDENCE COPY
Name: ELIF YILMAZ
Geburtsdatum: 14.10.1990
Anschrift: c/o Kaya, Lindenstraße 22, 10969 Berlin
```

**Why ambiguous** — `c/o` marks the address as somebody else's, used for
delivery. Whether that is "the person's address" depends on what the field is
for.

**Defensible readings**
- `c/o Kaya, Lindenstraße 22, 10969 Berlin` — verbatim, including the care-of.
- `Lindenstraße 22, 10969 Berlin` — the address proper, with the care-of treated
  as routing rather than location.
- a blank — the person has no address of their own recorded here.

**Three readings**, and the third is the one a tier will almost never produce.
Its presence in the list is deliberate: refusing is defensible here and the
scoring should not punish it.

### AM12 — a number that may be a range

```
MALTA — IDENTITY CARD
Name: ANTOINE BORG
Date of birth: 05.01.1983
Address: 12-14 Triq San Pawl, Valletta
```

**Why ambiguous** — `12-14` reads as a building range in one convention and as
`building 12, flat 14` in another. Both are common on the same kind of street.

**Defensible readings**
- `12-14 Triq San Pawl, Valletta` verbatim — the safe answer, and it satisfies
  either interpretation.
- a structured reading that splits building and unit.

**Note** — this case is deliberately near the boundary. It stays because both
readings change the value in a structured output, not merely its formatting. If
the chain never structures the address, this case degenerates to a verbatim copy
and should be moved to the malformed file rather than left here inflating the
ambiguous count.

### AM13 — an explicitly approximate date

```
GREECE — REGISTRATION SLIP
Name: HASSAN OMAR
Date of birth: circa 1985
Address: not recorded
```

**Why ambiguous** — the document states its own uncertainty. There is no exact
date to extract, and there is a real value present.

**Defensible readings**
- `circa 1985` verbatim — the document's own words.
- `1985` — the year, with the qualifier dropped as metadata.
- a blank — no date of birth is recorded, only an estimate.

**Why the third is defensible** — if the field means "the person's date of
birth", the document does not contain one. Whether an estimate satisfies a date
field is a decision about the field, not about the document, and nobody has made
it. That is the same defect AM7 exposes from a different angle.

### AM14 — two names, both current

```
FRANCE — CARTE VITALE (RENEWAL NOTICE)
Nom d'usage: CLAIRE MERCIER
Nom de naissance: CLAIRE ROUSSEAU
Née le: 02.02.1988
```

**Why ambiguous** — French documents carry a birth name and a used name, both
official, both current, neither superseding the other.

**Defensible readings**
- `CLAIRE MERCIER` — the used name, which is what she is called.
- `CLAIRE ROUSSEAU` — the birth name, which is what the civil register holds.

**Against D1 of the malformed file** — that case has two conflicting dates and
refuses, this one has two names and accepts both. The difference is that D1's
conflict is an error and AM14's is a fact about the document. A tier that treats
them the same way is applying a rule that does not distinguish damage from
structure, and this pair is the test for it.

---

## Cases considered for this file and moved elsewhere

Ten. Each failed the two-defensible-readings test, and the reason is recorded
because the boundary is where this corpus is most easily corrupted — the
temptation is always to widen the ambiguous file until every failure is excused
by it.

**1. `l997` (OCR lowercase L for 1).** Only `1997` is a valid year; the other
reading is not a reading. → malformed, `O1`. *Hard, not ambiguous.*

**2. `Darnstraat` / `Damstraat` (rn/m).** Genuinely undecidable as a fact about
the world — but not as a fact about the document, which says `Darnstraat`
plainly. The verbatim rule gives exactly one answer. → malformed, `O2`. This one
was the closest call in the list, and the reason it moves is that the doubt is
about reality, not about the text.

**3. `Ã©` → `é`.** A deterministic decode with one output. → malformed, `E1`.
*The appearance of choice is an artefact of not knowing the encoding.*

**4. `13/04/1990`.** Looks like AM1, and is not: `13` cannot be a month, so
day/month is forced. → malformed, as a resolvable-by-constraint date. **This pair
is worth keeping side by side** — the difference between AM1 and this is one
digit, and it is the whole difference between ambiguous and merely awkward.

**5. `29/02/1991`.** Not a real date — 1991 is not a leap year. One correct
behaviour: refuse. → malformed. *An impossible value is an error, not a choice.*

**6. Duplicated field, values identical.** No conflict, therefore no readings to
weigh. → malformed, `D3`, where it serves as the over-refusal control.

**7. `ΆΝΝΑ` vs `ΑΝΝΑ` (accent present or stripped).** A normalisation question
with a policy already declared in the non-Latin file. → non-Latin script file.
*A declared policy removes ambiguity by construction; that is what declaring is
for.*

**8. `Athens` vs `Αθήνα`.** Transliteration, governed by the same declared
policy. → non-Latin script file. *If it had no policy it would be ambiguous —
which is an argument for the policy, not for the case.*

**9. Name printed in all capitals.** `MARIA` vs `Maria` is presentation. The
verbatim rule answers it. → not a case at all; a scorer setting.

**10. Field entirely absent.** Tempting, because "what should it return?" feels
open. It is not: §6 answers it, and the answer is a blank. → malformed, `M`
series. *A question the method already answers is not an ambiguity.*

**What the list shows.** Eight of the ten were resolved by a rule that already
existed — verbatim extraction, a declared transliteration policy, or §6's
blank-beats-wrong. Ambiguity shrinks as the declared rules grow, and the fourteen
that survived are the ones no existing rule reaches. Four of those fourteen
(AM2, AM8, AM10, AM12) are dormant: they are unambiguous while `full name` and
`address` stay whole, and they open the moment anyone asks for the parts.

---

## How to grade this file

**Every listed reading scores as correct.** A tier picking any of them is right.
This is the whole point, and a scorer that accepts only the first-listed reading
converts the file into the bias it was built to prevent.

**Report this file separately, always.** It is 14 cases out of a corpus, and
folding it into a headline rate makes the rate meaningless in both directions: a
tier is neither rewarded nor punished for a judgement that has no right answer.

**Report which reading each tier picked**, not just whether it was accepted.
The distribution is the finding — if the cheap tier and the expensive tier
consistently read `03/04/1990` differently, that is a real difference between
them that the accuracy number, by construction, reports as zero.

**Watch the dormant four.** AM2, AM8, AM10 and AM12 score as verbatim copies
today. If a surname or a structured address field is ever added, those four
change from easy to contested, and every historical rate that included them
becomes incomparable to the new one. Note the date the field changes.

**Expected shape:** 14 cases, 32 listed readings across them (ten cases with
two, four with three), and no case with fewer than two. A case that acquires a single reading has been quietly resolved
and belongs in another file; a case that acquires a reading after a measurement
must carry the date it was added.
