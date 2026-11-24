import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SOUND_EVENTS, resolveSoundKey, weaponFireEvent } from "../src/audio/events.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const musicManifestPath = path.join(root, "assets", "game", "Audio", "music-web-manifest.json");

const manifest = {
  sounds: {
    "BotPack.E_Shot": {},
    "BotPack.TazerFire": {},
    "BotPack.UTSuperHeal": {},
    "BotPack.AmmoPick": {},
    "UnrealShare.WeaponPickup": {},
    "BotPack.jump1": {},
    "BotPack.death1d": {},
    "BotPack.BDeath1": {}
  }
};

test("известные события находят ключ манифеста", () => {
  assert.equal(resolveSoundKey(manifest, "weapon.fire.Enforcer"), "BotPack.E_Shot");
  assert.equal(resolveSoundKey(manifest, "weapon.fire.ShockRifle"), "BotPack.TazerFire");
  assert.equal(resolveSoundKey(manifest, "pickup.ammo"), "BotPack.AmmoPick");
  assert.equal(resolveSoundKey(manifest, "pickup.weapon"), "UnrealShare.WeaponPickup");
  assert.equal(resolveSoundKey(manifest, "player.jump"), "BotPack.jump1");
  assert.equal(resolveSoundKey(manifest, "bot.death"), "BotPack.BDeath1");
});

test("используется первый доступный fallback", () => {
  assert.equal(resolveSoundKey(manifest, "pickup.health"), "BotPack.UTSuperHeal");
  assert.equal(resolveSoundKey({ sounds: { "BotPack.TazerFire": {} } }, "bot.fire"), "BotPack.TazerFire");
});

test("неизвестное событие и отсутствующий звук не падают", () => {
  assert.equal(resolveSoundKey(manifest, "unknown.event"), null);
  assert.equal(resolveSoundKey({ sounds: {} }, "player.death"), null);
  assert.equal(resolveSoundKey(null, "player.death"), null);
});

test("для каждого оружия есть событие выстрела", () => {
  const weapons = [
    "Enforcer", "ShockRifle", "SniperRifle", "PulseGun", "UT_Eightball",
    "UT_FlakCannon", "minigun2", "ripper", "ut_biorifle", "WarheadLauncher"
  ];
  for (const weapon of weapons) {
    const event = weaponFireEvent(weapon);
    assert.ok(SOUND_EVENTS[event], `нет события ${event}`);
    assert.ok(SOUND_EVENTS[event].length > 0, `нет кандидатов для ${event}`);
  }
});

test("music-web-manifest ссылается на существующие OGG", {
  skip: !fs.existsSync(musicManifestPath)
}, () => {
  const music = JSON.parse(fs.readFileSync(musicManifestPath, "utf8"));
  assert.equal(music.version, 1);
  const entries = Object.entries(music.tracks ?? {});
  assert.ok(entries.length >= 20);
  for (const [key, entry] of entries) {
    assert.ok(!path.isAbsolute(entry.path), `${key}: абсолютный путь`);
    assert.ok(!entry.path.includes(".."), `${key}: путь с ..`);
    assert.equal(entry.browserPlayable, true, `${key}: browserPlayable`);
    assert.equal(entry.sha256.length, 64, `${key}: sha256`);
    assert.ok(entry.path.endsWith(".ogg"), `${key}: не OGG`);
    assert.ok(fs.existsSync(path.join(root, "assets", "game", "Audio", entry.path)), `${key}: нет файла`);
  }
});
