// Счёт Deathmatch: чистые функции без DOM и Three.js.

export const DEFAULT_FRAG_LIMIT = 20;
const MAX_FRAG_LIMIT = 999;

export function normalizeFragLimit(value, fallback = DEFAULT_FRAG_LIMIT) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const limit = Math.floor(number);
  if (limit <= 0) return fallback;
  return Math.min(limit, MAX_FRAG_LIMIT);
}

export function createScoreboard(options = {}) {
  const limit = normalizeFragLimit(options.limit);
  const playerName = options.playerName ?? "Player";
  const playerId = options.playerId ?? "player";
  return {
    limit,
    over: false,
    winner: null,
    entries: [{ id: playerId, name: playerName, frags: 0, deaths: 0 }]
  };
}

function findEntry(score, id) {
  if (!score || !Array.isArray(score.entries)) return null;
  return score.entries.find((entry) => entry.id === id) ?? null;
}

export function addEntry(score, id, name) {
  if (!score || typeof id !== "string" || !id) return null;
  const existing = findEntry(score, id);
  if (existing) return existing;
  const entry = { id, name: name ?? id, frags: 0, deaths: 0 };
  score.entries.push(entry);
  return entry;
}

function refreshOutcome(score) {
  const winner = findWinner(score);
  score.winner = winner?.id ?? null;
  score.over = Boolean(winner);
}

export function addFrag(score, id, amount = 1) {
  const entry = findEntry(score, id);
  if (!entry) return null;
  const count = Math.max(0, Math.floor(Number(amount) || 0));
  entry.frags += count;
  refreshOutcome(score);
  return entry;
}

export function addDeath(score, id) {
  const entry = findEntry(score, id);
  if (!entry) return null;
  entry.deaths += 1;
  return entry;
}

// Игрок добавлен первым, поэтому при равенстве фрагов победа остаётся
// за ним.
export function findWinner(score) {
  if (!score || !Array.isArray(score.entries)) return null;
  const limit = normalizeFragLimit(score.limit);
  return score.entries.find((entry) => entry.frags >= limit) ?? null;
}

export function sortedEntries(score) {
  if (!score || !Array.isArray(score.entries)) return [];
  return [...score.entries].sort((first, second) => {
    if (second.frags !== first.frags) return second.frags - first.frags;
    if (first.deaths !== second.deaths) return first.deaths - second.deaths;
    if (first.id === "player" && second.id !== "player") return -1;
    if (second.id === "player" && first.id !== "player") return 1;
    return String(first.name).localeCompare(String(second.name));
  });
}

export function formatFragProgress(score, id = "player") {
  const entry = findEntry(score, id);
  const limit = normalizeFragLimit(score?.limit);
  return `${entry?.frags ?? 0} / ${limit}`;
}
