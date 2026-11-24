import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPackage } from "../src/package/package.mjs";
import { buildMeshTriangles, readLodMesh } from "../src/mesh/lodmesh.mjs";

const root = path.join(import.meta.dirname, "..", "..");
const botpack = path.join(root, "assets", "game", "System", "Botpack.u");

test("читает LodMesh из Botpack", { skip: !fs.existsSync(botpack) }, () => {
  const pkg = readPackage(fs.readFileSync(botpack));
  const item = pkg.exports.find((entry) => entry.objectName === "MedBox" && entry.className === "LodMesh");
  assert.ok(item);
  const mesh = readLodMesh(pkg, item);
  assert.equal(mesh.frameVertices, 40);
  assert.equal(mesh.faces.length, 76);
  assert.equal(mesh.wedges.length, 93);
  const triangles = buildMeshTriangles(mesh);
  assert.equal(triangles.length, 76 * 3);
  assert.ok(triangles.every((vertex) => Number.isFinite(vertex.point.x)));
});
