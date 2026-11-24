import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackage } from "../src/package/package.mjs";
import { loadLevelModel } from "../src/level/model.mjs";
import { readLevelLights } from "../src/level/lights.mjs";
import { readActors, readPlayerStarts } from "../src/level/actors.mjs";
import { buildActorMarkers } from "../src/level/markers.mjs";
import { buildTexturedMesh, createTextureCatalog } from "../src/texture/catalog.mjs";
import { buildCollisionMesh, buildCollisionWorld, resolveSphereCollisions } from "../src/level/collision.mjs";
import { bakeLightmapAtlas } from "../src/level/lightmap.mjs";
import { readMovers } from "../src/level/movers.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const deck = path.join(root, "assets", "game", "Maps", "DM-Deck16][.unr");
const textures = path.join(root, "assets", "game", "Textures");

test("загружает текстуры и строит меш с UV", { skip: !fs.existsSync(deck) }, async () => {
  const pkg = readPackage(fs.readFileSync(deck));
  const model = loadLevelModel(pkg);
  const catalog = await createTextureCatalog(pkg, model, {
    async loadPackage(name) {
      const file = path.join(textures, `${name}.utx`);
      if (!fs.existsSync(file)) throw new Error(`Нет файла ${name}.utx`);
      return new Uint8Array(fs.readFileSync(file));
    }
  });

  assert.equal(catalog.textures.size, 30);
  assert.equal(catalog.errors.length, 0);

  const lights = readLevelLights(pkg);
  assert.equal(lights.length, 231);

  const starts = readPlayerStarts(pkg);
  assert.equal(starts.length, 15);
  assert.ok(starts[0].location);

  const actors = readActors(pkg);
  assert.equal(actors.length, 87);
  const markers = buildActorMarkers(actors);
  assert.equal(markers.count, 87);
  assert.equal(markers.positions.length, 87 * 36 * 3);
  assert.equal(markers.colors.length, markers.positions.length);

  assert.equal(buildCollisionMesh(model).length / 9, 6295);

  const movers = readMovers(pkg);
  assert.equal(movers.movers.length, 2);
  assert.equal(movers.triangles.length / 9, 104);
  assert.equal(movers.movers[0].name, "Mover0");

  const world = buildCollisionWorld(model);
  assert.equal(world.triangleCount, 6295);
  const spawn = [starts[0].location.x, starts[0].location.z, -starts[0].location.y];
  const velocity = [0, 0, 0];
  let grounded = false;
  for (let step = 0; step < 120 && !grounded; step += 1) {
    velocity[1] -= 950 / 60;
    spawn[1] += velocity[1] / 60;
    grounded = resolveSphereCollisions(world, spawn, velocity, 20);
  }
  assert.equal(grounded, true);

  const mesh = buildTexturedMesh(model, catalog, lights);
  assert.equal(mesh.triangles, 4772);
  assert.equal(mesh.skipped, 21);
  assert.equal(mesh.groups.length, 29);
  assert.equal(mesh.positions.length, mesh.uvs.length / 2 * 3);
  assert.equal(mesh.positions.length, mesh.colors.length);

  for (const image of catalog.textures.values()) {
    assert.ok(image.width > 0);
    assert.ok(image.height > 0);
    assert.equal(image.data.length, image.width * image.height * 4);
  }

  const atlas = bakeLightmapAtlas(model, lights);
  assert.equal(atlas.rects.filter(Boolean).length, 807);
  assert.equal(atlas.atlas.length, atlas.width * atlas.height * 4);
  const firstRect = atlas.rects.find(Boolean);
  const firstPixel = ((firstRect.y * atlas.width) + firstRect.x) * 4;
  assert.ok(atlas.atlas[firstPixel + 3] === 255);

  const palette = new Set();
  for (let index = 0; index < atlas.atlas.length; index += 4 * 131) {
    palette.add((atlas.atlas[index] << 16) | (atlas.atlas[index + 1] << 8) | atlas.atlas[index + 2]);
  }
  assert.ok(palette.size > 8, `атлас должен быть не однотонным, цветов: ${palette.size}`);
  assert.ok(model.surfaces.filter((surface) => surface.lightMap >= 0).length > 0);

  const textured = buildTexturedMesh(model, catalog, lights, { lightmapAtlas: atlas });
  assert.equal(textured.lmuvs.length, (textured.positions.length / 3) * 2);
  assert.equal(textured.triangles, 4772);
  let minLm = Infinity;
  let maxLm = -Infinity;
  for (const value of textured.lmuvs) {
    if (value < minLm) minLm = value;
    if (value > maxLm) maxLm = value;
  }
  assert.ok(minLm >= 0 && maxLm <= 1, `lmuvs вне [0, 1]: ${minLm}..${maxLm}`);
  assert.ok(maxLm > minLm, "lmuvs не должны быть одной точкой");

  const floor = catalog.textures.get(-25);
  const pixels = floor.width * floor.height;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let index = 0; index < floor.data.length; index += 4) {
    red += floor.data[index];
    green += floor.data[index + 1];
    blue += floor.data[index + 2];
  }
  assert.ok(Math.abs(red / pixels - 64.28) < 0.5);
  assert.ok(Math.abs(green / pixels - 57.89) < 0.5);
  assert.ok(Math.abs(blue / pixels - 46.13) < 0.5);
});





