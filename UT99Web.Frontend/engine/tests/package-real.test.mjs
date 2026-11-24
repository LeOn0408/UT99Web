import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackageSummary } from "../src/package/package-reader.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const deck = path.join(root, "assets", "game", "Maps", "DM-Deck16][.unr");

test("читает DM-Deck16][ из локальных ассетов", { skip: !fs.existsSync(deck) }, () => {
  const summary = readPackageSummary(deck);
  assert.equal(summary.header.version, 68);
  assert.equal(summary.names.length, 1386);
  assert.equal(summary.imports.length, 140);
  assert.equal(summary.exports.length, 1130);

  const level = summary.exports.find((item) => item.className === "Level");
  assert.ok(level);
  assert.equal(level.objectName, "MyLevel");
  assert.ok(level.serialOffset + level.serialSize <= summary.size);

  const bsp = summary.exports.find((item) => item.className === "Model" && item.serialSize > 400000);
  assert.ok(bsp);
  assert.equal(bsp.objectName, "Model1");
});
