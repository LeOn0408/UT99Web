import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { decompressUz } from "./uz.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const deck = path.join(root, "assets", "game", "Maps", "DM-Deck16][.unr.uz");

test("отклоняет неизвестную версию .uz", () => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(0xdeadbeef, 0);
  assert.throws(() => decompressUz(buffer), /версия/i);
});

test("распаковывает старый формат UT99", { skip: !fs.existsSync(deck) }, () => {
  const result = decompressUz(fs.readFileSync(deck));
  assert.equal(result.version, 0x162e);
  assert.equal(result.name, "DM-Deck16][.unr");
  assert.equal(result.data.length, 866119);
  assert.equal(
    Array.from(result.data.subarray(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    "c1832a9e"
  );
});
