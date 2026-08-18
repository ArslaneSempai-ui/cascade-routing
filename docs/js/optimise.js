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
export function evaluer(p, h, routing) {
    let sommeJustesse = 0, cost = 0, seconds = 0;
    for (const c of FIELDS) {
        const e = routing[c];
        const profil = p.extraction[e][c];
        sommeJustesse += accuracy(e, profil.accuracy, h);
        cost += (h.volume / 1000) * pricePerThousand(e, h);
        seconds += (h.volume * latency(e, profil.latency, h)) / 1000;
    }
    return {
        routing,
        accuracy: sommeJustesse / FIELDS.length,
        cost, seconds,
        budgetShare: h.budget === 0 ? Infinity : cost / h.budget,
    };
}
export function optimiseExtraction(p, h) {
    let best = null;
    const evaluate = (routing) => evaluer(p, h, routing);
    const walk = (i, current) => {
        if (i === FIELDS.length) {
            const s = evaluate(current);
            if (s.cost > h.budget)
                return; // hors budget : la solution n'existe pas
            // At equal accuracy the cheaper one wins — otherwise you pay for nothing.
            if (!best || s.accuracy > best.accuracy
                || (s.accuracy === best.accuracy && s.cost < best.cost))
                best = s;
            return;
        }
        for (const e of TIERS)
            walk(i + 1, { ...current, [FIELDS[i]]: e });
    };
    walk(0, {});
    return best;
}
/** Chain B: one tier for everything, so four possibilities. */
export function optimiseClassification(p, h) {
    const options = TIERS.map((e) => {
        const profil = p.classification[e];
        const cost = (h.volume / 1000) * pricePerThousand(e, h);
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
        console.log(`${c.padEnd(13)}${e.padEnd(15)}${pc(j).padStart(7)}   ${euro((h.volume / 1000) * pricePerThousand(e, h)).padStart(8)}`);
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
