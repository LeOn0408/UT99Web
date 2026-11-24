import { hueToColor, lightAttenuation, toneMap } from "./lights.mjs";

const AMBIENT = [0.28, 0.29, 0.32];
const SHADOW_FACTOR = 0.1;

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function barycentric(px, py, ax, ay, bx, by, cx, cy) {
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-8) return null;
  const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
  const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
  const wc = 1 - wa - wb;
  if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) return null;
  return [wa, wb, wc];
}

function collectSurfaceTriangles(model, surfaceIndex) {
  const triangles = [];
  const surface = model.surfaces[surfaceIndex];
  if (!surface || surface.lightMap < 0) return triangles;
  const lightMap = model.lightMap[surface.lightMap];
  if (!lightMap) return triangles;

  const base = model.points[surface.base];
  const textureU = model.vectors[surface.textureU];
  const textureV = model.vectors[surface.textureV];
  if (!base || !textureU || !textureV) return triangles;

  const toLightMap = (point) => {
    const dx = point.x - base.x;
    const dy = point.y - base.y;
    const dz = point.z - base.z;
    const u = dx * textureU.x + dy * textureU.y + dz * textureU.z;
    const v = dx * textureV.x + dy * textureV.y + dz * textureV.z;
    return {
      u: (u - lightMap.pan.x) / lightMap.uScale,
      v: (v - lightMap.pan.y) / lightMap.vScale
    };
  };

  for (const node of model.nodes) {
    if (node.surface !== surfaceIndex) continue;
    const count = node.vertexCount;
    if (count < 3 || node.vertexPool < 0 || node.vertexPool + count > model.vertices.length) continue;
    const pool = [];
    for (let index = 0; index < count; index += 1) {
      const vertex = model.vertices[node.vertexPool + index];
      const point = model.points[vertex?.point ?? -1];
      if (!point) {
        pool.length = 0;
        break;
      }
      pool.push({ point, lm: toLightMap(point) });
    }
    if (pool.length < 3) continue;
    for (let index = 1; index < pool.length - 1; index += 1) {
      triangles.push([pool[0], pool[index], pool[index + 1]]);
    }
  }

  return triangles;
}

function pack(rects, width, height) {
  let x = 2;
  let y = 1;
  let rowHeight = 0;
  for (const rect of rects) {
    if (x + rect.w + 1 > width) {
      x = 1;
      y += rowHeight + 1;
      rowHeight = 0;
    }
    rect.x = x;
    rect.y = y;
    x += rect.w + 1;
    rowHeight = Math.max(rowHeight, rect.h);
  }
  const needed = y + rowHeight + 1;
  return needed <= height;
}

export function bakeLightmapAtlas(model, lights, options = {}) {
  const useShadows = options.shadows !== false;
  const byIndex = new Map();
  for (const light of lights) {
    if (typeof light.index === "number") byIndex.set(light.index, light);
  }

  const items = [];
  for (let index = 0; index < model.lightMap.length; index += 1) {
    const lightMap = model.lightMap[index];
    if (!lightMap || lightMap.uClamp < 1 || lightMap.vClamp < 1) continue;
    items.push({ index, w: lightMap.uClamp, h: lightMap.vClamp, x: 0, y: 0 });
  }
  items.sort((a, b) => b.h - a.h || b.w - a.w);

  let width = options.width ?? 512;
  let height = 256;
  for (;;) {
    if (!pack(items, width, height)) {
      height *= 2;
      if (height > 2048) {
        width *= 2;
        height = 256;
      }
      continue;
    }
    break;
  }
  height = nextPowerOfTwo(height);

  const atlas = new Uint8Array(width * height * 4);
  atlas[0] = 255;
  atlas[1] = 255;
  atlas[2] = 255;
  atlas[3] = 255;

  const rects = new Array(model.lightMap.length).fill(null);
  for (const item of items) rects[item.index] = item;

  const ambient = toneMap(AMBIENT[0], AMBIENT[1], AMBIENT[2]);
  const trianglesBySurface = new Map();

  for (const item of items) {
    const lightMap = model.lightMap[item.index];
    const surfaceIndex = model.surfaces.findIndex((surface) => surface.lightMap === item.index);
    if (surfaceIndex < 0) continue;
    const surface = model.surfaces[surfaceIndex];

    let triangles = trianglesBySurface.get(surfaceIndex);
    if (!triangles) {
      triangles = collectSurfaceTriangles(model, surfaceIndex);
      trianglesBySurface.set(surfaceIndex, triangles);
    }

    const widthBytes = (lightMap.uClamp + 7) >> 3;
    const space = widthBytes * lightMap.vClamp;
    const staticLights = [];
    if (lightMap.lightActors >= 0) {
      let position = 0;
      for (let index = lightMap.lightActors; index < model.lights.length; index += 1, position += 1) {
        const ref = model.lights[index];
        if (!ref) break;
        const light = ref > 0 ? byIndex.get(ref - 1) : null;
        if (light) staticLights.push({ light, offset: lightMap.dataOffset + position * space });
      }
    }

    const fallbackPoint = model.points[surface.base] ?? { x: 0, y: 0, z: 0 };

    for (let ty = 0; ty < item.h; ty += 1) {
      for (let tx = 0; tx < item.w; tx += 1) {
        const lx = tx + 0.5;
        const ly = ty + 0.5;
        let point = null;
        for (const triangle of triangles) {
          const [a, b, c] = triangle;
          const weights = barycentric(lx, ly, a.lm.u, a.lm.v, b.lm.u, b.lm.v, c.lm.u, c.lm.v);
          if (!weights) continue;
          point = {
            x: a.point.x * weights[0] + b.point.x * weights[1] + c.point.x * weights[2],
            y: a.point.y * weights[0] + b.point.y * weights[1] + c.point.y * weights[2],
            z: a.point.z * weights[0] + b.point.z * weights[1] + c.point.z * weights[2]
          };
          break;
        }
        if (!point) point = fallbackPoint;

        let red = AMBIENT[0];
        let green = AMBIENT[1];
        let blue = AMBIENT[2];
        const bitIndex = ty * widthBytes * 8 + tx;

        for (const entry of staticLights) {
          let strength = lightAttenuation(entry.light, point);
          if (strength <= 0) continue;
          if (useShadows) {
            const byte = model.lightBits[entry.offset + (bitIndex >> 3)];
            const shadowed = ((byte >> (bitIndex & 7)) & 1) === 1;
            if (shadowed) strength *= SHADOW_FACTOR;
          }
          const color = hueToColor(entry.light.hue, entry.light.saturation);
          red += color[0] * strength;
          green += color[1] * strength;
          blue += color[2] * strength;
        }

        const mapped = toneMap(red, green, blue);
        const pixel = ((item.y + ty) * width + item.x + tx) * 4;
        atlas[pixel] = Math.round(mapped[0] * 255);
        atlas[pixel + 1] = Math.round(mapped[1] * 255);
        atlas[pixel + 2] = Math.round(mapped[2] * 255);
        atlas[pixel + 3] = 255;
      }
    }
  }

  return {
    atlas,
    width,
    height,
    rects,
    whiteUV: [0.5 / width, 0.5 / height],
    ambient
  };
}
