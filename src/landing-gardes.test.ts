/**
 * LES CONTRÔLES DE COHÉRENCE DE `landing.json`, ÉPROUVÉS SUR UNE VUE FABRIQUÉE.
 *
 * `verifierCoherence` et `verifierSeuils` refusent d'assembler une page dont les chiffres se
 * contredisent entre eux. Trois de leurs refus ont survécu à un balayage qui les retirait un
 * par un : on pouvait les effacer sans qu'aucun cas ne bouge.
 *
 * Ils étaient justes. Ce qui manquait, c'est qu'aucune vue incohérente n'existait pour les
 * déclencher — la vue réelle est cohérente par construction, ce qui est le but. Les cas
 * ci-dessous partent donc de la VRAIE vue et n'en corrompent qu'un champ à la fois : la
 * mutation est celle du défaut qu'on redoute — un chiffre qui a bougé d'un côté et pas de
 * l'autre — et non une vue inventée qui ne ressemble à rien.
 *
 * Les deux fonctions ont été exportées pour ça, comme `poserDecompositionFigee` l'est ailleurs
 * dans ce dépôt pour la même raison : une garde qu'on ne peut pas appeler est une garde qu'on
 * ne peut pas éprouver.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { construire, verifierCoherence, verifierSeuils } from "./landing.ts";
import { readProfiles } from "./measure.ts";

const p = readProfiles()!;
const vueReelle = construire(p) as Record<string, unknown>;
const copie = () => JSON.parse(JSON.stringify(vueReelle)) as Record<string, unknown>;

/** Le premier seuil publié qui annonce vraiment une bascule. */
function premierSeuil(v: Record<string, unknown>) {
  const t = (v.sensitivity as { thresholds: Record<string, {
    breaksAt: number | null; moves: { field: string; from: string; to: string }[] }> }).thresholds;
  const cle = Object.keys(t).find((k) => t[k]!.breaksAt !== null && t[k]!.moves.length > 0)!;
  return { t, cle, s: t[cle]! };
}

test("la vue réelle passe les deux vérifications — sinon les cas suivants ne prouvent rien", () => {
  /* LA DIRECTION QUI DÉCIDE. Sans elle, trois refus verts prouveraient seulement que les
     vérificateurs refusent tout, ce qu'une garde cassée fait aussi bien. */
  assert.doesNotThrow(() => verifierCoherence(vueReelle));
  assert.doesNotThrow(() => verifierSeuils(p, vueReelle));
});

test("une médiane de latence incohérente avec le chiffre publié est refusée", () => {
  const v = copie();
  const ls = v.latencySpread as { routed: { median: number } };
  /* On déplace la médiane et RIEN D'AUTRE : c'est exactement la forme du défaut — deux
     sorties du même calcul qui cessent de s'accorder parce qu'une seule a été régénérée. */
  ls.routed.median = ls.routed.median + 50;
  assert.throws(() => verifierCoherence(v), /landing.json would be inconsistent/,
    "deux chiffres de latence qui se contredisent dans le même fichier ne doivent pas "
    + "s'assembler : le lecteur en croira un des deux et rien ne dit lequel");
});

test("un seuil qui n'encadre pas la bascule est refusé", () => {
  const v = copie();
  const { s } = premierSeuil(v);
  /* Le défaut : un seuil annoncé BIEN AU-DESSUS du point où le routage change vraiment.
     Au-dessus il change encore — donc la première garde passe — mais en dessous il a
     déjà changé, et la marge annoncée n'existe pas. */
  s.breaksAt = s.breaksAt! * 8;
  assert.throws(() => verifierSeuils(p, v), /the routing had already changed before/,
    "un seuil qui n'encadre pas la bascule annonce une marge de sécurité qui n'existe pas");
});

test("un seuil qui annonce un mouvement que la bascule ne produit pas est refusé", () => {
  const v = copie();
  const { s } = premierSeuil(v);
  const m = s.moves[0]!;
  /* On ne touche ni au seuil ni au routage : seulement à ce que le seuil PRÉTEND produire.
     C'est le cas où le chiffre est juste et la phrase qui l'accompagne est fausse. */
  m.to = m.from;
  assert.throws(() => verifierSeuils(p, v), /but the switch gives/,
    "un seuil peut être exact et sa description fausse ; c'est la description que le "
    + "lecteur retient");
});

test("le prix par extraction est un cinquième du prix du document, pour chaque palier", () => {
  /*
   * Le basis de cette clé promet « un cinquième d'un document ». L'ancienne écriture publiait
   * le prix du seul champ le plus rapide : −10 % sur gen-4b, dans le sens qui flatte l'offre.
   * L'identité value × champs = prix du document est la seule lecture compatible avec le basis,
   * et ce cas la verrouille sur la vue RÉELLE — celle que landing.json livre.
   */
  const vue = construire(p) as unknown as { tiers: {
    id: string;
    costPerThousandDocuments: { value: number | null };
    costPerThousandExtractions: { value: number | null };
    acc: Record<string, unknown>;
  }[] };
  for (const t of vue.tiers) {
    if (t.costPerThousandDocuments.value === null) {
      assert.equal(t.costPerThousandExtractions.value, null,
        `${t.id} : le document n'a pas de prix mais l'extraction en affiche un — un chiffre né de null.`);
      continue;
    }
    const attendu = Number((t.costPerThousandDocuments.value / Object.keys(t.acc).length).toFixed(4));
    assert.notEqual(t.costPerThousandExtractions.value, null,
      `${t.id} : le document a un prix mais l'extraction rend null.`);
    assert.ok(Math.abs(t.costPerThousandExtractions.value! - attendu) <= 0.0002,
      `${t.id} : extraction ${t.costPerThousandExtractions.value} × ${Object.keys(t.acc).length}`
      + ` ≠ document ${t.costPerThousandDocuments.value} — le basis « un cinquième d'un document »`
      + ` ment, et il ment dans le sens qui flatte l'offre.`);
  }
});
