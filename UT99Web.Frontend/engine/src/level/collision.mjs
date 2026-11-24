const PF_INVISIBLE = 0x00000001;
const PF_NOT_SOLID = 0x00000008;
const PF_PORTAL = 0x04000000;
const NF_NOT_CSG = 0x01;
const NF_IS_NEW = 0x20;

export function buildCollisionMesh(model) {
  const leafHulls = model.leafHulls ?? [];
  const positions = [];
  const seen = new Set();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const point of model.points ?? []) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); maxZ = Math.max(maxZ, point.z);
  }
  const mapSize = Math.max(4096, (maxX - minX) * 2, (maxY - minY) * 2, (maxZ - minZ) * 2);
  const mapCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const addPlane = (raw) => {
    const node = model.nodes[raw & ~0x40000000];
    if (!node) return null;
    const plane = node.plane;
    if (!plane) return null;
    const flipped = (raw & 0x40000000) !== 0;
    return flipped
      ? [-plane[0], -plane[1], -plane[2], -plane[3]]
      : [plane[0], plane[1], plane[2], plane[3]];
  };

  const clip = (polygon, plane) => {
    const output = [];
    const distance = (point) => plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] - plane[3];
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const dc = distance(current);
      const dn = distance(next);
      if (dc <= 1e-4) output.push(current);
      if ((dc > 1e-4 && dn < -1e-4) || (dc < -1e-4 && dn > 1e-4)) {
        const t = dc / (dc - dn);
        output.push([
          current[0] + (next[0] - current[0]) * t,
          current[1] + (next[1] - current[1]) * t,
          current[2] + (next[2] - current[2]) * t
        ]);
      }
    }
    return output;
  };

  for (const node of model.nodes) {
    const bound = node.collisionBound;
    if (bound < 0 || bound >= leafHulls.length || seen.has(bound)) continue;
    seen.add(bound);
    const planes = [];
    let index = bound;
    while (index < leafHulls.length) {
      const raw = leafHulls[index];
      if (raw === -1 || raw === -2147483648) break;
      const plane = addPlane(raw);
      if (plane) planes.push(plane);
      index += 1;
    }
    if (planes.length < 3) continue;
    for (let planeIndex = 0; planeIndex < planes.length; planeIndex += 1) {
      const plane = planes[planeIndex];
      const nx = plane[0], ny = plane[1], nz = plane[2];
      const length = Math.hypot(nx, ny, nz) || 1;
      const normal = [nx / length, ny / length, nz / length];
      const center = [normal[0] * plane[3], normal[1] * plane[3], normal[2] * plane[3]];
      const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [
        normal[1] * helper[2] - normal[2] * helper[1],
        normal[2] * helper[0] - normal[0] * helper[2],
        normal[0] * helper[1] - normal[1] * helper[0]
      ];
      const ulen = Math.hypot(...u) || 1;
      u = u.map((value) => value / ulen);
      const v = [
        normal[1] * u[2] - normal[2] * u[1],
        normal[2] * u[0] - normal[0] * u[2],
        normal[0] * u[1] - normal[1] * u[0]
      ];
      const size = mapSize;
      let polygon = [
        [center[0] + u[0] * size + v[0] * size, center[1] + u[1] * size + v[1] * size, center[2] + u[2] * size + v[2] * size],
        [center[0] - u[0] * size + v[0] * size, center[1] - u[1] * size + v[1] * size, center[2] - u[2] * size + v[2] * size],
        [center[0] - u[0] * size - v[0] * size, center[1] - u[1] * size - v[1] * size, center[2] - u[2] * size - v[2] * size],
        [center[0] + u[0] * size - v[0] * size, center[1] + u[1] * size - v[1] * size, center[2] + u[2] * size - v[2] * size]
      ];
      for (let other = 0; other < planes.length && polygon.length >= 3; other += 1) {
        if (other === planeIndex) continue;
        polygon = clip(polygon, planes[other]);
      }
      for (let vertex = 1; vertex < polygon.length - 1; vertex += 1) {
        for (const point of [polygon[0], polygon[vertex], polygon[vertex + 1]]) {
          positions.push(point[0], point[2], -point[1]);
        }
      }
    }
  }

  return new Float32Array(positions);
}

export function createCollisionWorld(triangles, cellSize = 256) {
  const triangleCount = triangles.length / 9;
  if (triangleCount === 0) {
    return { triangles, triangleCount: 0, cells: null };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const x = triangles[offset];
    const y = triangles[offset + 1];
    const z = triangles[offset + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const origin = [minX - 1, minY - 1, minZ - 1];
  const sizeX = Math.max(1, Math.ceil((maxX - origin[0]) / cellSize));
  const sizeY = Math.max(1, Math.ceil((maxY - origin[1]) / cellSize));
  const sizeZ = Math.max(1, Math.ceil((maxZ - origin[2]) / cellSize));

  const cells = new Array(sizeX * sizeY * sizeZ).fill(null);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 9;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    let bz1 = -Infinity;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const x = triangles[offset + vertex * 3];
      const y = triangles[offset + vertex * 3 + 1];
      const z = triangles[offset + vertex * 3 + 2];
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (z < bz0) bz0 = z;
      if (x > bx1) bx1 = x;
      if (y > by1) by1 = y;
      if (z > bz1) bz1 = z;
    }
    const ix0 = Math.floor((bx0 - origin[0]) / cellSize);
    const iy0 = Math.floor((by0 - origin[1]) / cellSize);
    const iz0 = Math.floor((bz0 - origin[2]) / cellSize);
    const ix1 = Math.min(sizeX - 1, Math.floor((bx1 - origin[0]) / cellSize));
    const iy1 = Math.min(sizeY - 1, Math.floor((by1 - origin[1]) / cellSize));
    const iz1 = Math.min(sizeZ - 1, Math.floor((bz1 - origin[2]) / cellSize));

    for (let iz = iz0; iz <= iz1; iz += 1) {
      for (let iy = iy0; iy <= iy1; iy += 1) {
        for (let ix = ix0; ix <= ix1; ix += 1) {
          const cellIndex = ix + iy * sizeX + iz * sizeX * sizeY;
          if (!cells[cellIndex]) cells[cellIndex] = [];
          cells[cellIndex].push(triangle);
        }
      }
    }
  }

  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) cells[index] = Int32Array.from(cells[index]);
  }

  return {
    triangles,
    triangleCount,
    cells,
    origin,
    cellSize,
    sizeX,
    sizeY,
    sizeZ,
    marks: new Uint32Array(triangleCount),
    stamp: 0,
    scratch: new Int32Array(triangleCount)
  };
}

export function buildCollisionWorld(model, cellSize = 256) {
  return createCollisionWorld(buildCollisionMesh(model), cellSize);
}

function collectCandidates(world, x, y, z, radius) {
  if (!world.cells) return 0;
  const { origin, cellSize, sizeX, sizeY, sizeZ, cells, marks, scratch } = world;
  world.stamp = (world.stamp + 1) >>> 0;
  if (world.stamp === 0) {
    marks.fill(0);
    world.stamp = 1;
  }
  const stamp = world.stamp;

  const ix0 = Math.max(0, Math.floor((x - radius - origin[0]) / cellSize));
  const iy0 = Math.max(0, Math.floor((y - radius - origin[1]) / cellSize));
  const iz0 = Math.max(0, Math.floor((z - radius - origin[2]) / cellSize));
  const ix1 = Math.min(sizeX - 1, Math.floor((x + radius - origin[0]) / cellSize));
  const iy1 = Math.min(sizeY - 1, Math.floor((y + radius - origin[1]) / cellSize));
  const iz1 = Math.min(sizeZ - 1, Math.floor((z + radius - origin[2]) / cellSize));

  let count = 0;
  for (let iz = iz0; iz <= iz1; iz += 1) {
    for (let iy = iy0; iy <= iy1; iy += 1) {
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cell = cells[ix + iy * sizeX + iz * sizeX * sizeY];
        if (!cell) continue;
        for (let index = 0; index < cell.length; index += 1) {
          const triangle = cell[index];
          if (marks[triangle] === stamp) continue;
          marks[triangle] = stamp;
          scratch[count++] = triangle;
        }
      }
    }
  }
  return count;
}

function closestPoint(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax; out[1] = ay; out[2] = az;
    return;
  }

  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx; out[1] = by; out[2] = bz;
    return;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v;
    out[1] = ay + aby * v;
    out[2] = az + abz * v;
    return;
  }

  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx; out[1] = cy; out[2] = cz;
    return;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w;
    out[1] = ay + acy * w;
    out[2] = az + acz * w;
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + (cx - bx) * w;
    out[1] = by + (cy - by) * w;
    out[2] = bz + (cz - bz) * w;
    return;
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

export function resolveSphereCollisions(source, position, velocity, radius, passes = 2) {
  const world = source.cells ? source : null;
  const triangles = world ? world.triangles : source;
  const closest = [0, 0, 0];
  const radiusSquared = radius * radius;
  let onGround = false;
  const candidateCount = world
    ? collectCandidates(world, position[0], position[1], position[2], radius + 1)
    : triangles.length / 9;

  const testTriangle = (offset) => {
    closestPoint(
      position[0], position[1], position[2],
      triangles[offset], triangles[offset + 1], triangles[offset + 2],
      triangles[offset + 3], triangles[offset + 4], triangles[offset + 5],
      triangles[offset + 6], triangles[offset + 7], triangles[offset + 8],
      closest
    );
    const dx = position[0] - closest[0];
    const dy = position[1] - closest[1];
    const dz = position[2] - closest[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared >= radiusSquared || distanceSquared < 1e-8) return;

    const distance = Math.sqrt(distanceSquared);
    const nx = dx / distance;
    const ny = dy / distance;
    const nz = dz / distance;
    const push = radius - distance;
    position[0] += nx * push;
    position[1] += ny * push;
    position[2] += nz * push;

    const incoming = velocity[0] * nx + velocity[1] * ny + velocity[2] * nz;
    if (incoming < 0) {
      velocity[0] -= nx * incoming;
      velocity[1] -= ny * incoming;
      velocity[2] -= nz * incoming;
    }
    if (ny > 0.45) onGround = true;
  };

  for (let pass = 0; pass < passes; pass += 1) {
    if (world) {
      for (let index = 0; index < candidateCount; index += 1) {
        testTriangle(world.scratch[index] * 9);
      }
    } else {
      for (let offset = 0; offset < triangles.length; offset += 9) {
        testTriangle(offset);
      }
    }
  }

  return onGround;
}

export function raycast(source, origin, direction, maxDistance = Infinity) {
  const triangles = source.triangles ?? source;
  const dx = direction[0];
  const dy = direction[1];
  const dz = direction[2];
  let best = maxDistance;
  let hit = null;

  for (let offset = 0; offset < triangles.length; offset += 9) {
    const ax = triangles[offset];
    const ay = triangles[offset + 1];
    const az = triangles[offset + 2];
    const e1x = triangles[offset + 3] - ax;
    const e1y = triangles[offset + 4] - ay;
    const e1z = triangles[offset + 5] - az;
    const e2x = triangles[offset + 6] - ax;
    const e2y = triangles[offset + 7] - ay;
    const e2z = triangles[offset + 8] - az;

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const determinant = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(determinant) < 1e-7) continue;
    const inverse = 1 / determinant;

    const tx = origin[0] - ax;
    const ty = origin[1] - ay;
    const tz = origin[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < 0 || u > 1) continue;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inverse;
    if (v < 0 || u + v > 1) continue;

    const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
    if (distance <= 1e-4 || distance >= best) continue;

    best = distance;
    const len = Math.hypot(e1x, e1y, e1z);
    const len2 = Math.hypot(e2x, e2y, e2z);
    const nx = (e1y * e2z - e1z * e2y) / (len * len2);
    const ny = (e1z * e2x - e1x * e2z) / (len * len2);
    const nz = (e1x * e2y - e1y * e2x) / (len * len2);
    hit = {
      distance,
      point: [origin[0] + dx * distance, origin[1] + dy * distance, origin[2] + dz * distance],
      normal: [nx, ny, nz]
    };
  }

  return hit;
}

export function raySphere(origin, direction, center, radius) {
  const ox = origin[0] - center[0];
  const oy = origin[1] - center[1];
  const oz = origin[2] - center[2];
  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0) return null;
  return distance;
}

