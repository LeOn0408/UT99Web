import { BinaryReader } from "../package/binary-reader.mjs";

const MAX_ARRAY = 4_000_000;

function readVector(reader) {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32() };
}

function readBox(reader) {
  return { min: readVector(reader), max: readVector(reader), valid: reader.u8() !== 0 };
}

function readArray(reader, item, count) {
  const size = count ?? reader.compactIndex();
  if (size < 0 || size > MAX_ARRAY) {
    throw new Error(`Некорректный размер массива: ${size} @ ${reader.offset}`);
  }
  const result = new Array(size);
  for (let index = 0; index < size; index += 1) result[index] = item(reader);
  return result;
}

function readCompact(reader) {
  return reader.compactIndex();
}

function readBspNode(reader) {
  return {
    plane: [reader.f32(), reader.f32(), reader.f32(), reader.f32()],
    zoneMask: reader.bytes(8),
    nodeFlags: reader.u8(),
    vertexPool: reader.compactIndex(),
    surface: reader.compactIndex(),
    front: reader.compactIndex(),
    back: reader.compactIndex(),
    planeNext: reader.compactIndex(),
    collisionBound: reader.compactIndex(),
    renderBound: reader.compactIndex(),
    zone: [reader.compactIndex(), reader.compactIndex()],
    vertexCount: reader.u8(),
    leaf: [reader.u32(), reader.u32()]
  };
}

function readBspSurface(reader) {
  return {
    texture: reader.compactIndex(),
    polyFlags: reader.u32(),
    base: reader.compactIndex(),
    normal: reader.compactIndex(),
    textureU: reader.compactIndex(),
    textureV: reader.compactIndex(),
    lightMap: reader.compactIndex(),
    brushPoly: reader.compactIndex(),
    panU: reader.i16(),
    panV: reader.i16(),
    actor: reader.compactIndex()
  };
}

function readModelVertex(reader) {
  return { point: reader.compactIndex(), side: reader.compactIndex() };
}

function readZone(reader) {
  return { actor: reader.compactIndex(), connectivity: reader.bytes(8), visibility: reader.bytes(8) };
}

function readLightMap(reader) {
  return {
    dataOffset: reader.u32(),
    pan: readVector(reader),
    uClamp: reader.compactIndex(),
    vClamp: reader.compactIndex(),
    uScale: reader.f32(),
    vScale: reader.f32(),
    lightActors: reader.i32()
  };
}

function readLeaf(reader) {
  return {
    zone: reader.compactIndex(),
    permeating: reader.compactIndex(),
    volumetric: reader.compactIndex(),
    visibleZones: reader.bytes(8)
  };
}

export function skipTaggedProperties(reader, names) {
  for (;;) {
    const nameIndex = reader.compactIndex();
    const name = names[nameIndex]?.text;
    if (name === undefined) throw new Error(`Неизвестное имя свойства: ${nameIndex}`);
    if (name.toLowerCase() === "none") return;

    const info = reader.u8();
    const type = info & 0x0f;
    const sizeCode = (info >> 4) & 0x07;

    if (type === 10) reader.compactIndex();

    let size;
    switch (sizeCode) {
      case 0: size = 1; break;
      case 1: size = 2; break;
      case 2: size = 4; break;
      case 3: size = 12; break;
      case 4: size = 16; break;
      case 5: size = reader.u8(); break;
      case 6: size = reader.u16(); break;
      case 7: size = reader.u32(); break;
      default: size = 1;
    }

    if (type !== 3 && info & 0x80) reader.u8();
    if (type !== 3) reader.skip(size);
  }
}

export function readModel(reader, version) {
  if (version < 62) throw new Error(`Модели UE1 версии ${version} пока не поддерживаются`);

  const boundingBox = readBox(reader);
  const boundingSphere = { center: readVector(reader), radius: reader.f32() };

  const vectors = readArray(reader, readVector);
  const points = readArray(reader, readVector);
  const nodes = readArray(reader, readBspNode);
  const surfaces = readArray(reader, readBspSurface);
  const vertices = readArray(reader, readModelVertex);
  const sharedSides = reader.i32();
  const zoneCount = reader.i32();
  const zones = readArray(reader, readZone, zoneCount);

  const polys = reader.compactIndex();
  const lightMap = readArray(reader, readLightMap);
  const lightBits = readArray(reader, (r) => r.u8());
  const bounds = readArray(reader, readBox);
  const leafHulls = readArray(reader, (r) => r.i32());
  const leaves = readArray(reader, readLeaf);
  const lights = readArray(reader, readCompact);
  const rootOutside = reader.u32();
  const linked = reader.u32();

  return {
    boundingBox,
    boundingSphere,
    vectors,
    points,
    nodes,
    surfaces,
    vertices,
    sharedSides,
    zoneCount,
    zones,
    polys,
    lightMap,
    lightBits,
    bounds,
    leafHulls,
    leaves,
    lights,
    rootOutside,
    linked
  };
}

export function findLevelModel(pkg) {
  const models = pkg.exports
    .filter((item) => item.className === "Model" && item.serialSize > 0)
    .sort((a, b) => b.serialSize - a.serialSize);
  if (!models.length) throw new Error("В пакете нет моделей");
  return models[0];
}

export function loadLevelModel(pkg) {
  const modelExport = findLevelModel(pkg);
  const reader = new BinaryReader(pkg.buffer, modelExport.serialOffset);
  skipTaggedProperties(reader, pkg.names);
  const model = readModel(reader, pkg.header.version);
  model.name = modelExport.objectName;
  return model;
}

function colorForSurface(surface, index) {
  const seed = Math.abs(surface?.texture ?? index) * 2654435761;
  const hue = ((seed >>> 0) % 360) / 360;
  const saturation = 0.35;
  const lightness = 0.45 + ((seed >>> 8) % 20) / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 1 / 6) [r, g, b] = [c, x, 0];
  else if (hue < 2 / 6) [r, g, b] = [x, c, 0];
  else if (hue < 3 / 6) [r, g, b] = [0, c, x];
  else if (hue < 4 / 6) [r, g, b] = [0, x, c];
  else if (hue < 5 / 6) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

export function buildRenderMesh(model) {
  const positions = [];
  const normals = [];
  const colors = [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let triangles = 0;
  let skipped = 0;

  const pointAt = (index) => {
    const item = model.points[index];
    if (!item) return null;
    return item;
  };

  for (const node of model.nodes) {
    const count = node.vertexCount;
    if (count < 3 || node.vertexPool < 0 || node.vertexPool + count > model.vertices.length) {
      skipped += 1;
      continue;
    }
    const surface = model.surfaces[node.surface];
    const color = colorForSurface(surface, node.surface);
    const normal = [node.plane[0], node.plane[1], node.plane[2]];
    const pool = [];
    for (let index = 0; index < count; index += 1) {
      const vertex = model.vertices[node.vertexPool + index];
      pool.push(pointAt(vertex?.point ?? -1));
    }
    if (pool.some((point) => !point)) {
      skipped += 1;
      continue;
    }
    for (let index = 1; index < count - 1; index += 1) {
      for (const point of [pool[0], pool[index], pool[index + 1]]) {
        positions.push(point.x, point.y, point.z);
        normals.push(normal[0], normal[1], normal[2]);
        colors.push(color[0], color[1], color[2]);
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
      }
      triangles += 1;
    }
  }

  return { positions, normals, colors, min, max, triangles, skipped };
}
