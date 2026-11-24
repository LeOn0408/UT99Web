import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackage } from "../src/package/package.mjs";
import { classAncestry, readClasses } from "../src/uscript/classes.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const botpack = path.join(root, "assets", "game", "System", "Botpack.u");

test("читает таблицу классов Botpack.u", { skip: !fs.existsSync(botpack) }, () => {
  const pkg = readPackage(fs.readFileSync(botpack));
  const classes = readClasses(pkg);
  assert.equal(classes.size, 506);
  assert.deepEqual(
    classAncestry(classes, "DeathMatchPlus"),
    ["DeathMatchPlus", "TournamentGameInfo", "GameInfo"]
  );
  assert.equal(classes.get("Enforcer").superName, "TournamentWeapon");
  assert.ok(classes.get("TournamentWeapon").children.includes("Enforcer"));
});
