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

## Le fait et son implication ne se vérifient pas au même endroit

Formulé par la session qui l'a payé : *« le fait et son implication ne se vérifient pas au
même endroit, et je n'avais vérifié que le fait. »*

Un contrôle établit qu'une chose est vraie ici, et on en tire ce qu'elle implique ailleurs —
sans aller voir ailleurs. Les deux moitiés ont l'air d'une seule vérification parce qu'elles
sont dites dans la même phrase.

Trois instances du même jour :

- « la question affichée est celle qui est posée » — vrai du gabarit, faux du chemin qui
  l'emprunte ; personne n'avait comparé les deux **chaînes**.
- « `identite/provenance.ts` n'est pas modifié » — les trois contrôles disaient *propre
  maintenant*, la conclusion écrite disait *n'a jamais été modifié*. Une copie prise avant
  restauration a tranché : le marqueur avait bel et bien disparu.
- « aucune dépendance n'exécute de code à l'installation » — voir l'entrée suivante.

**Remède :** écrire la vérification et l'implication comme deux phrases, et se demander pour
la seconde *quel fichier je devrais ouvrir pour l'établir*. Si la réponse est « aucun, ça
découle », c'est qu'elle ne découle pas.

## Un négatif sans dénominateur n'est pas une mesure

Commité dans ce dépôt : *« No dependency runs code at install time, and every one is
pinned. »* Mesuré depuis, sur l'arbre réel :

    2 paquets sur 216 déclarent un script d'installation
      onnxruntime-node, protobufjs@7.6.5 (postinstall: node scripts/postinstall)
    npm config ignore-scripts : false

L'affirmation est fausse, et **elle l'était probablement au moment où elle a été écrite** — ce
qui n'a pas été vu, c'est qu'aucun compte ne l'accompagnait. « Aucune dépendance n'exécute de
code » se lit comme un relevé alors que c'est une conviction ; « 0 sur 216 » aurait obligé à
compter, et compter aurait rendu 2.

Et la formule corrigée demandait la même rigueur : dire *« le blocage tient »* suppose un
blocage, qu'il faut alors montrer. `ignore-scripts` vaut `false`, donc ce n'est pas lui. Mesuré
ensuite, sur deux machines par deux sessions :

    npm 12.0.1 · npm install-scripts ls
    2 packages have install scripts blocked because they are not covered by allowScripts:
      onnxruntime-node@1.21.0 (postinstall: node ./script/install)
      protobufjs@7.6.5        (postinstall: node scripts/postinstall)

**Le blocage existe — et il n'est pas dans ce dépôt.** C'est `allowScripts`, une porte de npm
12 fermée par défaut. Un acheteur sur npm ≤ 11, sur yarn ou sur pnpm exécute les deux scripts.

C'est la vraie conclusion et elle vaut plus que l'erreur d'origine : **la sûreté de la chaîne
d'approvisionnement, ici, est héritée de l'outillage de celui qui installe, pas fournie par le
dépôt.** Un audit vendu à une banque doit dire lequel des deux, parce que le client ne choisit
pas notre code mais choisit son gestionnaire de paquets.

Une supposition qui tombe au passage, mesurée par la session qui l'avait faite : le postinstall
bloqué d'`onnxruntime-node` **ne laisse pas le binaire natif absent** — `bin/napi-v3/**` est
identique, 208 Mo, entre un arbre où le script a été bloqué et un où il ne l'a pas été. Les
binaires voyagent dans le tarball. Le blocage est sans conséquence fonctionnelle ici, ce qui
est une raison de plus de ne pas le confondre avec une garde.

**Remède :** tout énoncé d'absence porte son dénominateur et la commande qui l'a produit. Sans
ça, c'est une opinion bien présentée — et celle-là a traversé un audit de sécurité.

## Toute copie en bloc lit la liste d'exceptions AVANT d'écrire

Deux sessions, le même jour, à une heure d'intervalle, ont recopié une couche partagée en
bloc et écrasé les fichiers qu'une liste déclarait divergents **par construction** — l'une
`DETACHES` dans `cascade` (dont le fichier de test qui porte la liste), l'autre `ADAPTES` et
`baselines.ts`, ce qui a cassé la compilation d'un dépôt voisin.

Les deux listes existaient, étaient justes, et portaient leur raison écrite. **Aucune des
deux copies ne les a lues.** Ce n'est donc pas une question d'attention : une copie « tous
les fichiers de même nom » est un motif, et **un motif est une affirmation** — celui-ci
affirme que tout fichier partageant un nom doit partager un contenu, ce que la liste
d'exceptions dit précisément être faux.

**Et une comparaison en bloc doit la lire autant qu'une copie.** Une boucle qui compare
fichier à fichier sans lire les dispenses rend des divergences qui n'en sont pas — six d'un
coup, toutes `baselines.ts` — avec l'aplomb d'un relevé. La forme *mesure* du même piège, et
elle est plus discrète : elle ne casse rien, elle fait chercher.

**Remède :** la liste se lit dans le dépôt CIBLE, à chaque copie, jamais reportée de mémoire
d'un dépôt à l'autre — deux dépôts n'ont pas les mêmes dispenses.

    EX=$(grep -oE '^\s+"[a-z.-]+\.(ts|mjs|js|css)":' "$d/src/registre.test.ts" | tr -d ' ":')
    for f in identite/*; do
      echo "$EX" | grep -qx "$(basename "$f")" && continue     # dispensé : on passe
      …
    done

Et vérifier l'extraction sur un dépôt dont on connaît déjà la réponse avant de s'en servir
sur les autres : une extraction qui rend une liste vide dispense zéro fichier et ressemble
exactement à une copie qui s'est bien passée.

## Une recherche par nom rend la copie PUBLIÉE avant la source

`find . -name graphes.js | head -1` rend `./docs/graphes.js`, pas `./src/graphes.js`. La
copie atterrit donc dans la page construite ; puis `npm run pages` la réécrit depuis la
source, **qui n'a jamais été mise à jour** — et la garde d'identité reste rouge exactement
sur les fichiers dont la copie publiée est un artefact de construction.

**Le symptôme désigne le mauvais endroit** : on regarde `docs/`, qui vient d'être régénéré et
paraît correct, alors que le défaut est dans `src/`. C'est ce qui rend ce piège cher — il se
répare en apparence tout seul à chaque construction.

**Remède :** exclure les dossiers construits de toute recherche de source.

    find "$d" -name "$b" -not -path "*/node_modules/*" -not -path "*/docs/*" -not -path "*/dist/*"

## Changer la source partagée vire tous ses consommateurs au rouge

Corollaire de « corrige dans la source, pas dans les copies », et il n'était écrit nulle
part : la source fait foi, **donc la changer casse tous les dépôts qui la copient jusqu'à ce
que chacun recopie.** Mesuré : un correctif porté dans `identite` a mis **dix dépôts** au
rouge simultanément, et ceux dont personne ne s'occupait le sont restés.

Ce n'est pas un défaut de la règle, c'est son coût, et il se paie en une fois. Mais il se
paie **en silence chez les autres** : celui qui corrige la source voit son dépôt vert.

**Remède :** annoncer avant de propager dans la source, pas après ; et propager aux copies
dans la foulée, ou dire qui le fera. Une source corrigée sans ses copies est un travail à
moitié fait qui ressemble à un travail fini.

## Un clone sans `node_modules` rend une erreur d'import, pas un résultat

Un clone frais pour éprouver un correctif n'a pas de dépendances. La commande échoue à la
résolution des modules **avant d'atteindre le code qu'on teste**, et la sortie ressemble à
une exécution : quatre cas « vérifiés », quatre fois le même code, aucun n'ayant chargé le
fichier modifié.

**Remède :** un contrôle positif avant toute série — `node -e 'console.log("ok")'` depuis le
clone — ou lier les dépendances : `ln -sfn ../vrai-depot/node_modules node_modules`.

## `timeout` n'existe pas sur macOS

`timeout 20 cmd` rend **127** et le reste de la ligne ne tourne jamais. Une vérification
écrite ainsi n'échoue pas : elle ne se produit pas, et son absence de sortie se lit comme
« rien à signaler ». Deux vérifications d'affilée ont été perdues comme ça le même soir.

C'est la famille du tube qui mange le code de sortie, en pire : là, la commande absente fait
que **la ligne entière n'a pas d'effet**, donc il n'y a même pas de code faux à lire.

**Remède :** ne pas dépendre d'un binaire non garanti. Pour borner une commande bavarde, le
tube suffit — `head` ferme le tuyau et la commande reçoit SIGPIPE :

    node src/cmd.ts --option 2>&1 | head -3

Et si une vraie limite de durée est nécessaire, `gtimeout` (coreutils) en vérifiant sa
présence, jamais `timeout` supposé.

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

## `Abort trap: 6` pendant `npm test` sous charge n'est pas une régression

    libc++abi: terminating due to uncaught exception of type
      std::__1::system_error: mutex lock failed: Invalid argument
    sh: line 1: 43146 Abort trap: 6    node src/readme.ts --check

C'est la bibliothèque native des encodeurs qui s'abat **pendant sa fermeture**, quand la
machine est chargée. Vérifié au calme : `readme.ts --check` sort 0 quand il passe et 1 quand
il échoue, proprement, sur les deux chemins. Le plantage n'arrive que sous charge.

**Il sort en 134**, donc il ne se déguise pas en succès — c'est sa seule qualité. Mais il
ressemble à un défaut du code, et il coûte le temps qu'on met à chercher dans le code.

**Remède : relancer au calme AVANT d'enquêter.** Si le code passe au second essai sans
qu'une ligne ait changé, c'était la charge. Et regarder ce qui tourne à côté : deux passes
qui chargent des modèles ne peuvent pas coexister sur cette machine (voir plus haut).

**Ce qu'il ne faut PAS en conclure** : qu'un `npm test` rouge est toujours la charge. Un
134 est la charge ; un **1** est un vrai échec, et le distinguer prend une seconde — c'est
le code de sortie qui le dit, à condition de ne pas l'avoir lu à travers un tube.

## Un instrument qui ne lit rien rend zéro, et zéro se lit « ça ne monte pas »

Une sonde mesurait la mémoire du serveur pendant qu'on lui envoyait 100 Mo. Elle a rendu
`-0 Mo` **au repos, pendant, et après** — un `require` laissé dans un module ESM, donc une
lecture morte. La conclusion qui attendait était « la mémoire ne monte pas », c'est-à-dire
exactement ce qu'on espérait lire.

**Un chiffre qui ne bouge JAMAIS est suspect avant d'être rassurant.** Un instrument sain
bouge : la même mesure refaite avec `execFileSync("ps", …)` donne 135 Mo au repos et 144 Mo
après 300 Mo de corps — elle varie, donc elle lit. Le verdict final (« l'impact est nul »)
s'est trouvé identique, et c'est le piège : **la bonne réponse obtenue par un instrument
cassé reste une réponse qu'on n'a pas mesurée.**

**Remède :** avant de publier un zéro ou une constante, vérifier que l'instrument sait rendre
autre chose. Une valeur de repos plausible (135 Mo, pas `-0`) est déjà un test.

## Une règle importée porte le contexte de qui l'a écrite

Le skill `security-audit` interdit toute requête HTTP : « code tracing only, never test
against live APIs ». La règle est juste — elle protège d'un audit qui frappe un système
tiers. Elle ne s'appliquait pas ici : la cible était notre propre serveur, sur notre machine,
dans un clone à nous, et le lot demandait explicitement de l'éprouver en marche.

**Une règle qu'on suit sans savoir pourquoi elle existe se suit aussi quand elle ne
s'applique pas** — et l'audit se serait réduit à relire du code qui, précisément, a l'air
correct. Les deux défauts trouvés ce jour-là ne se voyaient qu'en lançant : 437 ms par
requête, et une route POST qui répond 200 à 100 Mo.

**Remède :** retrouver la raison de la règle avant de l'appliquer **ou** de s'en écarter, et
**dire l'écart dans le rapport**. Une divergence annoncée se discute ; une divergence
silencieuse se découvre.

## Une garde portée par deux routes sur trois n'est pas une garde

`PLAFOND_CORPS` était appliqué par `corps()`, que deux routes POST sur trois appelaient.
`/api/optimum` n'avait pas besoin du corps, donc ne le lisait pas, donc échappait à la
borne : 100 Mo y répondaient 200. L'impact mesuré était nul — Node jette ce que personne ne
lit — mais **c'est un usage, pas une garde**, et la route suivante copiera peut-être celle
qui ne l'a pas.

**Remède :** un cas qui dérive la liste des routes du routeur lui-même, jamais d'une liste
écrite à la main — sinon la quatrième route arrive non couverte exactement comme la
troisième, et le vert du cas dit seulement que les trois routes connues vont bien.

## Corriger la lenteur avant de poser une limite

`/api/etat` coûtait 437 ms, et la tentation était d'ajouter une limite de débit. Elle aurait
**masqué** la lenteur : le plafond aurait été calibré sur un coût qui n'avait pas lieu
d'être, et personne ne serait revenu dessus.

Trois appels consécutifs sans changement d'état rendaient le **même objet à l'octet près** :
le calcul était redondant, pas cher. Une fois mémorisé sur ce dont il dépend, 440 ms → 1,5 ms.
La limite reste utile ensuite, mais elle protège d'un abus au lieu de cacher un défaut.

**Remède :** devant une route lente, chercher d'abord ce qui est recalculé pour rien. La
question qui tranche : *deux appels identiques rendent-ils le même résultat ?*
## `npm install` efface les caches que les bibliothèques rangent sous `node_modules`

**Le fait.** Ajouter deux dépendances de développement — `fast-check` et
`@stryker-mutator/core` — a effacé **1,3 Go de poids d'encodeur** rangés par
`@huggingface/transformers` dans `node_modules/@huggingface/transformers/.cache`. npm élague
tout ce qui n'appartient pas à l'arbre qu'il vient de résoudre, et un cache n'y appartient pas.

**Ce que ça a coûté.** Le cas qui garantit qu'aucune valeur du client n'entre dans le fichier
qu'on lui rend s'est mis à s'ignorer : `poidsEnCache()` rend `false`, et le contrôle le plus
important du dépôt ne tourne plus localement. Il tourne encore en intégration continue, qui
met ce dossier en cache exprès — c'est d'ailleurs pourquoi cette mise en cache existe.

**Comment le repérer.** Après tout `npm install`, `npm ci`, ou toute commande qui touche aux
dépendances : `node -e 'import("./src/tiers.ts").then(t=>console.log(t.poidsEnCache()))'`.
Un `false` inattendu est ça. Le symptôme visible est « skipped 1 » à la fin de la suite —
et une suite verte avec un ignoré ressemble à une suite verte.

**Le remède.** Ranger un cache coûteux HORS de `node_modules`, ou accepter le
retéléchargement et le dire dans le rapport. La leçon générale : `node_modules` n'est pas un
endroit où garder quoi que ce soit qu'on ne veut pas reperdre — c'est un dossier dérivé, et
npm se réserve le droit de le reconstruire entièrement.

**La famille.** Même forme que « ce que git ne transporte pas » : un état précieux rangé dans
un dossier qu'un outil considère comme le sien.
