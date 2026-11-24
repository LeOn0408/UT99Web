import { raycast, resolveSphereCollisions } from "./collision.mjs";

export const BOT_RADIUS = 18;
export const BOT_EYE = 55;
export const BOT_RANGE = 900;
export const BOT_DAMAGE = 5;
// Скорость бега близка к скорости игрока (240): бот на 70 ед/с
// не догонял никого и выглядел парализованным.
export const BOT_SPEED = 200;

const LOS_EPSILON = 1;

export function hasLineOfSight(collision, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-4) return true;
  const direction = [dx / distance, dy / distance, dz / distance];
  const hit = raycast(collision, from, direction, distance);
  return !hit || hit.distance >= distance - LOS_EPSILON;
}

export function absorbDamage(health, armor, amount) {
  let nextHealth = Math.max(0, Number(health) || 0);
  let nextArmor = Math.max(0, Number(armor) || 0);
  let remaining = Math.max(0, Number(amount) || 0);
  const absorbed = Math.min(nextArmor, remaining);
  nextArmor -= absorbed;
  remaining -= absorbed;
  nextHealth = Math.max(0, nextHealth - remaining);
  return { health: nextHealth, armor: nextArmor };
}

export function moveBotHorizontal(collision, position, target, speed, delta, radius = BOT_RADIUS) {
  const dx = target[0] - position[0];
  const dz = target[2] - position[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-4 || !(delta > 0)) return [0, 0, 0];
  const velocity = [(dx / distance) * speed, 0, (dz / distance) * speed];
  const steps = 4;
  for (let step = 0; step < steps; step += 1) {
    position[0] += velocity[0] * delta / steps;
    position[2] += velocity[2] * delta / steps;
    resolveSphereCollisions(collision, position, velocity, radius);
  }
  return velocity;
}

// Просчёт «застревания»: если бот почти не сдвинулся, хотя двигался,
// накапливаем stuckTime. Вызывается после moveBotHorizontal.
export function updateBotStuck(bot, moved, speed, delta, stuckAfter = 1) {
  if (moved < speed * delta * 0.25) bot.stuckTime = (bot.stuckTime ?? 0) + delta;
  else bot.stuckTime = 0;
  return bot.stuckTime >= stuckAfter;
}

// Обход препятствия: боковая цель под ±90° от направления на игрока.
// Без полноценного поиска пути это выводит бота из тупиков и дверей.
export function pickDetourTarget(position, target) {
  const dx = target[0] - position[0];
  const dz = target[2] - position[2];
  const distance = Math.hypot(dx, dz) || 1;
  const side = Math.random() < 0.5 ? 1 : -1;
  const reach = Math.min(distance, 600);
  return [
    position[0] + (-dz / distance) * side * reach + (dx / distance) * reach * 0.3,
    position[1],
    position[2] + (dx / distance) * side * reach + (dz / distance) * reach * 0.3
  ];
}
