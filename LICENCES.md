<!-- ENGENDRÉ PAR src/licences.ts — NE PAS ÉDITER À LA MAIN -->
# Licences et nomenclature

55 paquets sont installés sous `node_modules/`, dépendances de
développement comprises. Chacun a été classé sur son champ `license` **et** sur le
texte du fichier de licence qu'il livre ; quand les deux divergent, c'est le texte
qui décide.

| Classe | Paquets | Ce que ça implique |
| --- | --- | --- |
| Permissive | 54 | Attribution. Rien d'autre. |
| À tenir | 1 | Usage autorisé dans un produit propriétaire, sous conditions — détaillées ci-dessous. |
| Bloquante | 0 | Contaminerait ce qui est livré. |
| Indéterminée | 0 | À lever avant livraison. |

## Ce qui demande une décision

### Aucun copyleft fort

Aucune GPL, AGPL, SSPL ni Business Source dans l'arbre. Ce zéro est rendu par une classification dont les témoins passent — voir `temoins()` dans `src/licences.ts` ; si elle cessait de reconnaître l'AGPL, l'outil refuserait de l'écrire.

### Copyleft de bibliothèque

| Package | Version | Licence |
| --- | --- | --- |
| `@img/sharp-libvips-darwin-arm64` | 1.3.2 | LGPL-3.0-or-later |

La LGPL autorise l'usage dans un produit propriétaire tant que l'utilisateur peut remplacer la bibliothèque. C'est le cas ici : elle arrive par `npm install` chez le client, non modifiée, sans lien statique. **L'obligation change si l'outil est un jour livré en binaire scellé** — il faudra alors offrir le relien, ou sortir la dépendance.



### Déclarées sans fichier de licence livré

`@img/sharp-libvips-darwin-arm64@1.3.2` (LGPL-3.0-or-later) · `guid-typescript@1.0.9` (ISC) · `onnxruntime-common@1.21.0` (MIT) · `onnxruntime-common@1.22.0-dev.20250409-89f8206ba4` (MIT) · `onnxruntime-node@1.21.0` (MIT) · `onnxruntime-web@1.22.0-dev.20250409-89f8206ba4` (MIT)

Le champ dit permissif, le paquet ne livre pas son texte. Ce n'est pas un risque juridique : c'est une pièce manquante si un acheteur demande l'attribution complète.

## La licence de cet outil

Le dépôt déclare **PolyForm-Noncommercial-1.0.0** — une licence *source-available*, pas open source.

Trois niveaux, et un seul se paie :

| Qui | Ce qui est permis |
| --- | --- |
| N'importe qui, sans limite de durée | Lire, étudier, forker, s'en servir en non commercial. Le dépôt garde toute sa valeur de démonstration. |
| Une organisation qui évalue | Le faire tourner **sur ses propres données**, trente jours, pour se décider. Les résultats restent internes et ne se mettent pas en production. |
| Une organisation qui s'en sert | Licence commerciale, négociée séparément. |

Le deuxième niveau est une permission *ajoutée* au texte PolyForm, pas une
modification de celui-ci : le titulaire des droits peut toujours accorder plus,
jamais moins. Il existe parce qu'une licence qui interdit tout usage commercial
interdit aussi l'essai, et qu'un acheteur qui n'a pas pu essayer n'achète pas.

**Cette licence n'est pas ce que le client achète.** Elle décrit ce qu'un visiteur
du dépôt a le droit de faire. Un usage commercial se fait sous une licence
commerciale distincte, négociée séparément — le modèle de la double licence. Le
titulaire des droits conserve le droit de licencier l'outil à qui il veut et aux
conditions qu'il veut ; cette licence publique ne lui retire rien.

Conséquence à connaître : n'étant pas approuvée OSI, certains grands groupes
l'excluent par politique de leur arbre de dépendances. Ça ne gêne pas une vente,
puisque l'acheteur passe par la licence commerciale de toute façon ; ça gênerait
une adoption spontanée, qui n'est pas ce qu'on cherche ici.

## Nomenclature

`sbom.json` accompagne ce document, au format CycloneDX 1.5.
