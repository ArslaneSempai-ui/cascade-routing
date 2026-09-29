/*
 * JSON as a client's machine writes it: a UTF-8 BOM is read past, UTF-16 is refused by name.
 * Reviewed 2026-09-29 (item 24): both came out of PowerShell and both read as "unreadable".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonBytes, readJsonFile } from "./json-file.ts";

test("a UTF-8 byte-order mark is stripped, a UTF-16 file is refused with its encoding and the file name", () => {
  const d = mkdtempSync(join(tmpdir(), "json-file-"));
  try {
    const bom = join(d, "bom.json");
    writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a": 1}')]));
    assert.deepEqual(readJsonFile(bom), { a: 1 });
    const le = join(d, "le.json");
    writeFileSync(le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"a": 1}', "utf16le")]));
    assert.throws(() => readJsonFile(le), /le\.json is encoded as UTF-16 \(little-endian/);
    assert.throws(() => parseJsonBytes(Buffer.from([0xfe, 0xff, 0, 0x7b]), "be.json"), /be\.json is encoded as UTF-16 \(big-endian/);
    assert.throws(() => parseJsonBytes(Buffer.from("{oops"), "bad.json"), /^Error: bad\.json: not readable as JSON/);
    assert.deepEqual(parseJsonBytes(Buffer.from("[1, 2]"), "ok.json"), [1, 2]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
