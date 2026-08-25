# Ce qui est ouvert sur cascade

Une ligne par tâche, cochée quand elle est finie. `etat.sh` l'imprime à chaque relevé, donc
elle ne se perd pas — et si elle rouille, elle rouille en public.

**Ce qu'elle n'est pas** : un journal. Une tâche finie se coche et reste, elle ne se raconte
pas. Le détail va dans le message de commit, qui voyage avec la ligne qu'il explique.

## Débug et sécurité

- [ ] Trier les 47 trouvailles du balayage — 19 tranchées, 28 restantes (session 51)
- [ ] `regles-bornees.ts` : retirer `terminate()` laisse la suite VERTE et le programme ne rend jamais la main
- [ ] Les six alertes CodeQL : déposer les textes de rejet sur GitHub (décision d'Arslane)
- [ ] `knip` : 23 éléments, un seul mort franc selon le tri précédent — revérifier
- [ ] `dependency-cruiser` : 1 violation jamais regardée
- [ ] La suite n'a pas tourné hors de cette machine depuis le 17 août — l'intégration continue est-elle vivante ?
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
