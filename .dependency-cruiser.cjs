/*
 * LES RÈGLES D'ARCHITECTURE, APPLIQUÉES AU LIEU D'ÊTRE ÉCRITES.
 *
 * Ce dépôt affirme trois choses dans sa prose, et rien ne les tenait :
 *   — le composant licencié dépend du banc public, JAMAIS l'inverse ;
 *   — ce qui part au navigateur ne touche ni au système de fichiers ni aux sous-processus ;
 *   — un cycle d'imports rend une passe non reproductible sans que rien ne le dise.
 *
 * Une règle d'architecture écrite en prose est une intention. Celle-ci se déclenche.
 */
module.exports = {
  forbidden: [
    {
      name: "pas-de-cycle",
      severity: "error",
      comment:
        "Un cycle d'imports rend l'ordre d'évaluation dépendant du point d'entrée : un module "
        + "voit une moitié de son voisin selon qui a été chargé en premier. Le symptôme est un "
        + "`undefined` qui n'apparaît que dans une commande sur deux.",
      from: {},
      to: { circular: true },
    },
    {
      name: "le-navigateur-ne-touche-pas-au-systeme",
      severity: "error",
      comment:
        "Les modules compilés vers docs/js partent au navigateur. Un import de node:fs ou de "
        + "node:child_process y est du code mort au mieux, et au pire il révèle l'architecture "
        + "interne à quiconque lit la page — ce qu'on a déjà payé une fois avec tiers.js, qui "
        + "publiait http://localhost:11434 et trois routes d'API sur la page de vente.",
      from: { path: "^src/(optimise|paliers|corpus|assumptions|cli|interval)\\.ts$" },
      /* Enregistrés SANS le préfixe : `fs`, pas `node:fs`. Le premier motif visait
             `^node:` et ne pouvait rien attraper — un zéro obtenu sur une forme qui n'existe
             pas dans les données. */
      to: { path: "^(node:)?(fs|child_process|os|net|http)$" },
    },
    {
      name: "pas-d-orphelin",
      severity: "warn",
      comment: "Un module que rien n'importe est soit mort, soit un point d'entrée non déclaré.",
      from: { orphan: true, pathNot: "\\.(test|d)\\.(ts|mts)$|^src/(server|pages|readme|landing)\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules|\\.stryker-tmp|^docs/" },
    tsConfig: { fileName: "tsconfig.json" },
    /* Ce dépôt importe avec l'extension `.ts` (allowImportingTsExtensions). Sans ces deux
       lignes, dependency-cruiser résout zéro dépendance sur 44 modules et rend « aucune
       violation » en n'ayant regardé qu'un morceau du graphe. */
    enhancedResolveOptions: { extensions: [".ts", ".mts", ".js", ".mjs", ".json"] },
    tsPreCompilationDeps: true,
  },
};
