/* PARTAGÉ DANS LA FAMILLE CASCADE — source : cascade
   Les dépôts de la famille (cascade, -screening, -monitoring, -scoring, -dossier) en portent
   une copie identique AU BYTE. Corrigez-le dans la source, puis recopiez : la famille est
   EXCLUE de la diffusion d'identite (depots.json), aucune diffusion ne viendra le faire à
   votre place. `couche-famille.test.ts` compare les octets, nomme la direction du retard, et
   refuse aussi un fichier identique dans deux dépôts qui ne porte PAS cet en-tête — c'est
   ainsi qu'une copie neuve se déclare au lieu de dériver en silence. Si une divergence
   devient VOULUE dans un dépôt, retirez-y cet en-tête : la copie quitte le groupe. */
/*
 * UN RELEVÉ PUBLIÉ VOYAGE AVEC SA SIGNATURE, OU IL NE PROUVE RIEN.
 *
 * Le trou, mesuré le 13 septembre 2026 : cascade-dossier publiait `releve-public.json`,
 * `RELEVE-PUBLIC.md` et `cle-publique.pem`, et PAS `releve-public.signature.json` — jamais
 * commité, pas une fois. La clé publique était donc livrée pour vérifier une signature que le
 * dépôt ne livrait pas. C'est l'outil dont le sujet EST la vérification sans nous faire
 * confiance. Les quatre autres livraient la leur ; celui-là non, par simple oubli, et rien ne
 * regardait. `corpus-hostile.json` de cascade était dans le même cas, scellé et publié sans
 * signature du tout.
 *
 * CE QUE CE CAS EXIGE, et c'est une propriété du DÉPÔT, pas d'une fonction :
 *   1. tout relevé scellé que le dépôt LIVRE (suivi par git, portant un sceau `empreinte` de
 *      seize hexadécimaux à la racine) a un fichier `<relevé>.signature.json` à côté ;
 *   2. ce fichier est LUI AUSSI suivi par git — présent sur le disque ne veut pas dire
 *      publié, et c'était exactement la forme du défaut ;
 *   3. la signature vérifie contre la `cle-publique.pem` du dépôt, sur les octets du sceau.
 *
 * La liste se DÉDUIT du disque : un relevé neuf entre dans la garde en existant, pas en
 * modifiant ce fichier. Un relevé délibérément non signé se déclare dans SANS_SIGNATURE avec
 * sa raison et sa date — aucune exception muette, comme partout dans cette maison.
 *
 * Le témoin joue les trois refus sur des fichiers fabriqués : sans lui, un zéro ne dirait pas
 * si la garde regarde ou si elle dort.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as verifierBrut, generateKeyPairSync, sign as signerBrut } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** Un relevé délibérément livré sans signature : sa raison et sa date, jamais un silence. */
const SANS_SIGNATURE: Record<string, { pourquoi: string; depuis: string }> = {};

const SCEAU = /^[0-9a-f]{16}$/;

/** Les relevés scellés que ce dépôt livre : à la racine, suivis par git, portant un sceau. */
export function relevesLivres(dir: string, suivis: Set<string>): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.endsWith(".signature.json") && suivis.has(n))
    .filter((n) => {
      try {
        const o: unknown = JSON.parse(readFileSync(join(dir, n), "utf8"));
        return typeof o === "object" && o !== null
          && SCEAU.test(String((o as Record<string, unknown>)["empreinte"] ?? ""));
      } catch { return false; }
    })
    .sort();
}

/** Ce qui manque à un relevé pour être vérifiable par un lecteur qui ne nous croit pas. */
export function manques(dir: string, nom: string, suivis: Set<string>, clePubliquePem: string | null): string[] {
  const sig = nom.replace(/\.json$/, ".signature.json");
  if (!existsSync(join(dir, sig))) return [`${nom} : pas de ${sig} — le relevé est scellé mais rien ne dit qui l'a émis`];
  if (!suivis.has(sig)) return [`${nom} : ${sig} existe sur le disque mais n'est PAS suivi par git — `
    + "un lecteur qui clone reçoit le relevé, la clé publique, et rien à vérifier avec"];
  if (clePubliquePem === null) return [`${nom} : ${sig} est livré, mais le dépôt ne livre pas cle-publique.pem`];
  let s: { alg?: string; valeur?: string };
  try { s = JSON.parse(readFileSync(join(dir, sig), "utf8")) as typeof s; }
  catch (e) { return [`${nom} : ${sig} illisible — ${e instanceof Error ? e.message : String(e)}`]; }
  const sceau = String((JSON.parse(readFileSync(join(dir, nom), "utf8")) as Record<string, unknown>)["empreinte"]);
  let bon = false;
  try {
    bon = verifierBrut(null, Buffer.from(sceau, "utf8"),
      createPublicKey(clePubliquePem), Buffer.from(String(s.valeur ?? ""), "base64"));
  } catch { bon = false; }
  return bon ? [] : [`${nom} : ${sig} ne vérifie PAS contre cle-publique.pem sur le sceau ${sceau} — `
    + "signature d'une autre clé, ou relevé re-mesuré sans re-signer (npm run signer)"];
}

test("le détecteur voit les trois formes du défaut : témoin", () => {
  const d = mkdtempSync(join(tmpdir(), "signature-temoin-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const sceau = "0123456789abcdef";
    writeFileSync(join(d, "releve.json"), JSON.stringify({ empreinte: sceau }));
    const suivis = new Set(["releve.json", "releve.signature.json"]);

    assert.match(manques(d, "releve.json", suivis, pem)[0]!, /pas de releve\.signature\.json/,
      "une signature absente doit se dire");

    const valeur = signerBrut(null, Buffer.from(sceau, "utf8"), privateKey).toString("base64");
    writeFileSync(join(d, "releve.signature.json"), JSON.stringify({ alg: "Ed25519", valeur }));
    assert.deepEqual(manques(d, "releve.json", suivis, pem), [], "une signature juste et suivie ne doit rien lever");

    assert.match(manques(d, "releve.json", new Set(["releve.json"]), pem)[0]!, /n'est PAS suivi par git/,
      "présent sur le disque n'est pas publié : c'est la forme exacte du défaut du 13/09");

    const { privateKey: autre } = generateKeyPairSync("ed25519");
    writeFileSync(join(d, "releve.signature.json"),
      JSON.stringify({ alg: "Ed25519", valeur: signerBrut(null, Buffer.from(sceau, "utf8"), autre).toString("base64") }));
    assert.match(manques(d, "releve.json", suivis, pem)[0]!, /ne vérifie PAS/,
      "une signature d'une autre clé doit tomber");

    /* Et la déduction : un JSON sans sceau n'est pas un relevé, un non suivi n'est pas livré. */
    writeFileSync(join(d, "config.json"), JSON.stringify({ rien: 1 }));
    writeFileSync(join(d, "brouillon.json"), JSON.stringify({ empreinte: sceau }));
    assert.deepEqual(relevesLivres(d, suivis), ["releve.json"],
      "la liste doit être les relevés SCELLÉS et SUIVIS, pas tous les JSON de la racine");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("tout relevé scellé que ce dépôt livre voyage avec sa signature", (t) => {
  let suivis: Set<string>;
  try {
    suivis = new Set(execFileSync("git", ["-C", racine, "ls-files", "--", "*.json"], { encoding: "utf8" })
      .split("\n").filter((l) => l && !l.includes("/")));
  } catch {
    return t.skip("pas un dépôt git ici : la garde regarde ce que git LIVRE, et sans git elle "
      + "ne peut pas distinguer un fichier publié d'un fichier de travail");
  }
  const cle = existsSync(racine + "cle-publique.pem") ? readFileSync(racine + "cle-publique.pem", "utf8") : null;
  const releves = relevesLivres(racine, suivis).filter((n) => !(n in SANS_SIGNATURE));
  assert.ok(releves.length >= 1,
    `aucun relevé scellé livré trouvé à la racine de ${racine} : ce dépôt en publie au moins un, `
    + "et un balayage qui n'en voit aucun ne prouve rien");
  const fautes = releves.flatMap((n) => manques(racine, n, suivis, cle));
  assert.deepEqual(fautes, [],
    "des relevés publiés ne sont pas vérifiables par un lecteur qui ne nous croit pas");
});
