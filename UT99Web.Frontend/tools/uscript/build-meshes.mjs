import fs from "node:fs";
import path from "node:path";
import { BinaryReader } from "../../engine/src/package/binary-reader.mjs";
import { readPackage } from "../../engine/src/package/package.mjs";
import { readActors } from "../../engine/src/level/actors.mjs";
import { readLodMesh } from "../../engine/src/mesh/lodmesh.mjs";
import { decodeTextureImage, readPalette, readTexture } from "../../engine/src/texture/texture.mjs";
import { coerceDefault, loadScriptDirectory } from "../../engine/src/uscript/source.mjs";
import { writePng } from "./png.mjs";
import { decompressUz } from "../assets/uz.mjs";

// Версия формата бандла: при изменении структуры JSON её нужно поднять,
// чтобы вьюер потребовал пересборку, а не работал на старых данных.
const BUNDLE_VERSION = 45;

function meshTransform(mesh) {
  const toRad = (value) => value * Math.PI / 180;
  const yaw = mesh.rotationOrigin.yaw * (180 / 32768);
  const pitch = mesh.rotationOrigin.pitch * (180 / 32768);
  const roll = -mesh.rotationOrigin.roll * (180 / 32768);
  const sy = Math.sin(toRad(yaw)), cy = Math.cos(toRad(yaw));
  const sp = Math.sin(toRad(pitch)), cp = Math.cos(toRad(pitch));
  const sr = Math.sin(toRad(roll)), cr = Math.cos(toRad(roll));
  const forward = [cp * cy, cp * sy, -sp];
  const right = [-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp];
  const up = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  const axis = [forward, [-right[0], -right[1], -right[2]], up];
  axis[0][2] *= -1;
  axis[1][2] *= -1;
  axis[2][0] *= -1;
  axis[2][1] *= -1;
  const scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
  for (let index = 0; index < 3; index += 1) {
    for (let component = 0; component < 3; component += 1) axis[index][component] *= scale[index];
  }
  const origin = [0, 1, 2].map((component) =>
    -axis[0][component] * mesh.origin.x - axis[1][component] * mesh.origin.y - axis[2][component] * mesh.origin.z
  );
  return (point) => ({
    x: origin[0] + axis[0][0] * point.x + axis[1][0] * point.y + axis[2][0] * point.z,
    y: origin[1] + axis[0][1] * point.x + axis[1][1] * point.y + axis[2][1] * point.z,
    z: origin[2] + axis[0][2] * point.x + axis[1][2] * point.y + axis[2][2] * point.z
  });
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const mapsDir = path.join(root, "assets", "game", "Maps");
const mapArgs = process.argv.slice(2);
const mapPaths = mapArgs.length
  ? mapArgs.map((item) => path.resolve(item))
  : [path.join(mapsDir, "DM-Deck16][.unr.uz")];
const scriptsDir = path.join(root, "assets", "game", "Scripts", "Botpack");
const botpackPath = path.join(root, "assets", "game", "System", "Botpack.u");
const outputPath = path.join(root, "assets", "game", "Scripts", "pickup-meshes.json");
const atlasPath = path.join(root, "assets", "game", "Scripts", "pickup-atlas.png");

function parseVectorDefault(value) {
  if (typeof value !== "string") return null;
  const read = (axis) => {
    const match = new RegExp(`${axis}=(-?\\d+(?:\\.\\d+)?)`).exec(value);
    return match ? Number(match[1]) : 0;
  };
  return [read("X"), read("Y"), read("Z")];
}

function defaultFromClass(scripts, className, key) {
  let current = className;
  for (let depth = 0; depth < 12; depth += 1) {
    const script = scripts.get(String(current).toLowerCase());
    if (!script) return undefined;
    const value = script.defaults.get(key)
      ?? [...script.defaults].find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
    if (value !== undefined) return coerceDefault(value);
    current = script.superName;
  }
  return undefined;
}

const actors = [];
for (const mapPath of mapPaths) {
  let mapBytes = fs.readFileSync(mapPath);
  if (mapPath.toLowerCase().endsWith(".uz")) mapBytes = Buffer.from(decompressUz(mapBytes).data);
  const mapPkg = readPackage(mapBytes);
  actors.push(...readActors(mapPkg));
}
const botpack = readPackage(fs.readFileSync(botpackPath));
const soldierSkins = readPackage(fs.readFileSync(path.join(root, "assets", "game", "Textures", "SoldierSkins.utx")));
const loadedScripts = loadScriptDirectory(scriptsDir);
// Имена классов в пакете карты и в .uc-файлах различаются регистром
// (например, `minigun2` против `Minigun2`), поэтому ищем без учёта регистра.
const scripts = new Map([...loadedScripts].map(([name, script]) => [name.toLowerCase(), script]));

const imageCache = new Map();

function sourceTextureRef(pkg, item) {
  const reader = new BinaryReader(pkg.buffer, item.serialOffset);
  const nameIndex = reader.compactIndex();
  if (pkg.names[nameIndex]?.text !== "SourceTexture") return null;
  reader.u8();
  return reader.compactIndex();
}

function loadTextureImage(ref, depth = 0) {
  if (ref <= 0 || depth > 4) return null;
  if (imageCache.has(ref)) return imageCache.get(ref);
  const item = botpack.exports[ref - 1];
  if (!item) return null;
  if (item.className !== "Texture") {
    const source = sourceTextureRef(botpack, item);
    const image = source === null ? null : loadTextureImage(source, depth + 1);
    imageCache.set(ref, image);
    return image;
  }
  try {
    const texture = readTexture(botpack, item);
    let palette = null;
    if (texture.paletteRef !== null && texture.paletteRef > 0) {
      palette = readPalette(botpack, botpack.exports[texture.paletteRef - 1]);
    }
    const image = decodeTextureImage(texture, palette);
    imageCache.set(ref, image);
    return image;
  } catch {
    imageCache.set(ref, null);
    return null;
  }
}

const byClass = {};
const meshEntries = new Map();
const skinByMesh = new Map();

for (const actor of actors) {
  const meshValue = defaultFromClass(scripts, actor.className, "PickupViewMesh")
    ?? defaultFromClass(scripts, actor.className, "Mesh");
  if (!meshValue || typeof meshValue !== "object") continue;
  const name = String(meshValue.object).split(".").pop();
  const item = botpack.exports.find((entry) => entry.objectName === name && entry.className === "LodMesh");
  if (!item) continue;
  byClass[actor.className] = name;
  if (!meshEntries.has(name)) meshEntries.set(name, { item, mesh: readLodMesh(botpack, item) });
  const skinValue = defaultFromClass(scripts, actor.className, "Skin");
  if (skinValue && typeof skinValue === "object" && !skinByMesh.has(name)) {
    const skinName = String(skinValue.object).split(".").pop();
    const skinExport = botpack.exports.find((entry) => entry.objectName === skinName && entry.className === "Texture");
    if (skinExport) skinByMesh.set(name, skinExport.index + 1);
  }
}

const botExport = botpack.exports.find((entry) => entry.objectName === "Soldier" && entry.className === "LodMesh");
const botMesh = botExport ? readLodMesh(botpack, botExport) : null;
const botAnims = new Map();
if (botMesh) {
  for (const [key, name] of [["idle", "Breath1"], ["run", "Walk"], ["death", "Dead1"]]) {
    const animation = botMesh.animations.find((item) => botpack.names[item.name]?.text === name);
    if (animation) botAnims.set(key, animation);
  }
}

const weaponNames = ["AutoML", "ASMD2M", "Rifle2m", "flakm", "PulseGunR", "Eightm", "Minigun2m", "Razor2", "BRifle2", "WarHead", "AutoHand", "ASMD2hand", "RifleHand", "FlakHand", "EightHand", "PulseGun3rd", "BRifle23", "WHHand", "MiniHand", "MagPick", "ASMD2pick", "RiflePick", "Flak2Pick", "PulsePickup", "Eight2Pick", "RazPick2"];
const weaponMeshEntries = new Map();
for (const name of weaponNames) {
  const item = botpack.exports.find((entry) => entry.objectName === name && entry.className === "LodMesh");
  if (item) weaponMeshEntries.set(name, { item, mesh: readLodMesh(botpack, item) });
}

const usedRefs = new Set();
for (const [name, { mesh }] of meshEntries) {
  for (const face of mesh.faces) {
    const material = mesh.materials[face.material];
    const ref = material ? mesh.textureRefs[material.textureIndex] ?? 0 : 0;
    if (ref > 0) usedRefs.add(ref);
  }
  const skinRef = skinByMesh.get(name);
  if (skinRef) usedRefs.add(skinRef);
}

if (botMesh) {
  for (const face of botMesh.faces) {
    const material = botMesh.materials[face.material];
    const ref = material ? botMesh.textureRefs[material.textureIndex] ?? 0 : 0;
    if (ref > 0) usedRefs.add(ref);
  }
}
for (const { mesh } of weaponMeshEntries.values()) {
  for (const face of mesh.faces) {
    const material = mesh.materials[face.material];
    const ref = material ? mesh.textureRefs[material.textureIndex] ?? 0 : 0;
    if (ref > 0) usedRefs.add(ref);
  }
}

const images = [];
for (const ref of usedRefs) {
  const image = loadTextureImage(ref);
  if (image) images.push({ ref, ...image });
}
// У Soldier-меша textureRefs пустые: скины назначаются в рантайме через
// MultiSkins. Элементы меша SoldierSkins: 0 = тело (sldr1), 1 = броня
// (sldr2), 2 = шлем/перчатки (sldr3), 3 = лицо (sldr4). В deathmatch без
// команд берём базовые варианты без суффикса T_<team>.
const SOLDIER_SKINS = ["sldr1", "sldr2", "sldr3", "Sldr4Rankin"];
for (let index = 0; index < SOLDIER_SKINS.length; index += 1) {
  const skinExport = soldierSkins.exports.find((entry) => entry.objectName === SOLDIER_SKINS[index] && entry.className === "Texture");
  if (!skinExport) continue;
  try {
    const texture = readTexture(soldierSkins, skinExport);
    let palette = null;
    if (texture.paletteRef !== null && texture.paletteRef > 0) {
      palette = readPalette(soldierSkins, soldierSkins.exports[texture.paletteRef - 1]);
    }
    const image = decodeTextureImage(texture, palette);
    images.push({ ref: `soldier${index}`, ...image });
  } catch {}
}
images.sort((a, b) => b.height - a.height || b.width - a.width);

const atlasWidth = 1024;
let x = 1;
let y = 1;
let rowHeight = 0;
for (const image of images) {
  if (x + image.width + 1 > atlasWidth) {
    x = 1;
    y += rowHeight + 1;
    rowHeight = 0;
  }
  image.x = x;
  image.y = y;
  x += image.width + 1;
  rowHeight = Math.max(rowHeight, image.height);
}
let atlasHeight = 1;
while (atlasHeight < y + rowHeight + 1) atlasHeight *= 2;
const atlas = new Uint8Array(atlasWidth * atlasHeight * 4);
atlas[0] = 255; atlas[1] = 255; atlas[2] = 255; atlas[3] = 255;

for (const image of images) {
  for (let row = 0; row < image.height; row += 1) {
    const source = row * image.width * 4;
    const target = ((image.y + row) * atlasWidth + image.x) * 4;
    atlas.set(image.data.subarray(source, source + image.width * 4), target);
  }
}

const rectByRef = new Map(images.map((image) => [image.ref, image]));
const whiteUV = [0.5 / atlasWidth, 0.5 / atlasHeight];

const meshes = {};
for (const [name, { mesh }] of meshEntries) {
  const positions = [];
  const uvs = [];
  for (const face of mesh.faces) {
    const wedges = [mesh.wedges[face.a], mesh.wedges[face.b], mesh.wedges[face.c]];
    if (wedges.some((wedge) => !wedge || !mesh.vertices[wedge.vertex])) continue;
    const material = mesh.materials[face.material];
    let ref = material ? mesh.textureRefs[material.textureIndex] ?? 0 : 0;
    let image = rectByRef.get(ref);
    if (!image) image = rectByRef.get(skinByMesh.get(name));
    for (const wedge of wedges) {
      const point = mesh.vertices[wedge.vertex];
      positions.push(point.x, point.y, point.z);
      if (image) {
        uvs.push(
          (image.x + 0.5 + (wedge.s / 255) * (image.width - 1)) / atlasWidth,
          (image.y + 0.5 + (wedge.t / 255) * (image.height - 1)) / atlasHeight
        );
      } else {
        uvs.push(whiteUV[0], whiteUV[1]);
      }
    }
  }
  meshes[name] = { positions, uvs };
  if (mesh.animationFrames > 1 && mesh.animationFrames <= 80 && mesh.frameVertices > 0) {
    const frames = [];
    for (let frameIndex = 0; frameIndex < mesh.animationFrames; frameIndex += 1) {
      const framePositions = [];
      for (const face of mesh.faces) {
        const wedges = [mesh.wedges[face.a], mesh.wedges[face.b], mesh.wedges[face.c]];
        if (wedges.some((wedge) => !wedge)) continue;
        for (const wedge of wedges) {
          const point = mesh.vertices[frameIndex * mesh.frameVertices + wedge.vertex];
          if (point) framePositions.push(point.x, point.y, point.z);
        }
      }
      frames.push(framePositions);
    }
    meshes[name].frames = frames;
  }
}

const weaponMeshes = {};
for (const [name, { mesh }] of weaponMeshEntries) {
  const transform = meshTransform(mesh);
  const positions = [];
  const uvs = [];
  const materials = [];
  for (const face of mesh.faces) {
    const wedges = [mesh.wedges[face.a], mesh.wedges[face.b], mesh.wedges[face.c]];
    if (wedges.some((wedge) => !wedge || !mesh.vertices[wedge.vertex])) continue;
    materials.push(face.material, face.material, face.material);
    const material = mesh.materials[face.material];
    const ref = material ? mesh.textureRefs[material.textureIndex] ?? 0 : 0;
    const image = rectByRef.get(ref);
    for (const wedge of wedges) {
      const point = mesh.vertices[wedge.vertex];
      const world = transform(point);
      positions.push(world.x, world.y, world.z);
      if (image) {
        uvs.push(
          (image.x + 0.5 + (wedge.s / 255) * (image.width - 1)) / atlasWidth,
          (image.y + 0.5 + (wedge.t / 255) * (image.height - 1)) / atlasHeight
        );
      } else {
        uvs.push(whiteUV[0], whiteUV[1]);
      }
    }
  }
  const entry = { positions, uvs, materials };
  // Кадры нужны не все подряд (All может быть 150+), а только те, что
  // проигрывает viewmodel: Still/Idle, Select, Down и один огневой набор.
  if (mesh.animationFrames > 1 && mesh.frameVertices > 0) {
    const named = new Map();
    for (const animation of mesh.animations) {
      const animName = botpack.names[animation.name]?.text;
      if (animName && !named.has(animName.toLowerCase())) named.set(animName.toLowerCase(), animation);
    }
    const pick = (...names) => names.map((n) => named.get(n)).find(Boolean);
    const selected = {
      idle: pick("still", "idle", "still2"),
      select: pick("select"),
      fire: pick("shoot", "shoot1", "fire", "fire1", "shot2"),
      down: pick("down")
    };
    const animations = {};
    for (const [key, animation] of Object.entries(selected)) {
      if (!animation || !animation.count) continue;
      const frames = [];
      for (let frameIndex = 0; frameIndex < animation.count; frameIndex += 1) {
        const framePositions = [];
        for (const face of mesh.faces) {
          const wedges = [mesh.wedges[face.a], mesh.wedges[face.b], mesh.wedges[face.c]];
          if (wedges.some((wedge) => !wedge)) continue;
          for (const wedge of wedges) {
            const point = mesh.vertices[(animation.start + frameIndex) * mesh.frameVertices + wedge.vertex];
            if (point) {
              const world = transform(point);
              framePositions.push(world.x, world.y, world.z);
            }
          }
        }
        frames.push(framePositions);
      }
      animations[key] = { frames, rate: animation.rate };
    }
    if (Object.keys(animations).length) entry.animations = animations;
  }
  // Bounds по всем кадрам (в метрах, world-space после meshTransform).
  const source = entry.animations ? Object.values(entry.animations).flatMap((a) => a.frames) : [positions];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const frame of source) {
    for (let index = 0; index < frame.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], frame[index + axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], frame[index + axis]);
      }
    }
  }
  entry.bounds = bounds;
  weaponMeshes[name] = entry;
}

// Таблица оружия из default properties Botpack: mesh, PlayerViewOffset,
// PlayerViewScale. Вьюер обязан брать параметры только отсюда.
const WEAPON_CLASSES = [
  "Enforcer", "ShockRifle", "SniperRifle", "UT_FlakCannon", "PulseGun",
  "UT_Eightball", "minigun2", "ripper", "ut_biorifle", "WarheadLauncher"
];
const weapons = {};
for (const className of WEAPON_CLASSES) {
  const meshValue = defaultFromClass(scripts, className, "PlayerViewMesh");
  if (!meshValue || typeof meshValue !== "object") continue;
  const mesh = String(meshValue.object).split(".").pop();
  const offset = parseVectorDefault(coerceDefault(scripts.get(className.toLowerCase())?.defaults.get("PlayerViewOffset"))
    ?? defaultFromClass(scripts, className, "PlayerViewOffset")) ?? [0, 0, 0];
  const scale = Number(defaultFromClass(scripts, className, "PlayerViewScale")) || 1;
  weapons[className] = { mesh, offset, scale };
}
// WarHead авторизован стволом назад и вверх от origin (плечевая
// установка): в виде от первого лица его нужно развернуть на 180°.
weapons.WarheadLauncher = { ...weapons.WarheadLauncher, yaw: 180 };

let bot = null;
if (botMesh && botAnims.size) {
  const transform = meshTransform(botMesh);
  const uvs = [];
  for (const face of botMesh.faces) {
    const wedges = [botMesh.wedges[face.a], botMesh.wedges[face.b], botMesh.wedges[face.c]];
    if (wedges.some((wedge) => !wedge)) continue;
    const image = rectByRef.get(`soldier${Math.min(face.material, 3)}`);
    for (const wedge of wedges) {
      if (image) {
        uvs.push(
          (image.x + 0.5 + (wedge.s / 255) * (image.width - 1)) / atlasWidth,
          (image.y + 0.5 + (wedge.t / 255) * (image.height - 1)) / atlasHeight
        );
      } else {
        uvs.push(whiteUV[0], whiteUV[1]);
      }
    }
  }

  const rawAnimations = new Map();
  for (const [key, animation] of botAnims) {
    const rawFrames = [];
    const count = key === "death" ? Math.min(animation.count, 6) : animation.count;
    for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
      const positions = [];
      for (const face of botMesh.faces) {
        const wedges = [botMesh.wedges[face.a], botMesh.wedges[face.b], botMesh.wedges[face.c]];
        if (wedges.some((wedge) => !wedge)) continue;
        for (const wedge of wedges) {
          const point = botMesh.vertices[(animation.start + frameIndex) * botMesh.frameVertices + wedge.vertex + (botMesh.specialVertices || 0)];
          if (point) {
            const world = transform(point);
            positions.push(world.x, world.y, world.z);
          }
        }
      }
      rawFrames.push(positions);
    }
    rawAnimations.set(key, { frames: rawFrames, rate: animation.rate, count });
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const { frames } of rawAnimations.values()) {
    for (const frame of frames) {
      for (let index = 0; index < frame.length; index += 3) {
        minX = Math.min(minX, frame[index]); maxX = Math.max(maxX, frame[index]);
        minY = Math.min(minY, frame[index + 1]); maxY = Math.max(maxY, frame[index + 1]);
        minZ = Math.min(minZ, frame[index + 2]); maxZ = Math.max(maxZ, frame[index + 2]);
      }
    }
  }
  const height = Math.max(maxZ - minZ, 1);
  const factor = 90 / height;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const animations = {};
  for (const [key, { frames: rawFrames, rate, count }] of rawAnimations) {
    animations[key] = {
      rate,
      count,
      frames: rawFrames.map((frame) => {
        const result = [];
        for (let index = 0; index < frame.length; index += 3) {
          result.push(
            (frame[index] - centerX) * factor,
            (frame[index + 1] - centerY) * factor,
            (maxZ - frame[index + 2]) * factor
          );
        }
        return result;
      })
    };
  }
  const run = animations.run ?? animations.idle;
  bot = { name: "Soldier", frames: run.frames, uvs, frameCount: run.count, animations };
}

writePng(atlasPath, atlasWidth, atlasHeight, atlas);
fs.writeFileSync(outputPath, JSON.stringify({
  version: BUNDLE_VERSION,
  generatedAt: new Date().toISOString(),
  byClass,
  meshes,
  bot,
  weaponMeshes,
  weapons,
  atlas: { width: atlasWidth, height: atlasHeight, file: "pickup-atlas.png" }
}));

console.log(`Классов с мешами: ${Object.keys(byClass).length}`);
console.log(`Мешей: ${Object.keys(meshes).length}, текстур в атласе: ${images.length}`);
console.log(`Атлас: ${atlasWidth}x${atlasHeight}, ${fs.statSync(atlasPath).size} байт`);
console.log(`JSON: ${fs.statSync(outputPath).size} байт`);



