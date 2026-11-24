export const SOUND_EVENTS = {
  "weapon.fire.Enforcer": ["BotPack.E_Shot"],
  "weapon.fire.ShockRifle": ["BotPack.TazerFire"],
  "weapon.fire.SniperRifle": ["BotPack.SniperFire"],
  "weapon.fire.PulseGun": ["BotPack.PulseFire"],
  "weapon.fire.UT_Eightball": ["BotPack.WarheadShot"],
  "weapon.fire.UT_FlakCannon": ["BotPack.WarheadShot", "BotPack.Expl04"],
  "weapon.fire.minigun2": ["BotPack.M2RegFire"],
  "weapon.fire.ripper": ["BotPack.RazorAlt"],
  "weapon.fire.ut_biorifle": ["BotPack.BioAltRep"],
  "weapon.fire.WarheadLauncher": ["BotPack.WarheadShot"],
  "weapon.empty": ["BotPack.Click"],
  "weapon.select": ["BotPack.Cocking"],
  "pickup.health": ["BotPack.UTHealth", "BotPack.UTSuperHeal"],
  "pickup.armor": ["BotPack.ArmorUT"],
  "pickup.ammo": ["BotPack.AmmoPick"],
  "pickup.weapon": ["UnrealShare.WeaponPickup", "BotPack.WarheadPickup", "BotPack.PulsePickup"],
  "player.jump": ["BotPack.jump1"],
  "player.land": ["BotPack.land01"],
  "player.hurt": ["BotPack.BInjur1"],
  "player.death": ["BotPack.death1d"],
  "player.respawn": ["BotPack.RespawnSound2"],
  "bot.fire": ["BotPack.E_Shot", "BotPack.TazerFire"],
  "bot.hit": ["BotPack.GelHit", "BotPack.SawHit"],
  "bot.death": ["BotPack.BDeath1"]
};

export function weaponFireEvent(weapon) {
  return `weapon.fire.${weapon}`;
}

export function resolveSoundKey(manifest, event) {
  const candidates = SOUND_EVENTS[event];
  if (!candidates || !manifest?.sounds) return null;
  for (const key of candidates) {
    if (manifest.sounds[key]) return key;
  }
  return null;
}
