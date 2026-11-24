import { readPackage } from "../package/package.mjs";
import { BinaryReader } from "../package/binary-reader.mjs";
import { createLightSampler } from "../level/lighting.mjs";
import { decodeTextureImage, readPalette, readTexture } from "./texture.mjs";

export function resolveRootPackage(pkg, objectIndex) {
  let current = objectIndex;
  let lastPackage = null;
  while (current < 0) {
    const item = pkg.imports[-current - 1];
    if (!item) return lastPackage;
    if (item.classPackage === "Core" && item.className === "Package") {
      lastPackage = item.objectName;
    }
    if (item.packageIndex === 0) return lastPackage ?? item.objectName;
    current = item.packageIndex;
  }
  return lastPackage;
}

function findExport(pkg, name, className) {
  return pkg.exports.find((item) => item.objectName === name && (!className || item.className === className))
    ?? pkg.exports.find((item) => item.objectName === name)
    ?? null;
}

function makeChecker() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const odd = ((x >> 3) + (y >> 3)) & 1;
      const base = (y * size + x) * 4;
      data[base] = odd ? 210 : 40;
      data[base + 1] = odd ? 40 : 210;
      data[base + 2] = 210;
      data[base + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function readSourceTextureRef(pkg, exportItem) {
  if (!exportItem.serialOffset) return null;
  const reader = new BinaryReader(pkg.buffer, exportItem.serialOffset);
  const nameIndex = reader.compactIndex();
  const name = pkg.names[nameIndex]?.text;
  if (name !== "SourceTexture") return null;
  reader.u8();
  return reader.compactIndex();
}

export async function createTextureCatalog(mapPkg, model, { loadPackage }) {
  const packageCache = new Map();
  const textures = new Map();
  const errors = [];
  const checker = makeChecker();

  async function getPackage(name) {
    const key = name.toLowerCase();
    if (!packageCache.has(key)) {
      packageCache.set(key, (async () => {
        const bytes = await loadPackage(name);
        return readPackage(bytes);
      })());
    }
    return packageCache.get(key);
  }

  async function resolveRef(pkg, ref) {
    if (ref > 0) return { pkg, item: pkg.exports[ref - 1] };
    if (ref < 0) {
      const item = pkg.imports[-ref - 1];
      if (!item) return null;
      const root = resolveRootPackage(pkg, ref);
      if (!root) return null;
      const target = await getPackage(root);
      return { pkg: target, item: findExport(target, item.objectName) };
    }
    return null;
  }

  async function resolveTextureExport(pkg, item) {
    let currentPkg = pkg;
    let current = item;
    for (let depth = 0; current && current.className !== "Texture" && depth < 4; depth += 1) {
      const sourceRef = readSourceTextureRef(currentPkg, current);
      if (sourceRef === null) break;
      const resolved = await resolveRef(currentPkg, sourceRef);
      if (!resolved || !resolved.item) break;
      currentPkg = resolved.pkg;
      current = resolved.item;
    }
    return { pkg: currentPkg, item: current };
  }

  async function loadPalette(pkg, ref) {
    if (ref === null || ref === undefined) return null;
    if (ref > 0) {
      const item = pkg.exports[ref - 1];
      return item ? readPalette(pkg, item) : null;
    }
    const item = pkg.imports[-ref - 1];
    if (!item) return null;
    const root = resolveRootPackage(pkg, ref);
    if (!root) return null;
    const palettePackage = await getPackage(root);
    const paletteExport = findExport(palettePackage, item.objectName, "Palette");
    return paletteExport ? readPalette(palettePackage, paletteExport) : null;
  }

  const refs = new Set();
  for (const surface of model.surfaces) refs.add(surface.texture);

  for (const ref of refs) {
    try {
      let texture;
      let sourcePackage;
      if (ref > 0) {
        const item = mapPkg.exports[ref - 1];
        if (!item) throw new Error(`Нет экспорта ${ref}`);
        const resolved = await resolveTextureExport(mapPkg, item);
        sourcePackage = resolved.pkg;
        texture = readTexture(resolved.pkg, resolved.item);
      } else {
        const item = mapPkg.imports[-ref - 1];
        if (!item) throw new Error(`Нет импорта ${-ref - 1}`);
        const root = resolveRootPackage(mapPkg, ref);
        if (!root) throw new Error(`Не найден пакет для ${item.objectName}`);
        sourcePackage = await getPackage(root);
        const textureExport = findExport(sourcePackage, item.objectName);
        if (!textureExport) throw new Error(`Нет текстуры ${root}.${item.objectName}`);
        const resolved = await resolveTextureExport(sourcePackage, textureExport);
        sourcePackage = resolved.pkg;
        texture = readTexture(resolved.pkg, resolved.item);
      }

      const palette = texture.paletteRef === null ? null : await loadPalette(sourcePackage, texture.paletteRef);
      const image = decodeTextureImage(texture, palette);
      textures.set(ref, image);
    } catch (error) {
      errors.push({ ref, message: error.message });
      textures.set(ref, checker);
    }
  }

  return { textures, errors, checker, packages: packageCache };
}

export function buildTexturedMesh(model, catalog, lights = [], lightOptions = {}) {
  const buckets = new Map();
  const lightmap = lightOptions.lightmapAtlas ?? null;
  const sampleLight = createLightSampler(model, lights, lightOptions);
  let triangles = 0;
  let skipped = 0;

  for (const node of model.nodes) {
    if (lightOptions.nodeFilter && !lightOptions.nodeFilter(node)) continue;
    const count = node.vertexCount;
    if (count < 3 || node.vertexPool < 0 || node.vertexPool + count > model.vertices.length) {
      skipped += 1;
      continue;
    }
    const surface = model.surfaces[node.surface];
    if (!surface) {
      skipped += 1;
      continue;
    }
    if (!lightOptions.keepFlagged && (surface.polyFlags & 0x81)) {
      skipped += 1;
      continue;
    }
    if ((surface.polyFlags & 0x04000000) && !(surface.polyFlags & 0x44)) {
      skipped += 1;
      continue;
    }
    const image = catalog.textures.get(surface.texture) ?? catalog.checker;
    const base = model.points[surface.base];
    const texU = model.vectors[surface.textureU];
    const texV = model.vectors[surface.textureV];
    if (!base || !texU || !texV) {
      skipped += 1;
      continue;
    }
    const width = image.width || 1;
    const height = image.height || 1;
    const panU = surface.panU / width;
    const panV = surface.panV / height;

    const pool = [];
    for (let index = 0; index < count; index += 1) {
      const vertex = model.vertices[node.vertexPool + index];
      const point = model.points[vertex?.point ?? -1];
      if (!point) {
        pool.length = 0;
        break;
      }
      const dx = point.x - base.x;
      const dy = point.y - base.y;
      const dz = point.z - base.z;
      const rawU = dx * texU.x + dy * texU.y + dz * texU.z;
      const rawV = dx * texV.x + dy * texV.y + dz * texV.z;
      const u = rawU / width + panU;
      const v = rawV / height + panV;
      pool.push({ point, index: vertex.point, u, v, rawU, rawV });
    }
    if (!pool.length) {
      skipped += 1;
      continue;
    }

    let bucket = buckets.get(surface.texture);
    if (!bucket) {
      bucket = { positions: [], normals: [], uvs: [], colors: [], lmuvs: [] };
      buckets.set(surface.texture, bucket);
    }
    const normal = [node.plane[0], node.plane[1], node.plane[2]];
    const lm = surface.lightMap >= 0 ? model.lightMap[surface.lightMap] : null;
    const rect = lightmap && surface.lightMap >= 0 ? lightmap.rects[surface.lightMap] : null;

    for (let index = 1; index < count - 1; index += 1) {
      for (const vertex of [pool[0], pool[index], pool[index + 1]]) {
        let color;
        let lmU = lightmap ? lightmap.whiteUV[0] : 0;
        let lmV = lightmap ? lightmap.whiteUV[1] : 0;
        if (lightmap && lm && rect) {
          const lu = (vertex.rawU - lm.pan.x) / lm.uScale;
          const lv = (vertex.rawV - lm.pan.y) / lm.vScale;
          lmU = (rect.x + lu + 0.5) / lightmap.width;
          lmV = (rect.y + lv + 0.5) / lightmap.height;
          color = [1, 1, 1];
        } else {
          color = sampleLight(surface, vertex.point, vertex.rawU, vertex.rawV);
        }
        bucket.positions.push(vertex.point.x, vertex.point.y, vertex.point.z);
        bucket.normals.push(normal[0], normal[1], normal[2]);
        bucket.uvs.push(vertex.u, vertex.v);
        bucket.colors.push(color[0], color[1], color[2]);
        bucket.lmuvs.push(lmU, lmV);
      }
      triangles += 1;
    }
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const lmuvs = [];
  const groups = [];
  for (const [ref, bucket] of buckets) {
    const start = positions.length / 3;
    positions.push(...bucket.positions);
    normals.push(...bucket.normals);
    uvs.push(...bucket.uvs);
    colors.push(...bucket.colors);
    lmuvs.push(...bucket.lmuvs);
    groups.push({ ref, start, count: bucket.positions.length / 3 });
  }

  return { positions, normals, uvs, colors, lmuvs, groups, triangles, skipped };
}
