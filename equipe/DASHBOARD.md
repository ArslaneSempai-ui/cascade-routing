# The team in the dashboard

How the roles of `STRUCTURE.md` appear in the Crusetra Dashboard (private claude.ai
artifact, one page, dark space theme, the home screen becoming a 3D hub: the robot at the
core of light rings, seven planets for the seven views Aujourd'hui, Boîte, Pipeline,
Semaine, Contrôles, Chantiers, Notes).

## (a) Database: collection `equipe`, one document per role

Document id: the role name (`chef-orchestre`, `qualite`, `methode`, `prospection`,
`boite`, `livraison`, `encaissement`, `juridique-compta`, `controles`, `redaction`,
`veille`). Written by the executor each time a role works, never by the role itself.

```json
{
  "nom": "prospection",
  "departement": "Commercial",
  "etat": "travaille | libre | bloque | attend_oui",
  "derniere": "2026-10-10T09:12:40+03:00",
  "resume": "Lot du 10/10 prêt : 38 premiers mails, 12 relances, en attente de ton oui.",
  "kpi": { "lots_envoyes_semaine": 2, "taux_rebond_dernier_lot": 0.021 },
  "demandes_en_cours": ["dem_01HX...", "dem_01HY..."]
}
```

Rules: `resume` is one French line, written for Arslane, no secret, no outsider's full
mail text. `kpi` keys are the ones named in `STRUCTURE.md`, values measured, never
typed. `etat` is `attend_oui` whenever at least one of the role's demandes is
`attend_oui`, `bloque` when one is `bloque`, `travaille` while a pass runs it, `libre`
otherwise. A document missing for a role means the role never worked yet; the page shows
it grey.

## (b) Where it shows: the rings are the departments, the cards open from them

Recommendation: no eighth planet. The seven planets are views of the business; the team
is the mechanism that moves it, and the hub already draws that mechanism as rings around
the robot. So:

- Six rings, one per department, from the core outward: Direction, Commercial, Delivery,
  Finance, Infrastructure, Growth. The robot at the core is the chef.
- Ring colour is the worst state among its roles: red for `bloque`, amber for
  `attend_oui`, white pulse for `travaille`, dim for `libre`, grey when no document.
- Clicking a ring opens the team panel (an overlay over the hub, not a navigation): the
  department's roles as small cards, then the other departments folded below. A card
  shows the state dot, the role name, `resume` (the last action), `derniere` as a
  relative time, and its one or two KPIs.
- Escalations waiting on Arslane come first, above the cards, whatever ring was clicked:
  every demande `attend_oui` as one line (role, titre, the exact action awaiting, a link
  to the row), then every `bloque` with its one-line reason. This is the only list on the
  page that can ask Arslane for something, and it says so in French: "En attente de ton
  oui, dans une session Claude Code. Un clic ici n'est pas un oui."

Why rings rather than an eighth view: the hub is opened many times a day and a view is
opened on purpose; a state that must be seen without looking for it belongs on the hub.
Why an overlay rather than a planet: the seven views are stable, documented and used by
Crusetra's answers; adding a planet changes the navigation for a list that is mostly
empty on a good day.

## (c) Crusetra, the chat assistant, and the roles

- `confier` and `planifier` gain an optional `role`. When given, it is written on the
  demande as is. When absent, Crusetra infers it with the same table as the executor
  (`EXECUTEUR-DISPATCH.md`, section 2) and writes it; when nothing matches, `role` is
  `chef-orchestre` and the chef decides at dispatch.
- Crusetra names the role in its one-line answer, in French: "Confié à prospection :
  relance du lot du 3 octobre, planifié demain 9 h." It never claims the work is done, nor
  that a text was sent: it reports the demande and its `statut`.
- A question about the team ("où en est la boîte ?") is answered from the `equipe`
  document of that role: `resume`, `derniere`, KPIs, nothing invented. A role without a
  document: "Ce rôle n'a pas encore travaillé."

## (d) What the executor writes after each pass

For each role it ran: the role's `equipe` document (fields above). For each demande
worked: `statut`, `resultat`, `verifie` (set only by `qualite` or by the chef for
mechanical rows), and a `fil` line `[chef] -> [role] : <titre> : <statut>`. For each
handoff created by a role: the new demande with `role`, `de_role`, and its `fil` line.
For the pass itself: `equipe/chef-orchestre` with `resume` = "Passe de 09:00 : 3 demandes
travaillées, 1 en attente de ton oui, 0 bloquée." and the KPI
`{ "travaillees_passe": 3, "bloquees": 0 }`. A P1 incident adds the push notification
first, then the rows. Nothing is written for a pass that found nothing due except the
chef's own document.
