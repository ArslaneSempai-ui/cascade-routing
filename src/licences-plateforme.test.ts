/*
 * The licence inventory reads the same on a machine that installs other binaries.
 *
 * First run of the Windows matrix, 2026-09-29: `licences.ts --check` was red on Windows and
 * green on Linux and macOS for the same commit. npm installs no `@img/sharp-libvips-*` on
 * win32 (the win32 sharp binary bundles libvips) and the win32 variant of `@img/sharp`
 * declares one licence more than the others. Family names had made the document the same
 * on macOS and Linux; they could not make it the same on Windows, because the row itself
 * was read from whichever variant was on disk.
 *
 * This case builds a tree the way npm lays it out on Windows, beside a lockfile that
 * declares every variant, and reads the inventory: the same families, versions and
 * declared licences as a Linux tree would give, with the absent family supplemented from
 * the lockfile. And without a lockfile, the inventory is what it always was.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventaire } from "./licences.ts";

function paquet(racine: string, nom: string, manifest: Record<string, unknown>, licenceTexte?: string): void {
  const dir = join(racine, "node_modules", ...nom.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: nom, ...manifest }));
  if (licenceTexte !== undefined) writeFileSync(join(dir, "LICENSE"), licenceTexte);
}

const APACHE = "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n";

function verrou(racine: string): void {
  const entree = (os: string, cpu: string, license: string) => ({ version: "0.35.3", optional: true, os: [os], cpu: [cpu], license });
  const libvips = (os: string, cpu: string) => ({ version: "1.3.2", optional: true, os: [os], cpu: [cpu], license: "LGPL-3.0-or-later" });
  writeFileSync(join(racine, "package-lock.json"), JSON.stringify({
    name: "fixture", lockfileVersion: 3, packages: {
      "": { name: "fixture" },
      "node_modules/sharp": { version: "0.35.3", license: "Apache-2.0" },
      "node_modules/@img/sharp-linux-x64": entree("linux", "x64", "Apache-2.0"),
      "node_modules/@img/sharp-darwin-arm64": entree("darwin", "arm64", "Apache-2.0"),
      "node_modules/@img/sharp-win32-x64": entree("win32", "x64", "Apache-2.0 AND LGPL-3.0-or-later"),
      "node_modules/@img/sharp-libvips-linux-x64": libvips("linux", "x64"),
      "node_modules/@img/sharp-libvips-darwin-arm64": libvips("darwin", "arm64"),
      "node_modules/onnxruntime-node": { version: "1.24.3", optional: false, os: ["win32", "darwin", "linux"], license: "MIT" },
    },
  }));
}

const familles = (racine: string) => inventaire(join(racine, "node_modules"))
  .map((p) => `${p.nom}@${p.version} ${p.declaree ?? "n/a"} ${p.classe} ${p.fichier ? "file" : "no-file"}`).sort();

test("a Windows tree and a Linux tree give the same inventory of families", () => {
  const linux = mkdtempSync(join(tmpdir(), "licences-linux-"));
  const windows = mkdtempSync(join(tmpdir(), "licences-win32-"));
  try {
    for (const racine of [linux, windows]) {
      verrou(racine);
      paquet(racine, "sharp", { version: "0.35.3", license: "Apache-2.0" }, APACHE);
      paquet(racine, "onnxruntime-node", { version: "1.24.3", license: "MIT", os: ["win32", "darwin", "linux"] }, "MIT License\n");
    }
    paquet(linux, "@img/sharp-linux-x64", { version: "0.35.3", license: "Apache-2.0", os: ["linux"], cpu: ["x64"] }, APACHE);
    paquet(linux, "@img/sharp-libvips-linux-x64", { version: "1.3.2", license: "LGPL-3.0-or-later", os: ["linux"], cpu: ["x64"] });
    /* On win32, npm installs the sharp binary alone: it bundles libvips and says so in its field. */
    paquet(windows, "@img/sharp-win32-x64", { version: "0.35.3", license: "Apache-2.0 AND LGPL-3.0-or-later", os: ["win32"], cpu: ["x64"] }, APACHE);

    const l = familles(linux), w = familles(windows);
    assert.deepEqual(w, l, "the two machines must describe the same packages, or the check is a lottery");
    assert.ok(l.some((x) => x.startsWith("@img/sharp@0.35.3 Apache-2.0 ")), l.join("\n"));
    assert.ok(l.some((x) => x === "@img/sharp-libvips@1.3.2 LGPL-3.0-or-later à tenir no-file"), l.join("\n"));
    assert.ok(l.some((x) => x.startsWith("onnxruntime-node@1.24.3 MIT")), "a package that carries every system under one name keeps its name");
    const ps = inventaire(join(windows, "node_modules"));
    assert.match(ps.find((p) => p.nom === "@img/sharp-libvips")!.plateforme ?? "", /not installed on this machine/);
    assert.equal(ps.find((p) => p.nom === "@img/sharp")!.plateforme, "le nom portait la plateforme");
  } finally {
    rmSync(linux, { recursive: true, force: true });
    rmSync(windows, { recursive: true, force: true });
  }
});

test("without a lockfile the inventory is what it always was: the installed variant, under its family name", () => {
  const racine = mkdtempSync(join(tmpdir(), "licences-seul-"));
  try {
    paquet(racine, "@img/sharp-win32-x64", { version: "0.35.3", license: "Apache-2.0 AND LGPL-3.0-or-later", os: ["win32"], cpu: ["x64"] }, APACHE);
    const ps = inventaire(join(racine, "node_modules"));
    assert.equal(ps.length, 1);
    assert.equal(ps[0]!.nom, "@img/sharp");
    assert.equal(ps[0]!.declaree, "Apache-2.0 AND LGPL-3.0-or-later", "no reference to read: the installed field stands");
  } finally { rmSync(racine, { recursive: true, force: true }); }
});
