/**
 * Measure each tier once, then freeze.
 *
 * This is what the field actually does, and it is the only honest option: you do not
 * compare models on figures published by the people selling them. You run them on your
 * own set, record what they return, and keep the record.
 *
 * The saved profile carries accuracy and latency — measured — and nothing else. Price is
 * not a measurement: it is an assumption, it belongs to the screen and it is arguable.
 * Mixing the two would pass a tariff off as a fact.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { isMain } from "./cli.js";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { generateRecords, generateAlerts, FIELDS } from "./corpus.js";
import { TIERS, ENCODEURS, GENERATIFS, loadExtractors, loadClassifiers, loadGeneratifs, extract, classify, correct } from "./tiers.js";
const FICHIER = new URL("../data/profiles.json", import.meta.url).pathname;
export function readProfiles() {
    return existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, "utf8")) : null;
}
/** Le quantile d'une série, pour dire une durée avec sa dispersion. */
function quantile(xs, q) {
    if (!xs.length)
        return 0;
    const tri = [...xs].sort((a, b) => a - b);
    const i = Math.min(tri.length - 1, Math.max(0, Math.round(q * (tri.length - 1))));
    return tri[i];
}
export async function measure(howMany = 120, options = {}) {
    /*
     * Measured on the held-out half, never on the training half.
     *
     * The first run gave the rules 100 % on all five fields: they had been written against
     * the very templates used to score them. The parameter is explicit so that getting this
     * wrong takes typing it.
     */
    const dossiers = generateRecords(howMany, "heldout");
    const alertes = generateAlerts(howMany, "heldout");
    /*
     * Quels paliers, et pourquoi c'est un choix et non un défaut.
     *
     * L'échelle générative demande un serveur Ollama et huit gigaoctets de modèles. La
     * propriété la plus précieuse de ce dépôt est qu'un inconnu le clone et reproduit ses
     * chiffres en deux minutes sans rien installer ; la mettre derrière un téléchargement
     * pour gagner une ligne de tableau serait un mauvais échange.
     */
    const demandes = options.tiers?.length ? options.tiers : null;
    const paliers = demandes ?? (options.llm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS);
    if (options.llm || paliers.some((e) => GENERATIFS.includes(e)))
        await loadGeneratifs();
    const loadTime = {};
    let t = performance.now();
    await loadExtractors();
    const chargeExtraction = performance.now() - t;
    t = performance.now();
    await loadClassifiers();
    const chargeClassement = performance.now() - t;
    /*
     * On écrit après chaque palier, pas à la fin.
     *
     * Une passe sur les deux échelles dure une heure et demie. Écrire une seule fois, à la fin,
     * veut dire qu'une coupure à la quatre-vingt-neuvième minute ne laisse rien — pas un
     * chiffre, pas une trace. C'est arrivable pour des raisons idiotes : une machine qui se met
     * en veille, un `ollama serve` qui meurt, un terminal fermé.
     *
     * La fusion existait déjà pour ne pas effacer les paliers non mesurés ; il suffit de s'en
     * servir plus souvent. Un palier terminé est un palier gardé, et relancer ne refait que ce
     * qui manque.
     */
    const version = (() => {
        try {
            const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim();
            const sale = execFileSync("git", ["status", "--porcelain"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim().length > 0;
            return { commit, sale };
        }
        catch {
            return undefined;
        } // dépôt cloné sans git, ou git absent : on n'invente rien
    })();
    const sauver = (ex, cl, lt) => {
        const ancien = readProfiles();
        const partiel = {
            measuredAt: new Date().toISOString(),
            code: version,
            extraction: { ...(ancien?.extraction ?? {}), ...ex },
            classification: { ...(ancien?.classification ?? {}), ...cl },
            loadTime: { ...(ancien?.loadTime ?? {}), ...lt },
            tiers: [],
        };
        partiel.tiers = Object.keys(partiel.extraction);
        mkdirSync(dirname(FICHIER), { recursive: true });
        /*
         * Écrire à côté, puis renommer.
         *
         * La sauvegarde incrémentale, posée il y a vingt minutes, a créé un défaut qui n'existait
         * pas quand le fichier n'était écrit qu'une fois : il est maintenant réécrit toutes les
         * quelques minutes, et `writeFileSync` tronque avant de remplir. Une lecture concurrente —
         * `npm run figures` pendant une mesure, ce que j'ai fait deux fois aujourd'hui — peut
         * tomber sur un JSON coupé en deux, et une coupure pendant l'écriture laisserait le profil
         * gelé en morceaux.
         *
         * Le renommage est atomique sur le même système de fichiers : un lecteur voit l'ancien
         * fichier ou le nouveau, jamais un fichier à moitié écrit.
         */
        const provisoire = FICHIER + ".tmp";
        writeFileSync(provisoire, JSON.stringify(partiel, null, 2));
        renameSync(provisoire, FICHIER);
    };
    const extraction = {};
    for (const tier of paliers) {
        extraction[tier] = {};
        loadTime[tier] = tier === "rules" || tier === "human" ? 0 : chargeExtraction + chargeClassement;
        for (const champ of FIELDS) {
            let right = 0;
            const durees = [];
            const bits = [];
            for (const d of dossiers) {
                const t0 = performance.now();
                const got = await extract(tier, d, champ);
                durees.push(performance.now() - t0);
                const bon = correct(got, d.truth[champ]);
                bits.push(bon ? "1" : "0");
                if (bon)
                    right++;
            }
            extraction[tier][champ] = {
                reussites: bits.join(""),
                accuracy: right / dossiers.length,
                latency: quantile(durees, 0.5),
                latencyP10: quantile(durees, 0.1),
                latencyP90: quantile(durees, 0.9),
                items: dossiers.length,
            };
        }
        sauver(extraction, {}, loadTime);
    }
    const classification = {};
    for (const tier of paliers) {
        let right = 0;
        const durees = [];
        const bits = [];
        for (const a of alertes) {
            const t0 = performance.now();
            const got = await classify(tier, a);
            durees.push(performance.now() - t0);
            const bon = got === a.truth;
            bits.push(bon ? "1" : "0");
            if (bon)
                right++;
        }
        classification[tier] = {
            reussites: bits.join(""),
            accuracy: right / alertes.length,
            latency: quantile(durees, 0.5),
            latencyP10: quantile(durees, 0.1),
            latencyP90: quantile(durees, 0.9),
            items: alertes.length,
        };
        sauver(extraction, classification, loadTime);
    }
    /*
     * On fusionne, on n'écrase pas.
     *
     * `npm run measure` mesure les encodeurs. S'il réécrivait le fichier entier, il
     * effacerait les paliers génératifs figés — et le dépôt perdrait en silence la moitié de
     * ses figures publiées parce que quelqu'un a lancé la commande la plus inoffensive du
     * projet. Chaque palier n'écrase que lui-même.
     */
    const ancien = readProfiles();
    const profils = {
        measuredAt: new Date().toISOString(),
        extraction: { ...(ancien?.extraction ?? {}), ...extraction },
        classification: { ...(ancien?.classification ?? {}), ...classification },
        loadTime: { ...(ancien?.loadTime ?? {}), ...loadTime },
        tiers: [],
    };
    profils.tiers = Object.keys(profils.extraction);
    mkdirSync(dirname(FICHIER), { recursive: true });
    writeFileSync(FICHIER, JSON.stringify(profils, null, 2));
    return profils;
}
if (isMain(import.meta)) {
    const llm = process.argv.includes("--llm");
    /* `--cases=N` : la taille d'échantillon est un réglage, pas une constante. À 120 cas le
       plus petit écart détectable est d'environ dix-huit points ; à 1 000, de six. */
    const cases = Number(process.argv.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? 120);
    if (!Number.isFinite(cases) || cases < 20) {
        console.error("--cases doit valoir au moins 20 : en dessous, un taux n'est pas rapportable.");
        process.exit(1);
    }
    /* `--tiers=a,b` remesure ces paliers-là seulement. La fusion garde les autres intacts,
       donc on peut refaire une latence sans refaire vingt minutes d'encodeurs. */
    const brut = process.argv.find((a) => a.startsWith("--tiers="))?.split("=")[1]?.split(",");
    /* Un nom de palier mal tapé produisait un profil avec une clé inventée, sans un mot. */
    const inconnus = brut?.filter((e) => !TIERS.includes(e)) ?? [];
    if (inconnus.length) {
        console.error(`palier inconnu : ${inconnus.join(", ")}\nles paliers sont : ${TIERS.join(", ")}`);
        process.exit(1);
    }
    const choisis = brut;
    /* Le message doit décrire ce qui va tourner, pas ce que le drapeau le plus courant suggère.
       Il annonçait « the encoder ladder » pendant une mesure de l'échelle générative parce
       qu'il ne regardait que `--llm` — un rapport faux sur son propre travail, dans un dépôt
       qui n'existe que pour refuser ça. */
    const aTourner = choisis ?? (llm ? [...ENCODEURS, ...GENERATIFS] : ENCODEURS);
    const generatifs = aTourner.filter((e) => GENERATIFS.includes(e));
    console.log(`\nMeasuring ${aTourner.filter((e) => e !== "human").join(", ")} on ${cases} held-out cases.`);
    if (generatifs.length)
        console.log("Needs Ollama running. Allow a few minutes per generative tier.");
    else
        console.log("Encoders only. First run downloads 1.26 GB of model weights — allow several minutes\non a fast line, longer on a slow one. Add --llm for the generative tiers (eight gigabytes more).");
    console.log("Tiers not measured here keep their frozen figures.\n");
    const p = await measure(cases, { llm, tiers: choisis });
    const pc = (x) => (x * 100).toFixed(1).padStart(5) + " %";
    console.log("CHAIN A — extraction, accuracy per field\n");
    console.log("tier      " + FIELDS.map((c) => c.padStart(10)).join("") + "     latency");
    console.log("─".repeat(76));
    for (const e of (p.tiers ?? [])) {
        const l = FIELDS.map((c) => pc(p.extraction[e][c].accuracy).padStart(10)).join("");
        const lat = (FIELDS.reduce((s, c) => s + p.extraction[e][c].latency, 0) / FIELDS.length).toFixed(2);
        console.log(`${e.padEnd(10)}${l}   ${lat.padStart(7)} ms`);
    }
    console.log("\n\nCHAIN B — alert classification\n");
    console.log("tier         accuracy    latency");
    console.log("─".repeat(36));
    for (const e of (p.tiers ?? [])) {
        console.log(`${e.padEnd(12)}${pc(p.classification[e].accuracy)}   ${p.classification[e].latency.toFixed(2).padStart(7)} ms`);
    }
    console.log(`\nProfiles frozen in data/profiles.json — ${p.measuredAt}\n`);
}
