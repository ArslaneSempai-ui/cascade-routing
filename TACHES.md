# Ce qui est ouvert sur cascade

> **Cette liste ment dès qu'on la laisse vieillir.** Le 26 août 2026, `reprendre.sh` l'a trouvée
> annonçant six alertes CodeQL à déposer qui étaient fermées depuis des heures, et un compte de
> trouvailles vieux d'une demi-journée. Une entrée qui décrit au présent un état révolu envoie
> le lecteur suivant chercher là où il n'y a plus rien — et il conclut que la liste est périmée,
> ce qu'elle était. Les comptes vivent dans les relevés ; ici on met des renvois, pas des chiffres.


Une ligne par tâche, cochée quand elle est finie. `etat.sh` l'imprime à chaque relevé, donc
elle ne se perd pas — et si elle rouille, elle rouille en public.

**Ce qu'elle n'est pas** : un journal. Une tâche finie se coche et reste, elle ne se raconte
pas. Le détail va dans le message de commit, qui voyage avec la ligne qu'il explique.

## Débug et sécurité

- [ ] Trier les trouvailles du balayage — le compte vit dans `~/Documents/rapports/2026-08-25-tri-des-47.md`, jamais ici
- [x] `regles-bornees.ts` : le chemin d'erreur du Worker est couvert — ouvrier injectable, témoin prouvé ROUGE
- [x] Le balayage couvre `throw` ET `process.exit`, mesurés avec le même outil — comptes et taux dans `survivants.json`, jamais recopiés ici. `terminate()` reste écarté : son neutraliseur ne compilerait pas, ce qui fabriquerait un faux « attrapé »
- [x] ~~`regles-bornees.ts` : retirer `terminate()` laisse la suite VERTE~~ — **fermé le 25/08**, vérifié le 27/08 par mutation : `terminate()` retiré rend ROUGE (borne de 20 s atteinte), restauré 8/8. Le cas est lui-même borné, sinon la suite pendrait ; les six autres cas ne le voyaient pas parce qu'ils lisent la valeur de RETOUR, juste sans `terminate()`.
- [x] Les alertes CodeQL : **déposées le 26 août 2026**, aucune ouverte — vérifiable par `gh api …/code-scanning/alerts`. Les `js/redos` en `used in tests`, les XSS et la fuite de trace en faux positif, textes vérifiés sur l'état publié
- [x] `knip` : refermé et **vérifié dans le code**, pas dans le rapport — `fast-check` absent de `package.json`, 2 devDependencies, 81 paquets au verrou, `MUST_DECLARE` disparu
- [x] `dependency-cruiser` : mesuré sans rien installer par `equipe/scripts/cycles.mjs` — **0 cycle statique**, 1 cycle fermé par un `await import()` (bénin : résolu à l'appel), 0 module mort. Les 12 non importés sont 11 points d'entrée npm et `charger.mjs`, cité par un relevé publié
- [x] La chaîne est vivante — vérifié le 26 août : elle tourne sur chaque proposition. Elle était rouge sur six mises à jour, dont trois pour un vrai défaut de compatibilité `@types/node` 26, corrigé
- [ ] `registre.test.ts` en intégration continue : cloner `identite` et poser `IDENTITE=`

## Garde-fous

- [x] Compter à part les réponses hors forme, sans jamais corriger en silence
- [x] Refuser une réponse qui n'apparaît nulle part dans le document
- [x] ~~Concordance entre paliers~~ — **écartée par mesure**, pas en attente. Le taux de désaccord
  entre paliers sur des documents SAINS, et le fait que « désaccord ET non cité » n'attrape sur
  les documents injectés que les cas déjà attrapés par la citation seule, vivent dans l'en-tête
  de `src/document-suspect.ts` — avec la phrase qui dit que c'est écrit là pour que personne ne
  le retente en croyant l'inventer. La mécanique existe et reste au banc (`desaccord()` dans
  `journal.ts`, lue par `tentatives.ts`), **exclue du classement** avec sa raison dans
  `escalade.ts`. Rouvrir ce choix demande une mesure qui contredise celle-là, pas une intuition
- [x] Contrôle par mot-clé : signaler un document porteur de tournures d'instruction, jamais le
  refuser — **livré**, `src/document-suspect.ts` appelé depuis la boucle de mesure de
  `your-cases.ts`. Le compte figure dans le relevé, la sortie dit qu'elle n'a rien écarté, et le
  témoin de site d'appel lance la vraie commande (`document-suspect.test.ts`) avec son pendant :
  un document ordinaire ne fait rien annoncer
- [ ] Le corpus hostile, gardé comme livrable

## Produit et vente

- [x] Dossier fournisseur pré-rempli (session 3c)
- [x] Licence commerciale, montants posés
- [ ] Remplir les emplacements restants de la licence : `PAYMENT_TERMS`, `PRICE_INCREASE_CAP`
- [ ] Conversation avec un validateur bancaire — **décidé : après la refonte du design**

## Après le reste

- [ ] Refonte du design, sous Fable 5 : animation d'entrée, écrans au défilement, la mesure sur le premier écran, 404 dessiné
- [ ] Windows : écarté par écrit, à traiter plus tard
- [x] ~~13 commits en attente de poussée~~ — **poussé le 27 août** : 118 commits publics, CI verte (verifier + CodeQL 0 alerte + pages)

- [ ] **Les 6 PRs dependabot** (décision d'Arslane) : #1–3 (actions GitHub) sont vertes et fusionnables telles quelles. #4–6 (npm) échouent PAR CONSTRUCTION : la garde d'inventaire exige que l'inventaire versionné accompagne toute montée de version, et dependabot ne sait pas le régénérer — les prendre à la main (bump + `licences`/inventaire régénérés + suite) ou les fermer. Attention : transformers 4.2.0 et typescript 7.0.2 sont des MAJEURES — la première touche `POIDS_MODELES` (révisions, octets, disposition du cache).

- [ ] **Re-mesurer le corpus dur** : les taux publiés ont été calculés contre 13 clés polluées par `*accepted:*` (corrigé le 27 août) — ils sous-notent les paliers. La re-mesure demande les modèles (~heures) et fera BOUGER des chiffres publiés : décision, pas maintenance.
