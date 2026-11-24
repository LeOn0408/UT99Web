import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultValue, loadScriptDirectory, parseScriptSource } from "../src/uscript/source.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const scriptsDir = path.join(root, "assets", "game", "Scripts", "Botpack");

test("разбирает class/var/defaultproperties", () => {
  const parsed = parseScriptSource(`
    class TestThing extends Actor;
    var() int Count;
    var config bool bEnabled;
    function Touch(Actor Other) {}
    defaultproperties
    {
      Count=42
      bEnabled=True
      Label="hello"
      Projectile=Class'Botpack.EnforcerProjectile'
    }
  `);
  assert.equal(parsed.className, "TestThing");
  assert.equal(parsed.superName, "Actor");
  assert.equal(parsed.variables.get("Count").type, "int");
  assert.equal(parsed.variables.get("bEnabled").type, "bool");
  assert.equal(parsed.functions.length, 1);
  assert.equal(defaultValue(parsed, "Count"), 42);
  assert.equal(defaultValue(parsed, "bEnabled"), true);
  assert.equal(defaultValue(parsed, "Label"), "hello");
  assert.deepEqual(defaultValue(parsed, "Projectile"), { object: "Botpack.EnforcerProjectile" });
});

test("читает 505 классов Botpack", { skip: !fs.existsSync(scriptsDir) }, () => {
  const scripts = loadScriptDirectory(scriptsDir);
  assert.equal(scripts.size, 505);

  const deathmatch = scripts.get("DeathMatchPlus");
  assert.equal(deathmatch.superName, "TournamentGameInfo");
  assert.equal(defaultValue(deathmatch, "FragLimit"), 30);
  assert.equal(defaultValue(deathmatch, "TimeLimit"), 0);
  assert.equal(defaultValue(deathmatch, "bTournament"), false);
  assert.equal(deathmatch.variables.get("FragLimit").type, "int");

  const enforcer = scripts.get("Enforcer");
  assert.equal(enforcer.superName, "TournamentWeapon");
  assert.ok(enforcer.defaults.size > 0);
});
