<!-- ENGENDRÉ PAR src/menace.ts — NE PAS ÉDITER À LA MAIN -->
# Surface d'attaque

6 contrôles tenus sur 6.

Chaque ligne porte **ce qui a été lu**. « Aucune menace » sans dénominateur est la phrase
qu'un contrôle cassé produit aussi, et c'est l'erreur la plus chère de ce domaine.

| Contrôle | Verdict | Constat | Lu |
| --- | --- | --- | --- |
| Adresse d'écoute | tenu | Le serveur écoute sur boucle locale. Une écoute sur toutes les interfaces le rend joignable depuis le réseau local, donc depuis un wifi partagé. | `src/server.ts` |
| Racine servie | tenu | Seuls des chemins littéraux sont servis (./ui.html). L'URL est comparée, jamais concaténée. | `src/server.ts` |
| Corps de requête borné | tenu | Le corps est plafonné et la socket est détruite à la borne. | `src/server.ts` |
| Ressources externes | tenu | L'écran ne charge rien depuis un domaine tiers. Une dépendance chargée depuis un domaine qu'on ne contrôle pas s'exécute avec les droits de la page. | `src/ui.html` |
| Données du client non versionnées | tenu | Les mesures faites sur les données d'un client vivent dans data/, qui est ignoré par git. Ce qui n'est pas versionné ne part pas dans un dépôt public. | `.gitignore` |
| Empreinte des dépendances | tenu | Chaque dépendance porte une empreinte de contenu : le paquet installé est celui qui a été mesuré. | `81 dépendances` |


## Ce que ces contrôles valent

Ils sont rendus par des fonctions du **contenu**, pas du disque, et chacune est éprouvée sur
un texte dont la réponse est connue avant que le verdict soit écrit. Si l'un des détecteurs
cesse de reconnaître ce qu'il prétend reconnaître, rien n'est publié.

C'est la seule réponse au scan qui rend « aucune menace » sur un dossier qu'il n'a pas pu
lire : ce zéro-là est vrai et ne dit rien.

## Ce qu'ils ne voient pas

Un angle mort qu'on ne publie pas est une fausse assurance, alors le voici. Le contrôle de la
racine servie regarde ce qui entre **directement** dans une lecture de fichier. Si un morceau
d'URL passe d'abord par une variable, il ne le suit pas — un témoin le dit explicitement dans
`temoins()`, et il échouera là où un humain doit encore regarder.

Ce sont des contrôles de source. Ils ne remplacent pas l'observation en marche : c'est
`npm run egress` qui constate qu'aucun octet ne quitte la machine pendant une mesure, parce
que ça ne se lit dans aucun fichier.

## Les secrets dans l'historique

0 occurrences sur **196 commits**, témoins retrouvés : 2/2 — relevé du 2026-08-24, sous `075f0c9`.

Un fichier effacé reste dans les objets git : un secret retiré du dernier commit reste
lisible pour toujours, et un dépôt public n'oublie rien. Le balayage porte donc sur
l'historique entier, pas sur le répertoire de travail. Il est lent — il tourne hors de
`npm test`, avec `npm run menace -- --historique`.

## Ce qui n'est pas couvert ici

L'inventaire des licences vit dans `LICENCES.md`. La garantie de non-transmission — que
rien ne sort de la machine pendant une mesure — est un relevé distinct, rendu par
`npm run egress`, parce qu'elle s'observe en marche et ne se lit pas dans une source.
