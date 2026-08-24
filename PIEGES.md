# Pièges payés ici

Ce qui est **mécanisable** vit dans les tests et dans `scripts/pieges.mjs` du skill
`equipe` : une règle qui peut se déclencher toute seule ne se met pas dans un document.
Ce fichier porte le reste — ce qui demande un jugement, et que plusieurs sessions
travaillant sur ce dépôt perdraient sinon en même temps.

Chaque entrée dit **ce qui s'est passé**, pas ce qu'il faudrait faire en général.

---

## Entre sessions : toujours des chemins absolus

`scratchpad/correctifs/` ne désigne rien depuis une autre session — chacune a le sien, sous
un identifiant différent. Un chemin relatif échangé entre sessions est un chemin qui ne
mène nulle part, et le destinataire perd le temps de le chercher avant de le demander.

Vaut aussi pour `./`, `../`, et tout ce qui dépend d'un dossier courant : le dossier courant
d'une session n'est pas celui d'une autre, et il ne survit même pas d'un appel au suivant.

## Un harnais qui enchaîne des commandes mesure son propre bruit

Une passe sur les 37 commandes npm a produit trois traces de pile. En rejouant chaque cas
dans un arbre remis à neuf, **deux n'ont pas survécu** : `figures` ne cassait qu'après un
autre `figures`, qui avait réécrit le fichier qu'il lit. Dix fichiers avaient bougé pendant
la passe et rien dans la sortie ne le disait.

**Remède :** `git checkout -- .` puis `git clean -fdq` sur les dossiers que les commandes
écrivent, **avant chaque lancement**. Si c'est trop coûteux pour la passe entière, le faire
au moins pour **rejouer** chaque constat avant de le publier. Un constat qui n'a pas été
reproduit isolément n'est pas un constat.

Cette règle-là est mécanisée : `harnais-sans-remise-a-neuf` dans `scripts/pieges.mjs`.

## Une liste de noms tapée à la main n'est pas la liste des commandes

`npm run figer -- --nimportequoi` sortait 1 sans rien dire, et ça a été rapporté comme un
échec muet du dépôt. **`figer` n'est pas un script de `package.json`** : il avait été tapé
à la main dans une liste de vérification. Le code 1 venait de npm, et `--silent` cachait son
`Missing script: "figer"`.

**Remède :** toute liste de commandes se **dérive** de `package.json`. Si une liste doit
exister à la main, un test la confronte à sa source. Et ne pas lancer un audit avec
`--silent` : ce qu'on fait taire est exactement ce qui explique le code de sortie.

## Un test qui cherche un NOM vérifie une forme, pas une propriété

Le cas qui exige `refuserDrapeauxInconnus` dans chaque commande cherchait d'abord la chaîne
dans le fichier. **La ligne d'`import` suffisait à le satisfaire** : en retirant l'appel de
`mur.ts`, le cas restait vert.

**Remède :** chercher l'**appel**, en excluant les lignes d'import — et le prouver en
cassant **une seule** garde puis en la remettant. Un témoin qui ne peut pas échouer est une
décoration.

## Un témoin qui compare à un compteur non vide passe dans les deux sens

Le même fichier vérifiait qu'un `--` seul ne déclenche rien avec
`assert.deepEqual(sorties, [2])` — alors qu'un `2` s'y trouvait déjà depuis le cas
précédent. Il passait que `--` ait tiré ou non.

**Remède :** remettre le compteur à zéro avant chaque assertion, ou repartir d'un état neuf.

## Changer `cli.ts` invalide la galerie versionnée

`failures-reference.json` est clé sur la **fermeture des sources** de `failures.ts`, qui
importe `cli.ts`. Toute modification de `cli.ts` change donc la clé, et le cas « la galerie
versionnée porte encore la clé que le code produit » passe au rouge.

Ce n'est pas un défaut : c'est la garde qui fait son travail. Mais la régénération **charge
les encodeurs**, donc elle se planifie — voir la règle suivante.

**Comment retrouver que c'est ça**, parce qu'aucune lecture du code ne le révèle : le cas qui
tombe parle de la galerie, et la modification qui l'a fait tomber n'a rien à voir avec elle.

> Rouge sur « la galerie versionnée porte encore la clé que le code produit » après une
> modification qui semble sans rapport → **regarder ce que `failures.ts` importe**, en
> transitif. La clé est un hachage de la fermeture des sources, pas du fichier seul.

    grep -n "fermetureDesSources\|empreinteDesEntrees" src/failures.ts

Et la question générale, qui dépasse ce cas : **quand un contrôle tombe en parlant d'autre
chose, chercher ce qu'il HACHE, pas ce qu'il nomme.** Une clé de cache porte souvent bien
plus que ce que son nom laisse croire.

## Deux passes qui chargent des modèles ne peuvent pas coexister

Une charge à 17,2 et un `libc++abi: mutex lock failed` pendant que deux sessions
rechargeaient les encodeurs en même temps. Aucune des deux mesures ne valait rien, et
l'abandon natif ressemble à un défaut du code.

**Remède :** **annoncer avant** de lancer une passe qui charge des modèles, et attendre que
la précédente ait rendu la main. Vérifier plutôt qu'annoncer : `sysctl -n vm.loadavg` et
`ps -A -o %cpu=,command= | grep node`.

## `pgrep -f "a\|b"` ne trouve jamais rien

`pgrep` attend une expression **étendue**, où `\|` est un `|` littéral. Le motif ne peut
alors rien trouver, et son zéro se lit « rien ne tourne ». Conséquence payée : une passe de
calcul crue morte, relancée par-dessus, deux passes à 330 % de CPU chacune.

**Remède :** `pgrep -f 'a|b'`, et prouver le relevé pendant que la chose cherchée tourne —
trois secondes suffisent à démasquer un motif muet.

## Un message de commit posé sur le mauvais diff ne se fait jamais attraper

Trois commits sont partis avec le message d'un autre : le contenu de chacun était juste, la
suite était verte, et rien dans l'outillage ne compare un message à son diff. La cause était
une boucle qui extrayait les messages à l'envers — `for i in 3 2 1 … HEAD~$((i-1))` — et
l'inversion est invisible tant qu'on ne lit pas les deux côte à côte.

C'est la faute la plus durable qu'on puisse commettre ici : **un message de commit faux
survit à tout**, parce que rien ne le vérifie jamais. Il sera lu dans six mois comme la
raison d'un changement qu'il ne décrit pas.

**Remède :** avant d'envoyer une série, confronter chaque message au fichier qu'il décrit.

    git log --format='%h %s' -3 | while read h s; do
      printf "%-52s ← %s\n" "$s" "$(git show --format= --name-only "$h" | tr '\n' ' ')"
    done

Le premier jet de cette commande employait `--stat | head -2 | tail -1` : sur un commit à un
seul fichier, la deuxième ligne est le résumé, et elle affichait « 1 file changed » au lieu
du nom. Un remède qui ment sur un cas sur deux est pire que pas de remède ; `--name-only`
nomme les fichiers dans les deux cas.

Corollaire de la même famille : une boucle qui indexe à l'envers ne se signale pas non plus.
Quand un script écrit N fichiers depuis N sources, vérifier **un** couple à la main coûte
trois secondes et attrape l'inversion entière.

## Un code de sortie ne se lit jamais après un tube

Un tube remplace le code de sortie par celui du **dernier** maillon : `cmd | head -2` rend
le code de `head`, qui vaut 0 quoi qu'il arrive. La commande a beau refuser en 2, la mesure
lit 0 — et on conclut que la garde ne refuse pas.

Signalé par une session à une autre, puis commis par celle qui l'avait signalé quatre heures
plus tard, sur la garde qu'elle venait d'installer. **Le connaître ne protège pas ; seule
la façon d'écrire la commande protège.**

Et sous `zsh`, la parade habituelle n'existe pas : `PIPESTATUS` est **vide**, c'est
`$pipestatus[1]` (indexé à partir de 1). Une vérification écrite avec `${PIPESTATUS[0]}` ne
lit donc rien du tout, et son silence ressemble à un succès.

**Remède :** capturer le code **avant** tout tube.

    sortie=$(cmd 2>&1); code=$?
    printf '%s\n' "$sortie" | head -2      # le tube vient après, sur la variable

Ou, quand la sortie n'est pas nécessaire : `cmd > /dev/null 2>&1; code=$?`.
