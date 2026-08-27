import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync, spawn } from "node:child_process";
import { arbreJetable, retirerArbreJetable } from "./arbre-jetable.ts";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, existsSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verdictEgress, connexionsDepuisErreur, pidsSurveilles, connexions, ASSEZ_DE_RELEVES } from "./egress.ts";

/*
 * LA GARDE QUI EMPÊCHE « rien vu » DE SE FAIRE PASSER POUR « rien ».
 *
 * `egress.ts` porte la phrase la plus vendable du dépôt — « nothing leaves the machine ». Il
 * l'établit en échantillonnant `lsof`. Quand `lsof` manque, les trois échecs rendaient le même
 * tableau vide et le relevé publiait « no connection observed for the whole pass » APRÈS
 * N'AVOIR RIEN REGARDÉ. Une absence d'observation ne se distinguait plus d'une observation
 * d'absence, et c'est précisément la confusion qu'un audit se fait payer pour éviter.
 *
 * ─── Pourquoi ce témoin passe par un sous-processus ───
 *
 * `connexions()` n'est pas exportée, et son seul appelant est le `setInterval` du bloc
 * `isMain`. Éprouver `verdictDeLsof({ code: "ENOENT" }) === "absent"` ne fermerait PAS ce
 * site : la décision et sa conséquence sont deux lignes différentes, et rien ne dirait que le
 * refus remonte jusqu'à la sortie de la commande au lieu d'être avalé par le minuteur. Le
 * témoin traverse la couture, donc il lance la commande.
 *
 * ─── Pourquoi une COPIE de egress.ts, et pas celui du dépôt ───
 *
 * `FICHIER` est dérivé de `import.meta.url` : lancer le `src/egress.ts` du dépôt écraserait
 * `egress.json` — le relevé publié — dès que la garde tombe, car le mutant va jusqu'au bout et
 * ÉCRIT. Un témoin ne doit pas abîmer la preuve qu'il garde.
 */

/** Le dossier de `src/`, d'où l'on copie la commande et ce qu'elle importe. */
const source = new URL(".", import.meta.url);

type Bac = { tmp: string; env: NodeJS.ProcessEnv; script: string; observee: string; releve: string };

/**
 * Ce que le bac doit porter — DÉRIVÉ de `egress.ts`, jamais récité.
 *
 * Écrire « egress.ts, cli.ts » à la main casse par le côté silencieux, celui qui coûte : le
 * jour où `egress.ts` importe un deuxième module du dépôt, la copie ne l'emporte pas, la
 * commande meurt sur un import introuvable, et les cas d'en dessous accusent la garde pour
 * une raison qui n'a rien à voir avec elle. La source qui détermine cette liste est le fichier
 * lui-même ; on l'y lit, et on refuse de conclure si la lecture rend moins que ce qu'on sait
 * y être — une dérivation qui rend zéro se lit sinon comme un fichier sans dépendance.
 */
function aCopier(): string[] {
  const texte = readFileSync(fileURLToPath(new URL("egress.ts", source)), "utf8");
  const internes = [...texte.matchAll(/from\s+"\.\/([^"]+)"/g)].map((m) => m[1]!);
  if (internes.length === 0) {
    throw new Error(
      "aucun import relatif lu dans egress.ts : la dérivation ne marche plus, et un bac\n"
      + "  incomplet ferait tomber ces cas sur un module introuvable — ce qui se lit comme une\n"
      + "  garde cassée alors que la garde n'a rien fait.");
  }
  return ["egress.ts", ...internes];
}

/**
 * Un bac à sable qui porte une copie de la commande, un `lsof` à nous, et rien d'autre.
 *
 * Le `PATH` ne contient QUE notre `bin` et le dossier de `node` : `egress.ts` fait
 * `spawn("node", …)`, donc `node` doit s'y trouver, mais aucun `lsof` du système ne doit
 * pouvoir répondre à la place du nôtre.
 *
 * `corpsDeLsof` reçoit le chemin ABSOLU du faux `lsof`. Un script qui voudrait se désigner
 * lui-même par `$0` dépendrait de ce que l'appelant passe en `argv[0]`, ce qui n'est pas à
 * nous ; le chemin, lui, est connu ici et ne peut pas se tromper de fichier.
 */
function bacASable(corpsDeLsof: (chemin: string) => string): Bac {
  /*
   * `realpathSync` N'EST PAS UNE COQUETTERIE.
   *
   * Sur macOS `tmpdir()` rend `/var/folders/…`, qui est un lien vers `/private/var/folders/…`.
   * `isMain()` compare `import.meta.filename` — résolu — à `argv[1]` — littéral : sans cette
   * résolution le bloc principal de `egress.ts` ne s'exécute pas du tout, la commande sort en 0
   * sans un mot, et tous les cas de ce fichier échouent en accusant la garde. Mesuré.
   */
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "egress-")));
  mkdirSync(join(tmp, "src"));
  for (const f of aCopier()) {
    copyFileSync(fileURLToPath(new URL(f, source)), join(tmp, "src", f));
  }
  /* La commande observée : elle ne fait rien, assez longtemps pour dépasser le plancher de
     relevés. Sans ça, la version gardée et la version mutante sortiraient TOUTES DEUX en 1
     sur « passe trop courte », et ni le relevé écrit ni le code de sortie ne diraient plus
     la différence qui compte. */
  const observee = join(tmp, "dort.mjs");
  writeFileSync(observee, "setTimeout(() => {}, 700);\n");

  const bin = join(tmp, "bin");
  mkdirSync(bin);
  const lsof = join(bin, "lsof");
  writeFileSync(lsof, corpsDeLsof(lsof));
  chmodSync(lsof, 0o755);

  return {
    tmp,
    env: { PATH: `${bin}:${dirname(process.execPath)}` },
    script: join(tmp, "src", "egress.ts"),
    observee,
    /* `FICHIER` vaut `../egress.json` depuis `src/` : le relevé atterrit à la racine du bac. */
    releve: join(tmp, "egress.json"),
  };
}

/** Lance la commande copiée et rend ce qu'un appelant peut en voir : son code et son stderr. */
async function passe(b: Bac): Promise<{ code: number; err: string }> {
  const p = spawn(process.execPath, [b.script, "--every=20", b.observee],
    { env: b.env, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr!.setEncoding("utf8");
  p.stderr!.on("data", (d: string) => { err += d; });
  const code: number = await new Promise((r) => p.on("exit", (c) => r(c ?? 0)));
  return { code, err };
}

test("`lsof` qui disparaît EN COURS DE PASSE : la commande refuse de conclure au lieu de publier « rien vu »", async () => {
  /*
   * UN `lsof` PRÉSENT AU DÉMARRAGE, ET SEULEMENT AU DÉMARRAGE.
   *
   * `lsofRepond()` s'exécute AVANT le spawn de la commande observée : un `PATH` sans `lsof`
   * dès le départ sort sur un AUTRE message et n'atteint jamais la ligne gardée. La garde de
   * `connexions()` couvre la fenêtre d'après — celle où l'outil a déjà laissé partir le trafic
   * qu'il prétendait observer. C'est cette fenêtre-là qu'on reproduit.
   *
   * ET ELLE SE REPRODUIT SANS COURSE. Effacer le binaire depuis l'extérieur pendant la passe
   * est une course, et elle a été perdue une fois sur six lancements le 26 août 2026 :
   * `posix_spawn` résout le chemin PUIS échoue à l'exec, ce qui rend `status: 127` — donc
   * « inattendu », donc l'AUTRE refus, une ligne plus bas. Ce cas serait vert la plupart du temps et rouge sans raison le reste, ce
   * qui est pire qu'absent. Ici `lsof` s'efface LUI-MÊME en sortant : la disparition tombe
   * forcément ENTRE deux relevés, puisque `execFileSync` est synchrone et que les rappels du
   * minuteur ne se chevauchent pas. Huit lancements sur huit ont atteint la ligne visée, le
   * 26 août 2026, contre cinq sur six pour la version qui effaçait le binaire de l'extérieur.
   *
   * `/bin/rm` en chemin absolu : le `PATH` du bac ne porte pas `rm`, et un `rm` introuvable
   * laisserait le faux `lsof` en place — le témoin passerait au vert sans avoir rien éprouvé.
   */
  const b = bacASable((chemin) => `#!/bin/sh\n/bin/rm -f '${chemin}'\nexit 0\n`);
  try {
    const { code, err } = await passe(b);

    /*
     * L'ASSERTION PORTE SUR LE MESSAGE, PAS SUR LE CODE DE SORTIE.
     *
     * Le refus voisin — `lsof` a répondu autre chose que 1 — sort lui aussi en 1. N'asserter
     * que le code laisserait passer un témoin qui atteint la mauvaise ligne et croit avoir
     * fermé celle-ci.
     */
    assert.match(err, /`lsof` is not on this machine, so NOTHING was observed/,
      "`lsof` a disparu pendant la passe et la commande n'a rien dit : elle publie « aucune\n"
      + "  connexion » après n'avoir RIEN pu regarder. Une absence d'observation ne se distingue\n"
      + "  plus d'une observation d'absence, et c'est la seule chose que ce fichier existe pour\n"
      + "  empêcher.");
    assert.match(err, /two different sentences/,
      "le refus ne dit plus POURQUOI il refuse : sans cette phrase, le lecteur croit à une\n"
      + "  panne d'outil et relance jusqu'à obtenir un vert.");
    assert.match(err, /apt install lsof/,
      "le refus n'offre plus d'issue : un refus sans issue finit commenté.");

    /*
     * ET LE RELEVÉ NE DOIT PAS EXISTER.
     *
     * Mesuré sans la garde : la passe va au bout, dépasse le plancher, sort en 0 et écrit
     * « no connection observed for the whole pass ». C'est ce fichier-là le mensonge, pas le
     * refus — il est daté, versionné, et c'est lui qu'un acheteur cite.
     */
    assert.equal(existsSync(b.releve), false,
      "un relevé a été écrit alors que rien n'a été observé : le fichier publié affirme\n"
      + "  l'absence de trafic sur la foi d'un outil qui n'a jamais répondu.");
    assert.notEqual(code, 0,
      "la commande sort en 0 après n'avoir rien observé : la chaîne d'intégration la croira.");
  } finally {
    rmSync(b.tmp, { recursive: true, force: true });
  }
});

test("`lsof` qui répond pendant toute la passe : la commande CONCLUT, elle ne refuse pas", async () => {
  /*
   * LE TÉMOIN NÉGATIF, sans quoi le vert d'à côté ne dit pas que la garde est du bon côté.
   *
   * Une garde qui refuserait AUSSI l'usage normal serait retirée, pas corrigée — et le cas
   * précédent, lui, resterait vert. `exit 1` est la réponse de `lsof` pour un processus sans
   * socket ouverte : c'est le cas nominal, et là le vide EST la mesure.
   */
  const b = bacASable(() => `#!/bin/sh\nexit 1\n`);
  try {
    const { code, err } = await passe(b);
    assert.doesNotMatch(err, /NOTHING was observed/,
      "avec un `lsof` qui répond, la commande refuse quand même : la garde interdit l'usage\n"
      + "  normal, donc elle sera retirée, et avec elle la seule chose qui tient la promesse.");
    assert.equal(code, 0, `la passe nominale sort en ${code} au lieu de 0. stderr :\n${err}`);
    assert.equal(existsSync(b.releve), true,
      "la passe nominale n'écrit plus de relevé : la promesse « rien ne sort » redevient une\n"
      + "  affirmation, puisque rien de publiable ne l'établit.");
  } finally {
    rmSync(b.tmp, { recursive: true, force: true });
  }
});

test("`lsof` qui répond n'importe quoi : la commande refuse aussi, et dit quel code elle a reçu", async () => {
  /*
   * LE REFUS VOISIN, ET IL N'EST PAS LE MÊME.
   *
   * `lsof` sort en 1 quand le processus n'a aucune socket : c'est le cas nominal. Tout autre
   * code — permission refusée, binaire cassé, `posix_spawn` qui résout le chemin puis échoue
   * à l'exec et rend 127 — veut dire que L'OBSERVATION N'A PAS EU LIEU. Ce cas-là rendait lui
   * aussi un tableau vide, et le relevé publiait « aucune connexion » sur cette base.
   *
   * Il a son propre témoin parce qu'il a sa propre ligne : rendre la première garde muette
   * laisse celle-ci intacte, et l'inverse est vrai aussi. Un seul cas pour les deux dirait
   * « l'une des deux tient » — ce qui n'est pas ce qu'on veut savoir.
   *
   * Le message DOIT porter le code reçu : sans lui le lecteur ne peut pas distinguer un `lsof`
   * restreint par la politique de sécurité de sa machine d'un `lsof` cassé, et les deux
   * demandent des gestes différents.
   */
  const b = bacASable(() => `#!/bin/sh\nexit 3\n`);
  try {
    const { code, err } = await passe(b);
    assert.match(err, /`lsof` failed with code 3/,
      "`lsof` a répondu un code qui n'est PAS celui d'un processus sans socket, et la commande\n"
      + "  a pris ça pour « aucune connexion ». Elle publie l'absence de trafic sans avoir\n"
      + "  regardé — et le code reçu, seul indice de ce qui a empêché l'observation, est perdu.");
    assert.match(err, /without having looked/,
      "le refus ne dit plus ce qu'il évite : sans cette phrase il se lit comme un caprice, et\n"
      + "  un refus qui se lit comme un caprice se retire.");
    assert.equal(existsSync(b.releve), false,
      "un relevé a été écrit alors que `lsof` n'a jamais observé quoi que ce soit.");
    assert.notEqual(code, 0,
      "la commande sort en 0 après une observation qui n'a pas eu lieu.");
  } finally {
    rmSync(b.tmp, { recursive: true, force: true });
  }
});

/*
 * L'OBSERVATION NE REGARDAIT QU'UN PROCESSUS, ET LA PROMESSE PORTE SUR LA MACHINE.
 *
 * `lsof -p <pid>` ne voit qu'un processus. Une commande qui lance un fils sortait donc du
 * champ sans que rien ne le dise, et l'outil publiait « No connection outside this machine.
 * The sentence "nothing leaves the machine" holds as written for this run. » pendant que le
 * fils tenait une connexion établie.
 *
 * Fabriqué le 26 août 2026, hors suite parce qu'il demande une adresse non-bouclée : un
 * script qui `spawn`e un fils, lequel ouvre une connexion TCP de quatre secondes vers
 * l'adresse LAN de la machine. Trente relevés, code de sortie 0, verdict « aucune connexion »
 * — pendant que le serveur d'en face journalisait la connexion. Le même script, la connexion
 * ouverte par le PÈRE : l'hôte rapporté, vu 27 fois sur 32. Après correctif : « 20 samples
 * over 2 process(es) », l'hôte rapporté 17 fois.
 *
 * Les deux cas ci-dessous tiennent la même chose sans dépendre du réseau de la machine : ils
 * regardent QUELS PROCESSUS sont surveillés, et vérifient de bout en bout sur la boucle
 * locale — dont l'outil se moque pour son verdict, mais qui prouve que le fils est bien lu.
 */
test("une passe trop courte refuse SUR LA SORTIE D'ERREUR, pas en silence", async () => {
  /*
   * LE REFUS QUI SORTAIT EN 1 SANS UN MOT SUR `stderr`.
   *
   * Le plancher de relevés était éprouvé sur `verdictEgress`, la fonction pure. Le CHEMIN
   * qui refuse, lui, n'avait aucun témoin : il écrivait son message sur la sortie standard
   * et sortait en 1. Un appelant qui lit `stderr` — un pas d'intégration continue, un
   * `2>&1 | grep` — voyait un échec muet.
   *
   * Le cas voisin (« lsof répond pendant toute la passe ») ne pouvait pas l'attraper : il
   * observe une passe assez longue, donc il ne passe jamais par ici.
   */
  const b = bacASable(() => `#!/bin/sh\nexit 1\n`);
  try {
    /* Une commande instantanée : zéro relevé, donc sous le plancher à coup sûr. */
    writeFileSync(b.observee, "process.exit(0);\n");
    const { code, err } = await passe(b);

    assert.equal(code, 1, `une passe trop courte sort en ${code} : elle ne refuse plus.`);
    assert.ok(err.trim().length > 0,
      "la commande refuse en 1 avec un `stderr` VIDE. Un appelant qui lit la sortie d'erreur\n"
      + "  ne voit qu'un échec sans cause, et le seul message qui dit quoi faire part dans un\n"
      + "  canal que personne ne regarde à ce moment-là.");
    assert.match(err, new RegExp(`At least ${ASSEZ_DE_RELEVES} are needed`),
      "le refus ne dit plus combien de relevés il faut : un refus sans issue se contourne.");
  } finally {
    rmSync(b.tmp, { recursive: true, force: true });
  }
});

test("la surveillance couvre la descendance, pas seulement le processus lancé", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "egress-descendance-"));
  writeFileSync(join(dossier, "fils.mjs"), "setTimeout(() => {}, 8000);\n");
  writeFileSync(join(dossier, "pere.mjs"),
    "import { spawn } from 'node:child_process';\n"
    + "import { fileURLToPath } from 'node:url';\n"
    + "spawn(process.execPath, [fileURLToPath(new URL('./fils.mjs', import.meta.url))], { stdio: 'ignore' });\n"
    + "setTimeout(() => {}, 8000);\n");

  const pere = spawn(process.execPath, [join(dossier, "pere.mjs")], { stdio: "ignore" });
  try {
    /* Le fils naît APRÈS le père : attendre qu'il existe, sinon le cas mesure une course. */
    let pids: number[] = [];
    for (let i = 0; i < 40 && pids.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
      pids = pidsSurveilles(pere.pid!);
    }

    assert.ok(pids.includes(pere.pid!), "le processus lancé lui-même a disparu du champ.");
    assert.ok(pids.length >= 2,
      `seul ${pids.length} processus surveillé après quatre secondes : le fils n'est jamais\n`
      + "  entré dans le champ. Une commande qui lance un fils publierait « rien ne sort »\n"
      + "  sans avoir regardé là où ça sort.");

    /* CONTRE-ÉPREUVE : la descendance ne doit pas se confondre avec « tous les processus ».
       Un relevé qui rendrait la table entière passerait le cas ci-dessus sans rien tenir. */
    assert.ok(!pids.includes(process.pid),
      "le processus de test est dans la descendance du script lancé : le relevé ne remonte\n"
      + "  pas un arbre, il ramasse la machine.");
  } finally {
    pere.kill();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("une connexion tenue par le FILS est lue, et elle ne l'était pas avant", async () => {
  const { createServer } = await import("node:net");
  const serveur = createServer((s) => { s.on("data", () => {}); });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  const port = (serveur.address() as { port: number }).port;

  const dossier = mkdtempSync(join(tmpdir(), "egress-fils-connecte-"));
  writeFileSync(join(dossier, "fils.mjs"),
    `import { connect } from 'node:net';\n`
    + `const s = connect(${port}, '127.0.0.1', () => s.write('x'));\n`
    + `setTimeout(() => { s.end(); }, 8000);\n`);
  writeFileSync(join(dossier, "pere.mjs"),
    "import { spawn } from 'node:child_process';\n"
    + "import { fileURLToPath } from 'node:url';\n"
    + "spawn(process.execPath, [fileURLToPath(new URL('./fils.mjs', import.meta.url))], { stdio: 'ignore' });\n"
    + "setTimeout(() => {}, 8000);\n");

  const pere = spawn(process.execPath, [join(dossier, "pere.mjs")], { stdio: "ignore" });
  try {
    let avecArbre: ReturnType<typeof connexions> = [];
    for (let i = 0; i < 40 && avecArbre.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      avecArbre = connexions(pidsSurveilles(pere.pid!)).filter((c) => c.port === String(port));
    }
    assert.ok(avecArbre.length > 0,
      `aucune connexion vers le port ${port} n'a été lue en quatre secondes, alors que le fils\n`
      + "  en tient une. C'est le défaut d'origine, et ce cas est le seul à le voir.");

    /* CE QUE VOYAIT L'ANCIEN CODE, exactement : le PID lancé, et lui seul. */
    const sansArbre = connexions([pere.pid!]).filter((c) => c.port === String(port));
    assert.equal(sansArbre.length, 0,
      "le père tient lui-même la connexion : ce cas ne prouve alors rien sur la descendance.");
  } finally {
    pere.kill();
    serveur.close();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un pid disparu entre ps et lsof ne jette pas les connexions réellement vues", () => {
  /*
   * `lsof -p a,b,c` sort en 1 dès qu'UN pid a disparu — les fils brefs meurent précisément
   * dans cette fenêtre — même après avoir listé les sockets des survivants. Jeter l'échantillon
   * transformait des connexions OBSERVÉES en « rien vu », dans le relevé qui promet l'inverse.
   */
  const sortieAvecConnexion =
    "COMMAND PID USER FD TYPE DEVICE SIZE NODE NAME\n"
    + "node 123 u 21u IPv4 0x1 0t0 TCP 127.0.0.1:5000->93.184.216.34:443 (ESTABLISHED)\n";
  const e = Object.assign(new Error("exit 1"), { status: 1, stdout: sortieAvecConnexion });
  const vues = connexionsDepuisErreur(e);
  assert.equal(vues.length, 1,
    "les connexions listées avant la mort d'un pid ont été jetées avec l'échantillon.");
  assert.equal(vues[0]!.hote, "93.184.216.34",
    `l'hôte observé doit survivre au code 1 : ${JSON.stringify(vues)}`);
});

/*
 * LES DEUX TÉMOINS QUI LANCENT LA COMMANDE LE FONT DEPUIS UN BAC, jamais depuis l'arbre
 * vivant : `egress.ts` écrit son relevé À CÔTÉ DE LUI (`../egress.json`), et ma première
 * version écrasait le relevé livré du dépôt — le défaut exact que le contrôle des paramètres
 * a attrapé dans l'heure (« publie intervalleMs=100, le code utiliserait 250 »), et la même
 * famille que releve-scelle ce matin. Un témoin qui salit l'arbre fabrique les rouges des
 * autres. Audit du 27 août 2026.
 */
const BAC_EGRESS = arbreJetable("egress-vivant");
/* `realpathSync`, ET C'EST LE PIÈGE DU JOUR QUI REVIENT : `mkdtemp` rend `/var/…` quand le
   chemin réel est `/private/var/…`. La garde de point d'entrée compare `import.meta.url`
   (résolu) à `argv[1]` (non résolu) : sans cette résolution, egress se CHARGE, ne fait rien,
   sort en 0 — et un témoin qui attend un enfant à surveiller trouve un silence parfaitement
   vert. `lancer()` de commande-eprouvee le fait déjà ; un spawn à la main doit le refaire. */
const CMD_EGRESS = realpathSync(join(BAC_EGRESS, "src", "egress.ts"));
test.after(() => retirerArbreJetable(BAC_EGRESS));

test("tuer egress emporte la commande surveillée — pas d'orphelin qui continue sans témoin",
  { timeout: 20_000 }, async () => {
  /*
   * Sans ça, `pkill egress` (ou le timeout d'un harnais) laissait la commande surveillée
   * tourner SEULE : plus personne n'observait ce qu'elle ouvre, et la surveillance avait
   * l'air d'avoir eu lieu. Et une commande TUÉE par un signal doit se dire : `exit` livre
   * (null, "SIGKILL") et un `c ?? 0` en faisait un code 0 — « normal exit » sur une
   * surveillance interrompue, dans le relevé qui adosse « nothing leaves the machine ».
   */
  const egress = spawn("node", [CMD_EGRESS,
    "--every=100", "--", "-e", "setTimeout(() => {}, 30_000)"],
    { stdio: ["ignore", "pipe", "pipe"] });
  /* On ATTEND l'enfant au lieu de dormir un temps fixe : sous charge, 2,5 s ne suffisaient
     pas toujours et ce cas rougissait par intermittence — la famille que le crochet doit
     ensuite trancher. Un scrutin borné ne rougit que si l'enfant n'arrive JAMAIS. */
  await (async () => {
    const fin = Date.now() + 12_000;
    for (;;) {
      try {
        execFileSync("pgrep", ["-P", String(egress.pid)], { stdio: "pipe" });
        return;
      } catch { /* pas encore de fils */ }
      if (Date.now() > fin) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const fils = execFileSync("pgrep", ["-P", String(egress.pid)], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map(Number);
  assert.ok(fils.length >= 1, "le montage est faux : egress n'a pas d'enfant à surveiller.");

  egress.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1_500));
  for (const pid of fils) {
    let vivant = true;
    try { process.kill(pid, 0); } catch { vivant = false; }
    assert.equal(vivant, false,
      `le fils ${pid} SURVIT à la mort d'egress : la commande surveillée devient orpheline\n`
      + "  et continue sans témoin — la surveillance a l'air d'avoir eu lieu.");
  }
});

test("une commande surveillée TUÉE par un signal se dit, et la passe n'établit rien",
  { timeout: 20_000 }, async () => {
  const egress = spawn("node", [CMD_EGRESS,
    "--every=100", "--", "-e", "setTimeout(() => {}, 30_000)"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let dit = "";
  egress.stderr!.on("data", (b) => { dit += String(b); });
  /* On ATTEND l'enfant au lieu de dormir un temps fixe : sous charge, 2,5 s ne suffisaient
     pas toujours et ce cas rougissait par intermittence — la famille que le crochet doit
     ensuite trancher. Un scrutin borné ne rougit que si l'enfant n'arrive JAMAIS. */
  await (async () => {
    const fin = Date.now() + 12_000;
    for (;;) {
      try {
        execFileSync("pgrep", ["-P", String(egress.pid)], { stdio: "pipe" });
        return;
      } catch { /* pas encore de fils */ }
      if (Date.now() > fin) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  const fils = execFileSync("pgrep", ["-P", String(egress.pid)], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map(Number);
  assert.ok(fils.length >= 1, "le montage est faux : rien à tuer.");
  for (const pid of fils) process.kill(pid, "SIGKILL");
  const code = await new Promise<number>((r) => egress.on("exit", (c) => r(c ?? -1)));
  assert.match(dit, /KILLED by SIGKILL/,
    "une surveillance interrompue par un signal ne le dit pas : elle se lirait comme une\n"
    + "  passe normale, dans le relevé qui adosse « nothing leaves the machine ».");
  assert.ok(code >= 128 || code === 1,
    `le code de sortie doit dire l'interruption, reçu ${code} — un 0 ferait conclure « normal exit ».`);
});

test("le verdict ÉCRIT par le CLI est celui de verdictEgress — sur une passe qui a vu du trafic",
  { timeout: 30_000 }, async () => {
  /*
   * Les deux exemplaires du verdict avaient déjà divergé une fois. Ce cas lance une VRAIE
   * passe dont la commande se connecte à elle-même en boucle locale : le verdict juste est
   * « to this machine only », et un CLI qui réécrirait sa propre logique — ou dirait « no
   * connection » — diverge de la fonction sur cette passe-là. L'égalité est exigée contre le
   * RELEVÉ ÉCRIT, pas contre ce que le code semble faire.
   */
  const programme = `
    const net = require("node:net");
    const srv = net.createServer(() => {}).listen(0, "127.0.0.1", () => {
      const s = net.connect(srv.address().port, "127.0.0.1");
      setTimeout(() => { s.destroy(); srv.close(); }, 6000);
    });`;
  const r = spawnSync("node", [CMD_EGRESS, "--every=100", "--", "-e", programme],
    { encoding: "utf8", timeout: 25_000 });
  const releve = JSON.parse(readFileSync(join(BAC_EGRESS, "egress.json"), "utf8")) as {
    releves: number; verdict: string;
    connexions: { hote: string; vu: number }[]; bouclesLocales: { hote: string; vu: number }[];
  };
  assert.ok(releve.bouclesLocales.length >= 1,
    `le montage est faux : aucune connexion locale observée (stdout: ${r.stdout?.slice(0, 150)})`);
  const attendu = verdictEgress({ releves: releve.releves,
    connexions: [...releve.connexions, ...releve.bouclesLocales] });
  assert.equal(releve.verdict, attendu.verdict,
    "le CLI a écrit un verdict que verdictEgress ne produit pas sur les mêmes données : les\n"
    + "  deux exemplaires ont divergé — le témoin éprouvait la fonction, l'acheteur lit le CLI.");
});
