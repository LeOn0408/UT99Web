import { BinaryReader } from "../package/binary-reader.mjs";
import { skipTaggedProperties } from "../level/model.mjs";

function readVector(reader) {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32() };
}

function readBox(reader) {
  return { min: readVector(reader), max: readVector(reader), valid: reader.u8() !== 0 };
}

function readArray(reader, item, count) {
  const size = count ?? reader.compactIndex();
  const result = new Array(size);
  for (let index = 0; index < size; index += 1) result[index] = item(reader);
  return result;
}

function readVertex(reader) {
  const xyz = reader.u32();
  let x = (xyz & 0x7ff) / 8;
  let y = ((xyz >> 11) & 0x7ff) / 8;
  let z = ((xyz >> 22) & 0x3ff) / 4;
  if (x > 128) x -= 256;
  if (y > 128) y -= 256;
  if (z > 128) z -= 256;
  return { x, y, z };
}

function readTriangle(reader) {
  return {
    a: reader.u16(),
    b: reader.u16(),
    c: reader.u16(),
    uv: [reader.u8(), reader.u8(), reader.u8(), reader.u8(), reader.u8(), reader.u8()],
    flags: reader.u32(),
    texture: reader.u32()
  };
}

function readAnimation(reader) {
  return {
    name: reader.compactIndex(),
    group: reader.compactIndex(),
    start: reader.u32(),
    count: reader.u32(),
    notifications: readArray(reader, (r) => ({ time: r.u32(), functionName: r.compactIndex() })),
    rate: reader.f32()
  };
}

export function readLodMesh(pkg, exportItem) {
  const reader = new BinaryReader(pkg.buffer, exportItem.serialOffset);
  skipTaggedProperties(reader, pkg.names);

  readBox(reader);
  readVector(reader);
  reader.f32();

  if (pkg.header.version > 61) reader.u32();
  const allVertices = readArray(reader, readVertex);
  if (pkg.header.version > 61) reader.u32();
  const triangles = readArray(reader, readTriangle);
  const animations = readArray(reader, readAnimation);

  reader.u32();
  readArray(reader, (r) => { r.u32(); r.u32(); return null; });
  readBox(reader);
  readVector(reader);
  reader.f32();
  reader.u32();
  readArray(reader, (r) => r.u32());

  const textureRefs = readArray(reader, (r) => r.compactIndex());
  readArray(reader, readBox);
  readArray(reader, (r) => { readVector(r); r.f32(); return null; });

  const frameVertices = reader.u32();
  const animationFrames = reader.u32();
  reader.u32();
  reader.u32();
  const scale = readVector(reader);
  const origin = readVector(reader);
  const rotationOrigin = { pitch: reader.i32(), yaw: reader.i32(), roll: reader.i32() };
  reader.u32();
  reader.u32();
  readArray(reader, (r) => r.f32());

  readArray(reader, (r) => r.u16());
  readArray(reader, (r) => r.u16());
  const faces = readArray(reader, (r) => ({
    a: r.u16(),
    b: r.u16(),
    c: r.u16(),
    material: r.u16()
  }));
  readArray(reader, (r) => r.u16());
  const wedges = readArray(reader, (r) => ({
    vertex: r.u16(),
    s: r.u8(),
    t: r.u8()
  }));
  const materials = readArray(reader, (r) => ({
    flags: r.u32(),
    textureIndex: r.u32()
  }));
  const specialFaces = readArray(reader, (r) => ({
    a: r.u16(),
    b: r.u16(),
    c: r.u16(),
    material: r.u16()
  }));
  const modelVertices = reader.u32();
  const specialVertices = reader.u32();
  reader.f32();
  reader.f32();
  reader.f32();
  reader.u32();
  reader.f32();
  reader.f32();
  const remapAnimVertices = readArray(reader, (r) => r.u16());
  reader.u32();

  const vertices = allVertices;
  return {
    name: exportItem.objectName,
    vertices,
    triangles,
    animations,
    textureRefs,
    faces,
    specialFaces,
    wedges,
    materials,
    frameVertices,
    animationFrames,
    scale,
    origin,
    rotationOrigin,
    remapAnimVertices,
    modelVertices,
    specialVertices
  };
}

export function buildMeshTriangles(mesh) {
  const output = [];
  const positions = mesh.vertices;
  for (const face of mesh.faces) {
    const wedges = [mesh.wedges[face.a], mesh.wedges[face.b], mesh.wedges[face.c]];
    if (wedges.some((wedge) => !wedge || !positions[wedge.vertex])) continue;
    const material = mesh.materials[face.material];
    const texture = material ? mesh.textureRefs[material.textureIndex] ?? 0 : 0;
    for (const wedge of wedges) {
      const point = positions[wedge.vertex];
      output.push({
        point,
        s: wedge.s,
        t: wedge.t,
        texture
      });
    }
  }
  return output;
}



