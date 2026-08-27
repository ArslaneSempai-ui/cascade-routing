/**
 * `--cases=N`, LU UNE SEULE FOIS POUR TOUT LE DÉPÔT.
 *
 * UNE CHAÎNE VIDE N'EST PAS UN NOMBRE, ET `??` NE LA RATTRAPE PAS. `--cases=` rend la chaîne
 * vide : elle n'est pas nullish, donc le défaut ne se déclenche pas, et `Number("")` vaut
 * **0**. La passe tourne alors sur zéro dossier, affiche « 0 cas », et **écrit son fichier de
 * sortie** — daté, complet, ressemblant à une mesure. `--cases=abc` donne NaN, et
 * `generateRecords` rend zéro dossier pour NaN comme pour 0 comme pour -5.
 *
 * Le refus est AVANT toute mesure, pour que rien ne soit écrit. Un champ `reportable: false`
 * arriverait trop tard : le champ existe, mais l'artefact aussi, et on lit rarement les deux.
 * **Un artefact qui n'établit rien ne doit pas exister.**
 *
 * POURQUOI CE FICHIER ET PAS `cli.ts`. La garde était écrite deux fois, dans `fuite.ts` et
 * `regler-prompt.ts`, et leur commentaire disait déjà que sa place était la couche partagée —
 * en refusant de l'y mettre, parce que `cli.ts` voyage vers six dépôts et que la propagation
 * est une décision qui ne se prend pas dans un correctif. Mesuré le 26 août 2026 : SIX des
 * huit commandes qui lisent `--cases=` n'avaient aucune garde. Ce module est local à ce
 * dépôt : il ferme les six sans rien propager.
 *
 * `departager-reglage --cases=` écrasait un relevé versionné par une passe sur zéro dossier.
 */

/**
 * LE MÊME DÉFAUT SUR UN AUTRE DRAPEAU, ET IL PILONNE LA MACHINE.
 *
 * `--every=` sans valeur donnait `Number("") === 0` à `egress`, donc `setInterval(fn, 0)` :
 * chaque tick lance `ps -Ao` et `lsof` en sous-processus, des centaines par seconde. Le
 * contrôle de confidentialité mettait la machine à genoux pour observer une passe qu'il
 * ralentit au point de changer ce qu'il mesure.
 *
 * La lecture d'un entier de ligne de commande est la même partout : `--cases`, `--every`, et
 * le prochain. Elle vit ici une fois, avec le nom du drapeau dans le refus.
 */
export function lireDrapeauEntier(
  argv: readonly string[], drapeau: string, defaut: number, quoi: string,
): { valeur: number } | { refus: string } {
  const prefixe = `--${drapeau}=`;
  const brut = argv.find((a) => a.startsWith(prefixe))?.split("=")[1];
  /* Le drapeau tapé sans valeur vaut « non précisé » : c'est une frappe interrompue. */
  if (brut === undefined || brut.trim() === "") return { valeur: defaut };
  const n = Number(brut);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { refus:
      `\n  ${prefixe}${brut} is not ${quoi}.\n`
      + `  It must be a whole number above zero.\n` };
  }
  return { valeur: n };
}

/** Ce qu'appellent les commandes pour un entier : refuse en nommant la cause, et ne mesure rien. */
export function drapeauEntier(
  drapeau: string, defaut: number, quoi: string, argv: readonly string[] = process.argv,
): number {
  const r = lireDrapeauEntier(argv, drapeau, defaut, quoi);
  if ("refus" in r) { process.stderr.write(r.refus + "\n"); process.exit(1); }
  return r.valeur;
}

/**
 * LES DRAPEAUX QUE CE MODULE CONSULTE, DÉCLARÉS LÀ OÙ ILS SONT LUS.
 *
 * Une commande qui refuse les drapeaux inconnus doit connaître ceux que ses AIDES lisent pour
 * elle. Recopier « --cases » dans chaque commande, c'est la liste écrite à la main qui oublie
 * — et ici elle ne se contenterait pas d'oublier : elle ferait refuser un drapeau valide, ce
 * qui fait retirer la garde.
 */
export const DRAPEAUX_CAS = ["--cases"] as const;

/** La lecture pure : ni écriture, ni sortie. Testable sans sous-processus. */
export function lireCas(argv: readonly string[], defaut: number): { cas: number } | { refus: string } {
  const brut = argv.find((a) => a.startsWith("--cases="))?.split("=")[1];
  /* `--cases=` sans valeur vaut « non précisé » : c'est une frappe interrompue, pas zéro. */
  if (brut === undefined || brut.trim() === "") return { cas: defaut };
  const n = Number(brut);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { refus:
      `\n  --cases=${brut} is not a number of records.\n`
      + `  It must be a whole number above zero. A pass over zero records is not a\n`
      + `  measurement, and it would leave behind a file that looks like one.\n` };
  }
  return { cas: n };
}

/** Ce qu'appellent les commandes : refuse en nommant la cause, et ne mesure rien. */
export function casDemandes(defaut: number, argv: readonly string[] = process.argv): number {
  const r = lireCas(argv, defaut);
  if ("refus" in r) { process.stderr.write(r.refus + "\n"); process.exit(1); }
  return r.cas;
}
