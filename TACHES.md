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
- [ ] `regles-bornees.ts` : retirer `terminate()` laisse la suite VERTE et le programme ne rend jamais la main
- [x] Les alertes CodeQL : **déposées le 26 août 2026**, aucune ouverte — vérifiable par `gh api …/code-scanning/alerts`. Les `js/redos` en `used in tests`, les XSS et la fuite de trace en faux positif, textes vérifiés sur l'état publié
- [x] `knip` : refermé et **vérifié dans le code**, pas dans le rapport — `fast-check` absent de `package.json`, 2 devDependencies, 81 paquets au verrou, `MUST_DECLARE` disparu
- [x] `dependency-cruiser` : mesuré sans rien installer par `equipe/scripts/cycles.mjs` — **0 cycle statique**, 1 cycle fermé par un `await import()` (bénin : résolu à l'appel), 0 module mort. Les 12 non importés sont 11 points d'entrée npm et `charger.mjs`, cité par un relevé publié
- [x] La chaîne est vivante — vérifié le 26 août : elle tourne sur chaque proposition. Elle était rouge sur six mises à jour, dont trois pour un vrai défaut de compatibilité `@types/node` 26, corrigé
- [ ] `registre.test.ts` en intégration continue : cloner `identite` et poser `IDENTITE=`

## Garde-fous

- [x] Compter à part les réponses hors forme, sans jamais corriger en silence
- [x] Refuser une réponse qui n'apparaît nulle part dans le document
- [ ] Concordance entre paliers — la seule piste qui vise l'injection (session ad)
- [ ] Contrôle par mot-clé : signaler un document porteur de tournures d'instruction, jamais le refuser
- [ ] Le corpus hostile, gardé comme livrable

## Produit et vente

- [x] Dossier fournisseur pré-rempli (session 3c)
- [x] Licence commerciale, montants posés
- [ ] Remplir les emplacements restants de la licence : `PAYMENT_TERMS`, `PRICE_INCREASE_CAP`
- [ ] Conversation avec un validateur bancaire — **décidé : après la refonte du design**

## Après le reste

- [ ] Refonte du design, sous Fable 5 : animation d'entrée, écrans au défilement, la mesure sur le premier écran, 404 dessiné
- [ ] Windows : écarté par écrit, à traiter plus tard
- [ ] 13 commits en attente de poussée (décision d'Arslane)
