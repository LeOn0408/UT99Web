function objectName(pkg, ref) {
  if (ref > 0) return pkg.exports[ref - 1]?.objectName ?? null;
  if (ref < 0) return pkg.imports[-ref - 1]?.objectName ?? null;
  return null;
}

export function buildZoneLookup(pkg, model) {
  const zoneNames = model.zones.map((zone) => {
    const name = objectName(pkg, zone.actor);
    if (!name) return null;
    const importItem = zone.actor < 0 ? pkg.imports[-zone.actor - 1] : null;
    return { name, className: importItem?.className ?? null };
  });

  return {
    zoneNames,
    at(x, y, z) {
      let nodeIndex = 0;
      for (let guard = 0; guard < 100000; guard += 1) {
        const node = model.nodes[nodeIndex];
        if (!node) return null;
        const distance =
          node.plane[0] * x + node.plane[1] * y + node.plane[2] * z - node.plane[3];
        const front = distance >= 0;
        const leafIndex = front ? node.leaf[1] : node.leaf[0];
        if (leafIndex !== 0xffffffff && leafIndex < model.leaves.length) {
          const zoneIndex = model.leaves[leafIndex]?.zone;
          return {
            zoneIndex,
            zone: zoneIndex >= 0 ? zoneNames[zoneIndex] : null
          };
        }
        nodeIndex = front ? node.back : node.front;
        if (nodeIndex < 0 || nodeIndex >= model.nodes.length) return null;
      }
      return null;
    }
  };
}

export function isLiquidZone(zone) {
  if (!zone) return false;
  return /Water|Slime|Lava|Acid/i.test(zone.name ?? "");
}
