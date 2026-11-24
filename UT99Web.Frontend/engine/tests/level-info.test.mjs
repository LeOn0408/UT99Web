import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { decompressUz } from "../../tools/assets/uz.mjs";
import { readPackage } from "../src/package/package.mjs";
import { readLevelInfo } from "../src/level/level-info.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const mapPath = path.join(root, "assets", "game", "Maps", "DM-Deck16][.unr.uz");

test("LevelInfo из Deck16 указывает на Godown", { skip: !fs.existsSync(mapPath) }, () => {
  const pkg = readPackage(Buffer.from(decompressUz(fs.readFileSync(mapPath)).data));
  const info = readLevelInfo(pkg);
  assert.equal(info.song, "Godown");
  assert.equal(typeof info.song, "string");
});

test("LevelInfo без Music-ссылки не падает", () => {
  const info = readLevelInfo({ exports: [], imports: [] });
  assert.deepEqual(info, { title: null, author: null, song: null });
});
