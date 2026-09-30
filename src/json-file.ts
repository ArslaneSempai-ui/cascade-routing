/**
 * Read a JSON file the way a client's machine writes one.
 *
 * Every JSON this tool takes from a client goes through here: a vendor export, a mapping, a
 * values file, an outcomes file, the price table. PowerShell's `Out-File` writes UTF-16 LE
 * with a byte-order mark by default, and `Set-Content` on older Windows writes UTF-8 with a
 * BOM; `JSON.parse` refuses both, the first as garbage and the second on the U+FEFF, with an
 * "Unexpected token" that names neither the file nor the cause. Reviewed 2026-09-29 (item 24):
 * `grade` then blamed an identifier mismatch, since every export had counted as unreadable.
 *
 * A UTF-8 BOM is stripped and the file is read. A UTF-16 file is refused by name, with the
 * encoding it carries and what to do: this tool does not guess a byte order it did not see.
 */

import { readFileSync } from "node:fs";

/** Parse bytes as JSON, naming the file in every refusal. */
export function parseJsonBytes(bytes: Buffer, name: string): unknown {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    const order = bytes[0] === 0xff ? "little-endian" : "big-endian";
    throw new Error(`${name} is encoded as UTF-16 (${order} byte-order mark). Save it as UTF-8 and run again.\n`
      + `  PowerShell: Get-Content <file> | Set-Content -Encoding utf8 <file>`);
  }
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${name}: not readable as JSON: ${(e as Error).message}`); }
}

/** Read and parse a JSON file; the refusal names the file. */
export function readJsonFile(path: string): unknown {
  return parseJsonBytes(readFileSync(path), path);
}
