import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackage } from "../src/package/package.mjs";
import { buildRenderMesh, loadLevelModel } from "../src/level/model.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const deck = path.join(root, "assets", "game", "Maps", "DM-Deck16][.unr");

test("строит меш BSP для DM-Deck16][", { skip: !fs.existsSync(deck) }, () => {
  const pkg = readPackage(fs.readFileSync(deck));
  const model = loadLevelModel(pkg);
  assert.equal(model.name, "Model1");
  assert.equal(model.points.length, 2547);
  assert.equal(model.nodes.length, 1720);
  assert.equal(model.surfaces.length, 830);

  const mesh = buildRenderMesh(model);
  assert.equal(mesh.skipped, 0);
  assert.equal(mesh.triangles, 4821);
  assert.equal(mesh.positions.length, mesh.normals.length);
  assert.equal(mesh.positions.length, mesh.colors.length);
  assert.ok(mesh.min.x < mesh.max.x);
  assert.ok(mesh.min.z < mesh.max.z);
});
