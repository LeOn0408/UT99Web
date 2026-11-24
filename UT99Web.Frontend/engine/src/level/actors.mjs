import { readActorProperties } from "./lights.mjs";

const MARKER_SKIP = new Set([
  "Class", "Model", "Polys", "Texture", "Palette", "Sound", "Music", "Font",
  "Level", "Brush", "Camera", "PathNode", "InventorySpot", "ZoneInfo",
  "SlimeZone", "LevelInfo", "Light", "AmbientSound", "Mover", "LiftCenter",
  "LiftExit", "JumpSpot", "DefensePoint"
]);

export function readActors(pkg) {
  const actors = [];
  for (const item of pkg.exports) {
    if (!item.serialSize || MARKER_SKIP.has(item.className)) continue;
    try {
      const { properties } = readActorProperties(pkg, item);
      const location = properties.get("Location")?.value;
      if (!location) continue;
      actors.push({
        index: item.index,
        name: item.objectName,
        className: item.className,
        location,
        rotation: properties.get("Rotation")?.value ?? { pitch: 0, yaw: 0, roll: 0 },
        drawScale: properties.get("DrawScale")?.value ?? 1
      });
    } catch {
      continue;
    }
  }
  return actors;
}

export function readPlayerStarts(pkg) {
  const starts = [];
  for (const item of pkg.exports) {
    if (item.className !== "PlayerStart") continue;
    try {
      const { properties } = readActorProperties(pkg, item);
      const location = properties.get("Location")?.value;
      if (!location) continue;
      starts.push({
        name: item.objectName,
        location,
        rotation: properties.get("Rotation")?.value ?? { pitch: 0, yaw: 0, roll: 0 },
        team: properties.get("TeamNumber")?.value ?? 255
      });
    } catch {
      continue;
    }
  }
  return starts;
}
