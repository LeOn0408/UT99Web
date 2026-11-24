import assert from "node:assert/strict";
import test from "node:test";
import { createCollisionWorld, raySphere, raycast, resolveSphereCollisions } from "../src/level/collision.mjs";

const floor = new Float32Array([
  -100, 0, -100,
  100, 0, -100,
  0, 0, 100
]);

test("выталкивает сферу из плоскости", () => {
  const position = [0, 10, 0];
  const velocity = [0, -100, 0];
  const onGround = resolveSphereCollisions(floor, position, velocity, 20);
  assert.equal(onGround, true);
  assert.ok(Math.abs(position[1] - 20) < 1e-3);
  assert.equal(velocity[1], 0);
});

test("широкий этап даёт тот же результат", () => {
  const world = createCollisionWorld(floor, 16);
  const position = [0, 10, 0];
  const velocity = [0, -100, 0];
  const onGround = resolveSphereCollisions(world, position, velocity, 20);
  assert.equal(onGround, true);
  assert.ok(Math.abs(position[1] - 20) < 1e-3);
  assert.equal(velocity[1], 0);
});

test("луч попадает в пол", () => {
  const hit = raycast(floor, [0, 10, 0], [0, -1, 0], 100);
  assert.ok(hit);
  assert.ok(Math.abs(hit.distance - 10) < 1e-4);
  assert.ok(Math.abs(hit.point[1]) < 1e-4);
});

test("луч не попадает мимо пола", () => {
  const hit = raycast(floor, [0, 10, 0], [0, 1, 0], 100);
  assert.equal(hit, null);
});

test("луч попадает в сферу", () => {
  const distance = raySphere([0, 0, 10], [0, 0, -1], [0, 0, 0], 2);
  assert.ok(Math.abs(distance - 8) < 1e-4);
  assert.equal(raySphere([0, 0, 10], [0, 0, 1], [0, 0, 0], 2), null);
});

test("не трогает сферу вне радиуса", () => {
  const position = [0, 21, 0];
  const velocity = [0, -100, 0];
  const onGround = resolveSphereCollisions(floor, position, velocity, 20);
  assert.equal(onGround, false);
  assert.equal(position[1], 21);
  assert.equal(velocity[1], -100);
});
