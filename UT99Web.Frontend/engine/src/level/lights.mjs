import { BinaryReader } from "../package/binary-reader.mjs";
import { readTaggedProperties } from "../package/properties.mjs";

const RF_HAS_STACK = 0x02000000;

export function readActorProperties(pkg, exportItem) {
  const reader = new BinaryReader(pkg.buffer, exportItem.serialOffset);
  if (exportItem.objectFlags & RF_HAS_STACK) {
    const node = reader.compactIndex();
    reader.compactIndex();
    reader.skip(8);
    reader.skip(4);
    if (node !== 0) reader.compactIndex();
  }
  const properties = readTaggedProperties(reader, pkg.names);
  return { properties, reader };
}

export function readLevelLights(pkg) {
  const lights = [];
  for (const item of pkg.exports) {
    if (item.className !== "Light") continue;
    try {
      const { properties } = readActorProperties(pkg, item);
      const location = properties.get("Location")?.value;
      if (!location) continue;
      lights.push({
        index: item.index,
        name: item.objectName,
        location,
        brightness: properties.get("LightBrightness")?.value ?? 64,
        radius: properties.get("LightRadius")?.value ?? 64,
        hue: properties.get("LightHue")?.value ?? 0,
        saturation: properties.get("LightSaturation")?.value ?? 0,
        type: properties.get("LightType")?.value ?? 0,
        volume: Boolean(properties.get("bVolume")?.value),
        specialLit: Boolean(properties.get("bSpecialLit")?.value)
      });
    } catch {
      continue;
    }
  }
  return lights;
}

export function lightAttenuation(light, point) {
  const radius = 25 * (light.radius + 1);
  if (radius <= 0) return 0;
  const dx = point.x - light.location.x;
  const dy = point.y - light.location.y;
  const dz = point.z - light.location.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared >= radius * radius) return 0;
  const falloff = 1 - Math.sqrt(distanceSquared) / radius;
  return (light.brightness / 255) * Math.pow(falloff, 1.4) * 3.1;
}

export function toneMap(red, green, blue) {
  return [
    Math.pow(1 - Math.exp(-red * 2.2), 1 / 2.0),
    Math.pow(1 - Math.exp(-green * 2.2), 1 / 2.0),
    Math.pow(1 - Math.exp(-blue * 2.2), 1 / 2.0)
  ];
}

export function hueToColor(hue, saturation) {
  const h = (hue / 255) * 6;
  const s = saturation / 255;
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

export function lightCache(model, lights, ambient = [0.28, 0.29, 0.32]) {
  const cache = new Map();

  return (pointIndex) => {
    if (cache.has(pointIndex)) return cache.get(pointIndex);
    const point = model.points[pointIndex];
    let r = ambient[0];
    let g = ambient[1];
    let b = ambient[2];

    if (point) {
      for (const light of lights) {
        const radius = 25 * (light.radius + 1);
        if (radius <= 0) continue;
        const dx = point.x - light.location.x;
        const dy = point.y - light.location.y;
        const dz = point.z - light.location.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= radius * radius) continue;
        const distance = Math.sqrt(distanceSquared);
        const falloff = 1 - distance / radius;
        const strength = (light.brightness / 255) * Math.pow(falloff, 1.4) * 3.1;
        if (strength <= 0) continue;
        const color = hueToColor(light.hue, light.saturation);
        r += color[0] * strength;
        g += color[1] * strength;
        b += color[2] * strength;
      }
    }

    const color = [
      Math.pow(1 - Math.exp(-r * 2.2), 1 / 2.0),
      Math.pow(1 - Math.exp(-g * 2.2), 1 / 2.0),
      Math.pow(1 - Math.exp(-b * 2.2), 1 / 2.0)
    ];
    cache.set(pointIndex, color);
    return color;
  };
}
