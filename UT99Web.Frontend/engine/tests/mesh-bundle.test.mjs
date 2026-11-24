import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const bundlePath = path.join(root, "assets", "game", "Scripts", "pickup-meshes.json");
const atlasPath = path.join(root, "assets", "game", "Scripts", "pickup-atlas.png");

const DECK16_CLASSES = [
  "MedBox", "HealthVial", "ThighPads", "armor2", "ut_shieldbelt",
  "ShockCore", "PAmmo", "RocketPack", "flakammo", "bioammo", "Miniammo",
  "BladeHopper", "BulletBox", "ShockRifle", "SniperRifle", "UT_Eightball",
  "UT_FlakCannon", "PulseGun", "minigun2", "ripper", "ut_biorifle",
  "WarheadLauncher", "UDamage", "ut_jumpboots"
];

const REQUIRED_MESHES = [
  "MinigunPick", "RazPick2", "BRifle2Pick", "WHPick", "BioAmmoM",
  "FlakAmmoM", "MiniAmmom", "Armor2M", "ShieldBeltMeshM", "jboot"
];

test("бандл мешей содержит UV и атлас", { skip: !fs.existsSync(bundlePath) }, () => {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  assert.ok(Object.keys(bundle.byClass).length >= 10);
  assert.ok(Object.keys(bundle.meshes).length >= 10);
  assert.ok(bundle.atlas.width > 0);
  assert.ok(bundle.atlas.height > 0);
  assert.ok(fs.existsSync(atlasPath));

  for (const mesh of Object.values(bundle.meshes)) {
    assert.equal(mesh.uvs.length, (mesh.positions.length / 3) * 2);
    assert.equal(mesh.positions.length % 3, 0);
  }
});

test("бандл Deck16 содержит все 24 класса пикапов", { skip: !fs.existsSync(bundlePath) }, () => {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  for (const className of DECK16_CLASSES) {
    assert.ok(bundle.byClass[className], `нет класса ${className}`);
  }
  assert.ok(Object.keys(bundle.byClass).length >= 24);
  for (const mesh of REQUIRED_MESHES) {
    assert.ok(bundle.meshes[mesh], `нет меша ${mesh}`);
    assert.ok(bundle.meshes[mesh].positions.length > 0, `пустой меш ${mesh}`);
  }
  assert.equal(bundle.meshes.MinigunPick.uvs.length, (bundle.meshes.MinigunPick.positions.length / 3) * 2);
});
