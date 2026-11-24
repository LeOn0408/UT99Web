import assert from "node:assert/strict";
import test from "node:test";
import { createCollisionWorld } from "../src/level/collision.mjs";
import {
  BOT_RADIUS,
  absorbDamage,
  hasLineOfSight,
  moveBotHorizontal
} from "../src/level/bots.mjs";

// Стена в плоскости X = 50.
const wallTriangles = new Float32Array([
  50, -100, -100,
  50, 100, -100,
  50, 100, 100,
  50, -100, -100,
  50, 100, 100,
  50, -100, 100
]);

const empty = new Float32Array(0);

test("линия видимости свободна без препятствий", () => {
  assert.equal(hasLineOfSight(empty, [0, 0, 0], [100, 0, 0]), true);
});

test("стена перекрывает линию видимости", () => {
  const world = createCollisionWorld(wallTriangles, 32);
  assert.equal(hasLineOfSight(world, [0, 0, 0], [100, 0, 0]), false);
});

test("цель ближе стены остаётся видимой", () => {
  const world = createCollisionWorld(wallTriangles, 32);
  assert.equal(hasLineOfSight(world, [0, 0, 0], [40, 0, 0]), true);
});

test("броня поглощает урон первой", () => {
  assert.deepEqual(absorbDamage(100, 50, 30), { health: 100, armor: 20 });
});

test("излишек урона уходит в здоровье", () => {
  assert.deepEqual(absorbDamage(100, 20, 50), { health: 70, armor: 0 });
});

test("здоровье и броня не уходят ниже нуля", () => {
  assert.deepEqual(absorbDamage(10, 5, 200), { health: 0, armor: 0 });
  assert.deepEqual(absorbDamage(-10, -5, 200), { health: 0, armor: 0 });
});

test("бот останавливается перед стеной", () => {
  const world = createCollisionWorld(wallTriangles, 32);
  const position = [0, 0, 0];
  const velocity = moveBotHorizontal(world, position, [200, 0, 0], 90, 1);
  assert.ok(position[0] <= 50 - BOT_RADIUS + 0.5, `бот прошёл сквозь стену: x=${position[0]}`);
  assert.ok(position[0] >= 50 - BOT_RADIUS - 0.5, `бот остановился слишком далеко: x=${position[0]}`);
  assert.equal(velocity[0], 0);
});
