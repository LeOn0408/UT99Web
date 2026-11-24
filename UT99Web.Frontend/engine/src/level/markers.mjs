function colorForClass(className) {
  if (/PlayerStart/i.test(className)) return [0.35, 1.0, 0.45];
  if (/Health|MedBox|Vial/i.test(className)) return [1.0, 0.3, 0.3];
  if (/Armor|Shield|Boots|Pads|UDamage/i.test(className)) return [0.9, 0.35, 1.0];
  if (/Ammo|Pack|Box|Core|PAmmo|Miniammo/i.test(className)) return [1.0, 0.8, 0.25];
  if (/Rifle|Cannon|Gun|Ripper|Flak|Eightball|Launcher|Pulse|minigun|Warhead|Blade/i.test(className)) {
    return [0.35, 0.7, 1.0];
  }
  if (/Teleporter/i.test(className)) return [0.2, 1.0, 1.0];
  return [0.7, 0.7, 0.75];
}

function pushCube(positions, colors, x, y, z, half, color) {
  const corners = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ].map(([cx, cy, cz]) => [x + cx * half, y + cy * half, z + cz * half]);

  const faces = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4],
    [1, 5, 6], [1, 6, 2]
  ];

  for (const face of faces) {
    for (const index of face) {
      const point = corners[index];
      positions.push(point[0], point[1], point[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }
}

export function buildActorMarkers(actors) {
  const positions = [];
  const colors = [];

  for (const actor of actors) {
    const scale = Math.max(0.5, actor.drawScale || 1);
    const half = (/PlayerStart/i.test(actor.className) ? 16 : 8) * scale;
    const x = actor.location.x;
    const y = actor.location.z;
    const z = -actor.location.y;
    pushCube(positions, colors, x, y, z, half, colorForClass(actor.className));
  }

  return { positions, colors, count: actors.length };
}
