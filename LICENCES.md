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

**Le dépôt ne déclare aucune licence.** Sur un dépôt public, cela signifie « tous droits réservés » : personne ne peut légalement s'en servir, y compris le client qui l'a acheté. C'est peut-être voulu — c'est le comportement par défaut d'un produit vendu — mais tant que ce n'est pas écrit, un service juridique bloquera. À trancher : licence commerciale écrite, ou déclaration explicite de propriété.

## Nomenclature

`sbom.json` accompagne ce document, au format CycloneDX 1.5.
