import { hueToColor, lightAttenuation, toneMap } from "./lights.mjs";

const DEFAULT_AMBIENT = [0.28, 0.29, 0.32];

export function createLightSampler(model, lights, options = {}) {
  const ambient = options.ambient ?? DEFAULT_AMBIENT;
  const shadowInvert = options.shadowInvert === true;
  const shadowFactor = options.shadowFactor ?? 0.1;
  const useShadows = options.shadows !== false;
  const byIndex = new Map();
  for (const light of lights) {
    if (typeof light.index === "number") byIndex.set(light.index, light);
  }

  const surfaceCache = new Map();

  function shadowContext(surface) {
    if (!useShadows || surface.lightMap < 0) return null;
    const lightMap = model.lightMap[surface.lightMap];
    if (!lightMap || lightMap.lightActors < 0) return null;

    const widthBytes = (lightMap.uClamp + 7) >> 3;
    const space = widthBytes * lightMap.vClamp;
    const list = [];
    let position = 0;
    for (let index = lightMap.lightActors; index < model.lights.length; index += 1, position += 1) {
      const ref = model.lights[index];
      if (!ref) break;
      const light = ref > 0 ? byIndex.get(ref - 1) : null;
      list.push({ light, offset: lightMap.dataOffset + position * space });
    }
    return { lightMap, widthBytes, list };
  }

  return function sample(surface, point, u, v) {
    let context = surfaceCache.get(surface);
    if (context === undefined) {
      context = shadowContext(surface);
      surfaceCache.set(surface, context);
    }

    const lightList = context
      ? context.list.filter((entry) => entry.light)
      : lights.map((light) => ({ light }));

    let red = ambient[0];
    let green = ambient[1];
    let blue = ambient[2];

    let bitIndex = 0;
    if (context) {
      const { lightMap, widthBytes } = context;
      const lu = Math.max(0, Math.min(lightMap.uClamp - 1, Math.floor((u - lightMap.pan.x) / lightMap.uScale)));
      const lv = Math.max(0, Math.min(lightMap.vClamp - 1, Math.floor((v - lightMap.pan.y) / lightMap.vScale)));
      bitIndex = lv * widthBytes * 8 + lu;
    }

    for (const entry of lightList) {
      const light = entry.light;
      let strength = lightAttenuation(light, point);

      if (context) {
        const byte = model.lightBits[entry.offset + (bitIndex >> 3)];
        const bit = (byte >> (bitIndex & 7)) & 1;
        const shadowed = (bit === 1) !== shadowInvert;
        if (shadowed) strength *= shadowFactor;
      }

      if (strength <= 0) continue;
      const color = hueToColor(light.hue, light.saturation);
      red += color[0] * strength;
      green += color[1] * strength;
      blue += color[2] * strength;
    }

    return toneMap(red, green, blue);
  };
}
