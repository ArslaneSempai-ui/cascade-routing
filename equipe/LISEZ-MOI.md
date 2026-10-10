# Lisez-moi : l'équipe, les bases et les seize fonctions, en une page

Pour Arslane. Tout ce qui est décrit dans `equipe/` existe sous forme de fichiers sur la
branche `equipe-agents` (poussée, pas fusionnée, pas de PR). Rien n'a été envoyé, publié,
payé ni rendu. Les scripts Blender compilent mais n'ont jamais tourné : le premier essai
sur le Mac est le test.

## Ce qui existe

- **La structure** (`STRUCTURE.md`, `CHARTE.md`) : neuf départements, 37 rôles, un fichier
  d'agent par rôle dans `agents/`, chacun avec un seul métier, ses lectures, ses écritures,
  ses interdits, son modèle et ses règles d'escalade. Le faiseur et le vérificateur sont
  deux agents différents ; ton « oui » écrit dans une session est le seul oui.
- **L'exécuteur** (`EXECUTEUR-DISPATCH.md`) : la passe horaire, de 8 h à 23 h, qui lit les
  demandes dues, infère le rôle, lance un sous-agent par demande, vérifie, écrit le
  résultat et une ligne de fil. `budget` passe en premier et fixe le mode selon le quota.
- **Le tableau de bord** (`DASHBOARD.md`, `PLANETES.md`) : la collection `equipe`, un
  document par rôle écrit par l'exécuteur ; les planètes comme instruments, chacune
  portant l'état de son département par son propre phénomène ; les comètes pour les
  événements.
- **Le modèle de fonctionnement** (`COEUR.md`) : les niveaux d'automatisation L0 à L4 par
  processus, aujourd'hui et cible ; les événements contre les rituels ; le chien de garde ;
  le quota comme budget ; la feuille de route en quatre phases.
- **Les deux commandes construites** : `npm run livrer` (branche
  `automatisation-livraison`) livre l'audit d'extraction à un client en une commande, hors
  ligne ; `npm run lots` (branche `automatisation-lots`) prépare un lot d'envoi hors ligne,
  avec la porte de rebond et les créneaux par fuseau.
- **La vue tycoon** (`TYCOON.md`, `TYCOON-PAGE.md`, `blender/`) : chaque planète ouvre sur
  la base de son département, chacune différente dans sa forme ; 39 robots vivants, un par
  agent, reconnaissables à un petit accessoire, avec quatorze boucles chaînées au hasard ;
  une vue générale du système ; douze scripts Blender 5 (onze bases et la vue générale)
  sur une grammaire commune, à lancer sur le Mac.
- **Les seize fonctions** (`FEATURES.md`) : jour et nuit, rejeu du dimanche, jalons qui
  changent le ciel, son facultatif, file d'attente de ton oui, simulateur, prévisions,
  espace client, mémoire de l'entreprise, niveaux des agents, prospects en vaisseaux,
  lettre du dimanche, version de poche, mode démo, coffre sur Mars, exercice mensuel de
  reprise. Chacune avec son but, ses données, ses règles, son visuel, sa logique de page
  et une taille d'effort.
- **Le journal** (`JOURNAL.md`) : une ligne datée par pièce livrée.

## Dans quel ordre ça se construit

La feuille de route de `COEUR.md` (« Roadmap : one order for everything ») ordonne tout
en quatre phases hebdomadaires, chacune avec ses mesures :

1. **Le cœur bat** : l'exécuteur, les rôles de Direction, Commercial, Finance et
   Infrastructure, les battements, le chien de garde, `lots` et `livrer`, la file de ton
   oui, le coffre, l'exercice de reprise programmé.
2. **Les exceptions seulement** : triage, rebonds, trésorerie et contrôles au niveau L3 ;
   Clients et Compliance ; prospects, prévisions, niveaux, jalons ; jour et nuit ; la
   version de poche.
3. **L'argent, la loi, la mémoire** : rapprochement, factures et relances, échéances,
   `qualite` sur tout ce qui sort ; la mémoire et « pourquoi ? » ; la lettre et le rejeu
   du dimanche ; l'espace client ; le simulateur.
4. **Les bâtisseurs, la voix, les bases** : DEV et Marketing en service ; le look-dev
   Blender sur le Mac, puis les bases une par jour ; la page tycoon avec le jeu minimal
   de boucles ; le son et le mode démo en dernier.

## Ce que tu décides

- La fusion des trois branches (`equipe-agents`, `automatisation-livraison`,
  `automatisation-lots`) : rien n'est fusionné sans ton accord.
- La répartition du quota entre départements (`COEUR.md`, « Cost control »).
- Les seuils de `PLANETES.md` après le premier mois de chiffres.
- La forme des bases après le look-dev (trois formes, à comparer sur le Mac), puis chaque
  image fixe avant que ses boucles ne soient rendues.
- Le lien du premier espace client, et chaque lien ensuite.
- Le lien profond de la file d'attente : à vérifier dans la documentation de Claude Code
  sur le Mac avant que le bouton n'existe ; sinon le bouton copie la phrase.
- Chaque « oui » : un clic sur le tableau de bord n'en est jamais un.

## Ce qui reste à faire ailleurs que dans ces fichiers

- Lancer `blender -b -P equipe/blender/base_terre.py -- --apercu` sur le Mac et corriger
  ce que le premier rendu montre.
- Écrire le générateur de données d'exemple (`equipe/demo/generer.ts`) et le script de
  restauration de l'exercice mensuel, tous deux sur le Mac.
- Appliquer les deux correctifs en attente du dépôt (`tiers-loader-side.patch`,
  `f11-closure-rewrites.patch`), qui demandent `npm run figures` avec les poids.
