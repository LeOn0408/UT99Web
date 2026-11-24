import { BinaryReader } from "../package/binary-reader.mjs";
import { readActorProperties } from "./lights.mjs";
import { readModel, skipTaggedProperties } from "./model.mjs";

const PF_INVISIBLE = 0x00000001;
const PF_NOT_SOLID = 0x00000008;
const PF_PORTAL = 0x04000000;

function resolveExport(pkg, ref) {
  if (ref > 0) return pkg.exports[ref - 1] ?? null;
  return null;
}

function rotateYaw(x, y, yaw) {
  const angle = (yaw / 65536) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

function readBrushActors(pkg, classNames) {
  const movers = [];
  const triangles = [];

  for (const item of pkg.exports) {
    if (!classNames.includes(item.className)) continue;
    try {
      const { properties } = readActorProperties(pkg, item);
      const brushRef = properties.get("Brush")?.value;
      const location = properties.get("Location")?.value;
      const rotation = properties.get("Rotation")?.value ?? { pitch: 0, yaw: 0, roll: 0 };
      const scale = properties.get("PostScale")?.value ?? { x: 1, y: 1, z: 1 };
      if (!brushRef || !location) continue;

      const brush = resolveExport(pkg, brushRef);
      if (!brush || brush.className !== "Model") continue;

      const reader = new BinaryReader(pkg.buffer, brush.serialOffset);
      skipTaggedProperties(reader, pkg.names);
      const model = readModel(reader, pkg.header.version);

      const transform = (point) => {
        const [x, y] = rotateYaw(point.x * (scale.x || 1), point.y * (scale.y || 1), rotation.yaw);
        return { x: x + location.x, y: y + location.y, z: point.z * (scale.z || 1) + location.z };
      };

      const worldPoints = model.points.map(transform);
      const localTriangles = [];
      let built = 0;

      for (const node of model.nodes) {
        if (node.vertexCount < 3 || node.vertexPool < 0) continue;
        const surface = model.surfaces[node.surface];
        if (!surface) continue;
        if (surface.polyFlags & (PF_NOT_SOLID | PF_PORTAL)) continue;
        const pool = [];
        const localPool = [];
        for (let index = 0; index < node.vertexCount; index += 1) {
          const vertex = model.vertices[node.vertexPool + index];
          const point = worldPoints[vertex?.point ?? -1];
          const source = model.points[vertex?.point ?? -1];
          if (!point || !source) {
            pool.length = 0;
            break;
          }
          pool.push(point);
          localPool.push(source);
        }
        if (pool.length < 3) continue;
        for (let index = 1; index < pool.length - 1; index += 1) {
          for (const point of [pool[0], pool[index], pool[index + 1]]) {
            triangles.push(point.x, point.z, -point.y);
            built += 1;
          }
          for (const point of [localPool[0], localPool[index], localPool[index + 1]]) {
            localTriangles.push(point.x, point.y, point.z);
          }
        }
      }

      movers.push({
        name: item.objectName,
        location,
        rotation,
        scale,
        moveTime: properties.get("MoveTime")?.value ?? 0,
        keyPos: properties.get("KeyPos")?.value ?? null,
        model,
        localTriangles: new Float32Array(localTriangles),
        triangleCount: built / 3
      });
    } catch {
      continue;
    }
  }

  return { movers, triangles: new Float32Array(triangles) };
}

export function readMovers(pkg) {
  return readBrushActors(pkg, ["Mover"]);
}

export function readBrushes(pkg) {
  return readBrushActors(pkg, ["Brush"]);
}


