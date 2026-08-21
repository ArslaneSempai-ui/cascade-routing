# Non-Latin scripts — 12 cases

**Count: 12.** Greek 3 (G1–G3), Arabic 3 (A1–A3), Cyrillic 3 (C1–C3),
ideographic 2 (I1–I2), mixed-script 1 (M1).

**Written 2026-08-21, before any measurement on this corpus.** No case here was
added, removed or reworded after seeing a result.

**No real data.** Every name, number, address and document below is invented,
including the ones that look ordinary. Any resemblance to a real person or a real
document is accident. The formats imitate real document layouts because the
measurement would be worthless otherwise; the contents do not belong to anyone.

## These are not exotic cases

Greek is here because it is where the documents are. Arabic is here because it
runs right to left, and an extractor that slices by character position — or a
scorer that compares by position — produces garbage on it while reporting a
number. Cyrillic is here because it has more than one standard transliteration,
so "correct" is a choice before it is an observation. The ideographic cases are
here because family name comes first and nothing in the string says so.

## The declared answer policy

This is **chosen**, in the sense §8 of the method gives the word. It is not
discovered, it is not obvious, and someone else could defend a different one. It
is written here so that every case below is graded the same way and so that a
disagreement about a result can be traced to this paragraph rather than argued
case by case.

1. **The correct answer is the value in the script the document prints it in**,
   copied verbatim, including diacritics and case.
2. **Where the document prints a transliteration as well** — as a
   machine-readable zone does — the transliterated form is recorded as an
   *accepted alternative*. Either scores as correct.
3. **Where the document prints only a transliteration**, that is the answer.
   Reconstructing the original script is inference, and §6 counts an inferred
   value as a wrong answer rather than a helpful one.
4. **A transliteration the document does not contain is never correct**, however
   standard. This is the rule that will generate the most disagreement, and it is
   the reason for rule 2.
5. **Digits follow the same rule as letters.** Arabic-Indic digits are copied as
   they appear; converting them is reformatting, and reformatting is not
   extraction.

Rules 1 and 4 together mean a scorer that normalises to ASCII before comparing
will mark correct answers wrong on nine of these twelve cases. That is the first
thing to check when the numbers come back low.

---

## Greek

### G1 — plain Greek identity card

```
ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ — ΔΕΛΤΙΟ ΑΣΤΥΝΟΜΙΚΗΣ ΤΑΥΤΟΤΗΤΑΣ
Επώνυμο: ΠΑΠΑΪΩΑΝΝΟΥ
Όνομα: ΕΛΕΝΗ
Ημερομηνία γέννησης: 14.06.1991
Διεύθυνση: Ερμού 45, Αθήνα 10563
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ΕΛΕΝΗ ΠΑΠΑΪΩΑΝΝΟΥ | — |
| date of birth | 14.06.1991 | — |
| document type | ΔΕΛΤΙΟ ΑΣΤΥΝΟΜΙΚΗΣ ΤΑΥΤΟΤΗΤΑΣ | identity card |
| country | ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ | Greece |
| address | Ερμού 45, Αθήνα 10563 | — |

**What it tests** — the baseline. No transliteration is printed, so rule 4
applies: `ELENI PAPAIOANNOU` is **wrong**, not partially right. Note the
diaeresis in ΠΑΠΑΪΩΑΝΝΟΥ; dropping it is a wrong answer under rule 1 and is the
most likely near-miss. Document type and country are the two fields where a
translation is accepted, because the document's self-description is a category
rather than a name — that asymmetry is chosen and is worth arguing about.

### G2 — Greek with printed Latin transliteration

```
ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ — ΔΙΑΒΑΤΗΡΙΟ / PASSPORT
Επώνυμο / Surname: ΒΛΑΧΟΓΙΑΝΝΗΣ / VLACHOGIANNIS
Όνομα / Given name: ΘΑΝΑΣΗΣ / THANASIS
Ημ. γέννησης / Date of birth: 02 ΜΑΡ / MAR 1979
Διεύθυνση: Λεωφ. Κηφισίας 210, Μαρούσι
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ΘΑΝΑΣΗΣ ΒΛΑΧΟΓΙΑΝΝΗΣ | THANASIS VLACHOGIANNIS |
| date of birth | 02 ΜΑΡ 1979 | 02 MAR 1979 |
| document type | ΔΙΑΒΑΤΗΡΙΟ | PASSPORT / passport |
| country | ΕΛΛΗΝΙΚΗ ΔΗΜΟΚΡΑΤΙΑ | Greece |
| address | Λεωφ. Κηφισίας 210, Μαρούσι | — |

**What it tests** — rule 2, and the trap inside it. Both name forms are printed,
so both score. But the address is printed **only** in Greek, so the accepted
alternative column is empty there: a tier that transliterates consistently gets
four fields right and the address wrong. That per-field split is the finding —
an aggregate rate would show a plausible 80% and conceal the mechanism.

### G3 — Greek with final sigma and accent stripping

```
ΑΔΕΙΑ ΔΙΑΜΟΝΗΣ
Ονοματεπώνυμο: Κωνσταντίνος Στεφανίδης
Γεννηθείς: 30/11/1966
Χώρα έκδοσης: Ελλάδα
Οδός: Αγίου Δημητρίου 7, Θεσσαλονίκη 54633
```

| field | answer | accepted alternative |
|---|---|---|
| full name | Κωνσταντίνος Στεφανίδης | — |
| date of birth | 30/11/1966 | — |
| document type | ΑΔΕΙΑ ΔΙΑΜΟΝΗΣ | residence permit |
| country | Ελλάδα | Greece |
| address | Αγίου Δημητρίου 7, Θεσσαλονίκη 54633 | — |

**What it tests** — two failure modes that look identical in an ASCII-normalised
score and are not. Stripping the tonos (`Κωνσταντινος`) is a wrong answer under
rule 1. Uppercasing the name changes final sigma `ς` to `Σ` — also wrong under
rule 1, and it is the one case where a tier "improving" the formatting produces a
value that no longer matches the document. Record which of the two occurred; a
scorer that folds case and accents will report both as correct and this case will
have measured nothing.

---

## Arabic

*These blocks contain right-to-left text. In a left-to-right editor the
punctuation and the embedded Latin will appear in a different visual order than
the logical character order, which is precisely the property under test. Compare
by codepoint, never by what the line looks like.*

### A1 — Arabic identity card, Arabic-Indic digits

```
بطاقة الهوية الوطنية
الاسم: أحمد بن سالم المرزوقي
تاريخ الميلاد: ١٩٨٤/٠٧/٢٢
الجنسية: المغرب
العنوان: شارع الحسن الثاني ٤٥، الدار البيضاء
```

| field | answer | accepted alternative |
|---|---|---|
| full name | أحمد بن سالم المرزوقي | — |
| date of birth | ١٩٨٤/٠٧/٢٢ | — |
| document type | بطاقة الهوية الوطنية | national identity card |
| country | المغرب | Morocco |
| address | شارع الحسن الثاني ٤٥، الدار البيضاء | — |

**What it tests** — rule 5 head-on. `1984/07/22` is a **wrong** answer: the
document does not contain those characters. This is the single most contestable
grading decision in the file, and it is deliberate — a chain that silently
converts digits is doing a transformation nobody asked for, and the corpus should
say whether that is wanted before the measurement, not after. Also note the
address contains an Arabic comma (`،`, U+060C), not a Latin one.

### A2 — Arabic with Latin machine-readable zone

```
المملكة الأردنية الهاشمية — جواز سفر
الاسم: ليلى عبد الرحمن الخطيب
تاريخ الميلاد: ٠٩/٠٢/١٩٩٥
العنوان: حي الصويفية، عمّان
P<JORALKHATIB<<LAYLA<ABDALRAHMAN<<<<<<<<<<<<
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ليلى عبد الرحمن الخطيب | LAYLA ABDALRAHMAN ALKHATIB |
| date of birth | ٠٩/٠٢/١٩٩٥ | — |
| document type | جواز سفر | passport |
| country | المملكة الأردنية الهاشمية | Jordan |
| address | حي الصويفية، عمّان | — |

**What it tests** — rule 2 where the transliteration is machine-generated and
lossy. The MRZ prints the name but not the date in Latin form, so the accepted
alternative exists for one field and not the other. A tier that reads only the
MRZ scores one field and misses four; a tier that reads only the Arabic scores
five. Which one a cheap tier does is worth knowing before choosing it. Note the
shadda in `عمّان` — dropping it is a wrong answer under rule 1.

### A3 — Arabic with an embedded Latin fragment

```
تصريح إقامة — RESIDENCE PERMIT
الاسم: يوسف بن علي
تاريخ الميلاد: 1990-12-03
رقم الوثيقة: JO-2291-B
العنوان: 12 Rue de Paris، تونس
```

| field | answer | accepted alternative |
|---|---|---|
| full name | يوسف بن علي | — |
| date of birth | 1990-12-03 | — |
| document type | تصريح إقامة | RESIDENCE PERMIT / residence permit |
| country | تونس | Tunisia |
| address | 12 Rue de Paris، تونس | — |

**What it tests** — bidirectional text with genuinely mixed content. The date is
in Latin digits *in the document*, so under rule 5 the Latin form is the answer
here and the Arabic form would be wrong — the mirror image of A1, and the pair
exists to catch a tier that has learned to convert in one direction only. The
address mixes a Latin street with an Arabic city and an Arabic comma; an
extractor that slices by position will split it in the wrong place, and the
symptom is a truncated address rather than an empty one.

---

## Cyrillic

### C1 — Russian passport with patronymic

```
РОССИЙСКАЯ ФЕДЕРАЦИЯ — ПАСПОРТ
Фамилия: ВОЛКОВ
Имя: ДМИТРИЙ
Отчество: СЕРГЕЕВИЧ
Дата рождения: 18.05.1982
Адрес: ул. Лесная, д. 14, кв. 7, Новосибирск
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ДМИТРИЙ СЕРГЕЕВИЧ ВОЛКОВ | ДМИТРИЙ ВОЛКОВ |
| date of birth | 18.05.1982 | — |
| document type | ПАСПОРТ | passport |
| country | РОССИЙСКАЯ ФЕДЕРАЦИЯ | Russia / Russian Federation |
| address | ул. Лесная, д. 14, кв. 7, Новосибирск | — |

**What it tests** — whether the patronymic belongs in "full name". Both forms are
accepted, which is a **declared retreat**: the corpus does not know which the
client wants, and pretending to know would punish a defensible reading. If the
client later says patronymics are excluded, this cell narrows and the case must
be re-scored — write that down when it happens rather than quietly editing the
table.

### C2 — Cyrillic with two defensible transliterations, neither printed

```
ПАСПОРТ ГРАЖДАНИНА
Фамилия: КОВАЛЕНКО
Имя: ЮЛИЯ
Дата рождения: 07.09.1993
Адрес: пр. Науки 33, Харьков
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ЮЛИЯ КОВАЛЕНКО | — |
| date of birth | 07.09.1993 | — |
| document type | ПАСПОРТ ГРАЖДАНИНА | passport |
| country | *(not stated)* | — |
| address | пр. Науки 33, Харьков | — |

**What it tests** — rule 4 at its sharpest. `YULIYA KOVALENKO` and `IULIIA
KOVALENKO` are both standard renderings of `ЮЛИЯ`, produced by two different
official schemes; the document prints neither, so under rule 4 both are wrong.
A grader who accepts one and not the other has smuggled in a transliteration
standard, and the result will not be reproducible by anyone who picked the other.

The country field is **absent** — the document names no state. The correct answer
is a blank, per §6, and inferring one from the address is the wrong-value failure
the method treats as expensive. This is the only case in the file carrying a
deliberate absence.

### C3 — Serbian, same alphabet, different language

```
РЕПУБЛИКА СРБИЈА — ЛИЧНА КАРТА
Име и презиме: МИЛОШ ЂУРЂЕВИЋ
Датум рођења: 25.01.1988
Адреса: Кнез Михаилова 12, Београд
```

| field | answer | accepted alternative |
|---|---|---|
| full name | МИЛОШ ЂУРЂЕВИЋ | — |
| date of birth | 25.01.1988 | — |
| document type | ЛИЧНА КАРТА | identity card |
| country | РЕПУБЛИКА СРБИЈА | Serbia |
| address | Кнез Михаилова 12, Београд | — |

**What it tests** — Cyrillic that is not Russian. `Ђ`, `Ћ` and `Ј` exist in
Serbian and not in Russian, so a tier that has learned "Cyrillic means Russian"
will mangle exactly those characters and leave the rest intact. The symptom is a
name wrong by one or two codepoints — which a lenient scorer forgives and a
verbatim rule does not. Report the codepoint-level difference for this case, not
just right or wrong.

---

## Ideographic

### I1 — Chinese, family name first

```
中华人民共和国 居民身份证
姓名：李明華
出生：1987年4月12日
住址：上海市南京西路1266号
```

| field | answer | accepted alternative |
|---|---|---|
| full name | 李明華 | — |
| date of birth | 1987年4月12日 | — |
| document type | 居民身份证 | resident identity card |
| country | 中华人民共和国 | China |
| address | 上海市南京西路1266号 | — |

**What it tests** — nothing in the string marks where the family name ends. `李`
is the family name and `明華` the given name, and the only way to know is
knowledge outside the document. Under rule 1 the whole printed string is the
answer, which side-steps the question — deliberately, because "full name" does
not require the split. **If a downstream consumer needs surname separately, this
case becomes ambiguous and moves to `cas-ambigus.md`.** It sits here only for as
long as the field stays whole.

The date carries its own units (`年月日`); stripping them to `1987-04-12` is
reformatting and wrong under rule 5. Note also that the document mixes simplified
characters in the header with a traditional `華` in the name — a real and common
combination, and a tier that normalises one way or the other will alter the name.

### I2 — Japanese, spaced name, era-free date

```
日本国 運転免許証
氏名：山田 太郎
生年月日：1975年10月8日
住所：東京都渋谷区神南1-19-11
```

| field | answer | accepted alternative |
|---|---|---|
| full name | 山田 太郎 | 山田太郎 |
| date of birth | 1975年10月8日 | — |
| document type | 運転免許証 | driving licence |
| country | 日本国 | Japan |
| address | 東京都渋谷区神南1-19-11 | — |

**What it tests** — the ideographic space (U+3000) between family and given name.
It is a real character, it is not an ASCII space, and it is the only structural
hint the string carries. Both the spaced and unspaced forms are accepted because
the space is presentational; substituting an ASCII space is also accepted under
that reasoning, which is a choice this file makes explicit rather than leaving to
the scorer. Against I1, this pair separates "handles CJK" from "handles the
particular conventions of one CJK language".

---

## Mixed

### M1 — one document, four scripts

```
UNITED NATIONS — TRAVEL DOCUMENT / ΤΑΞΙΔΙΩΤΙΚΟ ΕΓΓΡΑΦΟ
Name / Όνομα: ΣΟΦΙΑ ΜΑΡΙΝΟΥ / SOFIA MARINOU
Also recorded as: София Маринова
Date of birth: 21.08.1996
Address: Οδός Ακαδημίας 12, Αθήνα
Issued at: عمّان
```

| field | answer | accepted alternative |
|---|---|---|
| full name | ΣΟΦΙΑ ΜΑΡΙΝΟΥ | SOFIA MARINOU |
| date of birth | 21.08.1996 | — |
| document type | ΤΑΞΙΔΙΩΤΙΚΟ ΕΓΓΡΑΦΟ | TRAVEL DOCUMENT / travel document |
| country | *(not stated — issuing authority is not a country)* | — |
| address | Οδός Ακαδημίας 12, Αθήνα | — |

**What it tests** — the hardest thing in the file, which is *ignoring* a script.
`София Маринова` is printed and is not the answer: it is an alternative
recording, not the name field. A tier that grabs the most recent name-like string
returns it and is wrong. So is `عمّان`, which is a place of issue in a fourth
script and not the address.

The country field is again a blank: a United Nations travel document has an
issuing authority and no issuing country, and inferring "Jordan" from the place
of issue is the expensive kind of error. Two of the twelve cases have a
deliberate blank country (C2, M1), which is enough for the blank/wrong split of
§6 to be visible on this field and not enough for it to be well estimated —
stated here so nobody reads that split as a rate.

---

## How to grade this file

**Compare by codepoint.** Nine of the twelve cases have a correct answer that an
ASCII-normalising comparison will reject. Before believing any score from this
file, run one case you know is right through the scorer and confirm it passes.

**Report per script, not per file.** "Non-Latin accuracy" is not a quantity —
Greek and Arabic fail for different reasons, and A1 and A3 are designed to fail
in opposite directions for the same tier.

**Report the blank/wrong split on the country field separately.** Three cases
(C2, M1, and G-series by contrast) turn on whether a tier will leave a field
empty rather than infer it, and that behaviour is the subject of §6 rather than a
detail of script handling.

**Count what ran: 12 cases × 5 fields = 60 cells per tier per formulation.** A
run that reports fewer has dropped something, most likely on the right-to-left
cases, and a dropped cell reads as an absent finding rather than as an error.
