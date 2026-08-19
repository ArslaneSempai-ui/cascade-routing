/**
 * Le routing optimal, et le prix de la contrainte.
 *
 * Chain A routes **per field**: each field can go to a different tier, and that is where
 * the entire gain sits. Chain B has one decision, so a single
 * choix — la comparaison des deux est l'enseignement du projet.
 *
 * The figure that decides is neither the cost nor the accuracy: it is the **shadow price**
 * of the budget. How much accuracy does the next dollar buy? While it buys a lot, the
 * constraint binds and is worth loosening. Once it buys nothing, spending more
 * est du gaspillage, et c'est ailleurs qu'il faut regarder.
 */
import { TIERS } from "./paliers.js";
import { isMain } from "./cli.js";
import { FIELDS } from "./corpus.js";
import { pricePerThousand, accuracy, latency, ASSUMPTIONS } from "./assumptions.js";
import { rate, distinguishable, pairedVerdict } from "./interval.js";
/**
 * La best affectation field par field sous contrainte de budget.
 *
 * Five fields, four tiers: 1,024 combinations. Every one is enumerated rather than a
 * heuristic applied — at this size exhaustive search is instant and it guarantees
 * l'optimum, ce qu'aucune heuristique ne fait.
 */
/**
 * Ce que vaut *une* affectation, celle du modèle ou celle du lecteur.
 *
 * L'optimiseur l'appelait mille vingt-quatre fois sans jamais la rendre. L'écran, lui,
 * demande le contraire : le lecteur pose son propre routage et veut savoir ce qu'il coûte
 * — c'est la même arithmétique, et il n'y en aura donc qu'une.
 */
/**
 * La latence représentative d'un palier, pour l'afficher.
 *
 * Un palier local se facture au temps, et son temps dépend du champ : le prix « du palier »
 * n'existe donc pas vraiment pour lui. Cette moyenne sur les cinq champs sert à remplir une
 * colonne d'écran, jamais à décider un routage — le routage, lui, utilise la latence du
 * champ concerné, ce qui est toute la différence entre montrer un ordre de grandeur et
 * calculer une réponse.
 */
export function latenceRepresentative(p, tier) {
    const parChamp = p.extraction[tier];
    if (!parChamp)
        return 0;
    const l = FIELDS.map((c) => parChamp[c]?.latency ?? 0);
    return l.reduce((s, x) => s + x, 0) / l.length;
}
export function evaluer(p, h, routing) {
    let sommeJustesse = 0, cost = 0, seconds = 0;
    for (const c of FIELDS) {
        const e = routing[c];
        const profil = p.extraction[e][c];
        sommeJustesse += accuracy(e, profil.accuracy, h);
        cost += (h.volume / 1000) * pricePerThousand(e, h, profil.latency);
        seconds += (h.volume * latency(e, profil.latency, h)) / 1000;
    }
    const latencyPerItem = (seconds * 1000) / h.volume;
    return {
        routing,
        accuracy: sommeJustesse / FIELDS.length,
        cost, seconds,
        budgetShare: h.budget === 0 ? Infinity : cost / h.budget,
        latencyPerItem,
        latencyShare: h.latencyBudgetMs === 0 ? Infinity : latencyPerItem / h.latencyBudgetMs,
    };
}
/**
 * Les paliers réellement mesurés, et eux seuls.
 *
 * Le profil gelé ne contient pas forcément toute l'échelle. Les paliers génératifs
 * demandent un serveur Ollama et huit gigaoctets de modèles : quelqu'un qui clone ce dépôt
 * et lance `npm run measure` obtient un profil à quatre paliers, et l'outil doit continuer
 * de fonctionner exactement comme avant.
 *
 * Router vers un palier absent du profil n'est pas une possibilité dégradée, c'est une
 * lecture de `undefined` — ce que ce fichier faisait la première fois que l'échelle est
 * passée de quatre à sept. Un test tient maintenant cette propriété.
 */
export function paliersMesures(p) {
    const complets = TIERS.filter((e) => p.extraction[e] !== undefined && p.classification[e] !== undefined);
    /*
     * Un palier mesuré sur une seule chaîne disparaissait des deux, sans un mot.
     *
     * C'est arrivable dès qu'une mesure est interrompue entre l'extraction et la
     * classification : le profil garde la moitié du travail, l'outil route comme si le palier
     * n'existait pas, et la page publie un optimum calculé sur un jeu de paliers amputé sans
     * que rien ne le dise. Un profil incomplet doit se voir.
     */
    const partiels = TIERS.filter((e) => !complets.includes(e)
        && (p.extraction[e] !== undefined || p.classification[e] !== undefined));
    if (partiels.length) {
        console.warn(`profil incomplet : ${partiels.join(", ")} n'est mesuré que sur une chaîne `
            + `et sera ignoré — relancer \`npm run measure --tiers=${partiels.join(",")}\``);
    }
    return complets;
}
/**
 * Deux affectations que l'échantillon ne sait pas départager.
 *
 * L'optimiseur maximisait une estimation ponctuelle. Sur 120 cas, 96,7 % et 91,7 % ont des
 * intervalles qui se touchent : préférer le premier n'est peut-être que du bruit, et un
 * client se verrait facturer un changement qui n'améliore rien de mesurable. C'est aussi la
 * première chose qu'un validateur de modèles demandera.
 *
 * Le test se fait champ par champ, sur les seuls champs où les deux affectations diffèrent.
 * `distinguishable` vit déjà dans `interval.ts` — il compare deux intervalles de Wilson, ce
 * qui est conservateur : il conclut « on ne peut pas les départager » plus souvent qu'un
 * test apparié, et l'erreur va donc du côté prudent, qui est le moins cher.
 *
 * L'humain est exclu du test, et pour une raison de fond : sa justesse est une hypothèse et
 * non une mesure. Une hypothèse n'a pas d'échantillon, donc pas d'intervalle, et la traiter
 * comme mesurée ferait entrer une opinion dans un calcul de significativité.
 */
/**
 * Deux paliers que l'échantillon ne sait pas départager, sur un champ.
 *
 * Deux tests, et le bon dépend de ce qu'on a sous la main.
 *
 * **Apparié quand on peut.** Les deux paliers sont notés sur les mêmes cas : ce ne sont pas
 * deux échantillons indépendants, c'est un échantillon jugé deux fois. La question n'est donc
 * pas « les deux taux se recouvrent-ils » mais « parmi les cas où ils divergent, la
 * répartition se distingue-t-elle d'une pièce lancée ». C'est McNemar, et `pairedVerdict` le
 * fait exactement.
 *
 * **Intervalles sinon.** Un profil mesuré avant que les réussites par cas soient enregistrées
 * n'a que des taux. Le test par recouvrement reste valable, il est simplement plus prudent —
 * il conclut « indiscernables » plus souvent qu'il ne devrait, ce qui pousse vers le palier le
 * moins cher. L'erreur va du bon côté, et un profil ancien continue de fonctionner.
 */
function memeChamp(p, a, b, c) {
    const qa = p.extraction[a][c], qb = p.extraction[b][c];
    if (qa.reussites && qb.reussites && qa.reussites.length === qb.reussites.length) {
        let gains = 0, pertes = 0;
        for (let i = 0; i < qa.reussites.length; i++) {
            const ra = qa.reussites[i] === "1", rb = qb.reussites[i] === "1";
            if (ra && !rb)
                gains++;
            else if (rb && !ra)
                pertes++;
        }
        return !pairedVerdict(gains, pertes).decidable;
    }
    const ra = rate(Math.round(qa.accuracy * qa.items), qa.items);
    const rb = rate(Math.round(qb.accuracy * qb.items), qb.items);
    return !distinguishable(ra, rb);
}
function indiscernables(p, a, b) {
    for (const c of FIELDS) {
        if (a[c] === b[c])
            continue;
        if (a[c] === "human" || b[c] === "human")
            return false;
        if (!memeChamp(p, a[c], b[c], c))
            return false;
    }
    return true;
}
export function optimiseExtraction(p, h) {
    let best = null;
    const evaluate = (routing) => evaluer(p, h, routing);
    const paliers = paliersMesures(p);
    /*
     * Deux passes, et non une, parce que « indiscernable » n'est pas transitif.
     *
     * A peut être indiscernable de B, B de C, et A distinguable de C. Une comparaison au fil
     * de l'énumération rendrait donc le résultat dépendant de l'ordre de parcours — un
     * optimiseur qui répond autrement selon la façon dont on l'a écrit, ce qui est
     * exactement ce qu'un « exhaustif, pas heuristique » promet de ne jamais faire.
     *
     * Passe 1 : la meilleure justesse atteignable dans le budget.
     * Passe 2 : parmi tout ce que l'échantillon ne distingue pas d'elle, la moins chère.
     */
    const tenables = [];
    const walk = (i, current) => {
        if (i === FIELDS.length) {
            const s = evaluate(current);
            if (s.cost > h.budget)
                return; // hors budget : la solution n'existe pas
            if (s.latencyPerItem > h.latencyBudgetMs)
                return; // trop lente : elle n'existe pas non plus
            tenables.push(s);
            if (!best || s.accuracy > best.accuracy
                || (s.accuracy === best.accuracy && s.cost < best.cost))
                best = s;
            return;
        }
        for (const e of paliers)
            walk(i + 1, { ...current, [FIELDS[i]]: e });
    };
    walk(0, {});
    if (!best)
        return null;
    const sommet = best;
    let retenue = sommet;
    for (const s of tenables) {
        if (s.cost < retenue.cost && indiscernables(p, s.routing, sommet.routing))
            retenue = s;
    }
    return retenue;
}
/** Chain B: one tier for everything, so as many possibilities as measured tiers. */
export function optimiseClassification(p, h) {
    const options = paliersMesures(p).map((e) => {
        const profil = p.classification[e];
        const cost = (h.volume / 1000) * pricePerThousand(e, h, p.classification[e].latency);
        return {
            tier: e,
            accuracy: accuracy(e, profil.accuracy, h),
            cost,
            affordable: cost <= h.budget,
        };
    });
    const tenables = options.filter((o) => o.affordable);
    const chosen = tenables.length
        ? tenables.reduce((a, b) => (b.accuracy > a.accuracy || (b.accuracy === a.accuracy && b.cost < a.cost) ? b : a))
        : null;
    return { options, chosen };
}
/**
 * Le prix fictif du budget.
 *
 * On desserre le budget d'un pas et on regarde ce que la accuracy gagne. Le rapport est
 * what the next dollar is genuinely worth — and it falls to zero long before the budget
 * looks comfortable, which is precisely what a committee needs to be told.
 */
export function budgetShadowPrice(p, h) {
    const base = optimiseExtraction(p, h);
    if (!base)
        return null;
    /*
     * La step, pas la pente.
     *
     * A first version loosened the budget by 10 % and concluded "the next dollar buys
     * nothing". That was exact and useless: the next gain does not cost 10 %
     * de plus, il coûte un tier entier — ici quarante fois le budget current. Un prix
     * price computed over too short a step measures a slope where the ground is a
     * staircase, and concludes "not worth spending" when the true sentence is "the next
     * improvement costs this much".
     *
     * So what is sought is the smallest budget that genuinely buys something better.
     */
    let step = null;
    let low = base.cost, high = Math.max(base.cost * 2, 1);
    const better = (b) => {
        const s = optimiseExtraction(p, { ...h, budget: b });
        return s && s.accuracy > base.accuracy + 1e-9 ? s : null;
    };
    // Double until an improvement appears, then narrow by bisection.
    let reached = null, rounds = 0;
    while (!(reached = better(high)) && rounds++ < 40) {
        low = high;
        high *= 2;
    }
    if (reached) {
        for (let i = 0; i < 40; i++) {
            const mid = (low + high) / 2;
            const s = better(mid);
            if (s) {
                high = mid;
                reached = s;
            }
            else
                low = mid;
        }
        step = { budget: high, accuracy: reached.accuracy, routing: reached.routing };
    }
    return {
        currentBudget: h.budget,
        currentAccuracy: base.accuracy,
        currentCost: base.cost,
        /** Does the constraint bind? If the budget is not consumed, no. */
        constraintBinds: base.budgetShare > 0.98,
        /** What the next real improvement costs, and what it returns. */
        step: step && {
            budgetNeeded: step.budget,
            extra: step.budget - base.cost,
            gainPoints: (step.accuracy - base.accuracy) * 100,
            pointsPerThousandEuros: ((step.accuracy - base.accuracy) * 100)
                / ((step.budget - base.cost) / 1000),
            routing: step.routing,
        },
    };
}
if (isMain(import.meta)) {
    /* Chargé ici et pas en tête : `measure.ts` ouvre des fichiers et tire le runtime des
     * modèles. L'écran importe ce module dans un navigateur, où ni l'un ni l'autre n'existe. */
    const { readProfiles } = await import("./measure.js");
    const p = readProfiles();
    if (!p) {
        console.error("No profile measured — start with: npm run measure");
        process.exit(1);
    }
    const h = ASSUMPTIONS;
    const euro = (n) => "$" + Math.round(n).toLocaleString("en-GB");
    const pc = (x) => (x * 100).toFixed(1) + " %";
    console.log(`\n${h.volume.toLocaleString("en-GB")} records · budget ${euro(h.budget)}`);
    console.log(`human accuracy assumed at ${pc(h.humanAccuracy)} — this is not a measurement\n`);
    const a = optimiseExtraction(p, h);
    if (!a) {
        console.log("No routing fits this budget.\n");
        process.exit(0);
    }
    console.log("CHAIN A — optimal routing, field by field\n");
    console.log("field         tier chosen    accuracy    cost");
    console.log("─".repeat(52));
    for (const c of FIELDS) {
        const e = a.routing[c];
        const j = accuracy(e, p.extraction[e][c].accuracy, h);
        console.log(`${c.padEnd(13)}${e.padEnd(15)}${pc(j).padStart(7)}   ${euro((h.volume / 1000) * pricePerThousand(e, h, p.extraction[e][c].latency)).padStart(8)}`);
    }
    console.log("─".repeat(52));
    console.log(`${"".padEnd(13)}${"total".padEnd(15)}${pc(a.accuracy).padStart(7)}   ${euro(a.cost).padStart(8)}`);
    const b = optimiseClassification(p, h);
    console.log("\n\nCHAIN B — one tier for everyone\n");
    console.log("tier         accuracy       cost   affordable");
    console.log("─".repeat(45));
    for (const o of b.options) {
        console.log(`${o.tier.padEnd(12)}${pc(o.accuracy).padStart(7)}   ${euro(o.cost).padStart(9)}   ${o.affordable ? "yes" : "no"}${b.chosen?.tier === o.tier ? "   <- chosen" : ""}`);
    }
    const f = budgetShadowPrice(p, h);
    if (f) {
        console.log("\n\nPRICE OF THE NEXT IMPROVEMENT\n");
        console.log(`  budget used: ${euro(f.currentCost)} of ${euro(f.currentBudget)} — ${pc(a.budgetShare)}`);
        console.log(`  the constraint ${f.constraintBinds ? "BINDS" : "does not bind"}`);
        if (!f.step) {
            console.log("  no budget buys anything better — the ceiling is in the tiers available.\n");
        }
        else {
            const m = f.step;
            console.log(`  next gain: +${m.gainPoints.toFixed(1)} point(s) of accuracy`);
            console.log(`  it costs ${euro(m.extra)} more — ${(m.budgetNeeded / f.currentCost).toFixed(0)}x current spend`);
            console.log(`  yield: ${m.pointsPerThousandEuros.toFixed(3)} point per thousand euros`);
            const change = FIELDS.filter((c) => m.routing[c] !== a.routing[c]);
            console.log(`  what changes: ${change.map((c) => `${c} -> ${m.routing[c]}`).join(", ")}\n`);
        }
    }
}
