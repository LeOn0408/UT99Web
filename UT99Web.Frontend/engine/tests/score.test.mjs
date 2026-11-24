import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FRAG_LIMIT,
  addDeath,
  addEntry,
  addFrag,
  createScoreboard,
  findWinner,
  formatFragProgress,
  normalizeFragLimit,
  sortedEntries
} from "../src/match/score.mjs";

test("лимит фрагов по умолчанию и нормализация", () => {
  assert.equal(DEFAULT_FRAG_LIMIT, 20);
  assert.equal(normalizeFragLimit(undefined), 20);
  assert.equal(normalizeFragLimit("10"), 10);
  assert.equal(normalizeFragLimit(2.9), 2);
  assert.equal(normalizeFragLimit(0), 20);
  assert.equal(normalizeFragLimit(-5, 5), 5);
  assert.equal(normalizeFragLimit(5000), 999);
});

test("таблица начинает с игрока и добавляет ботов", () => {
  const score = createScoreboard({ limit: 10, playerName: "You" });
  assert.equal(score.limit, 10);
  assert.deepEqual(score.entries, [{ id: "player", name: "You", frags: 0, deaths: 0 }]);
  const bot = addEntry(score, "bot1", "Bot 1");
  assert.equal(bot.id, "bot1");
  assert.equal(addEntry(score, "bot1", "Другой"), bot);
  assert.equal(score.entries.length, 2);
  assert.equal(addEntry(score, "", "пусто"), null);
});

test("фраги и смерти считаются по id", () => {
  const score = createScoreboard({ limit: 10 });
  addEntry(score, "bot1", "Bot 1");
  addFrag(score, "player");
  addFrag(score, "bot1", 2);
  addDeath(score, "bot1");
  assert.equal(score.entries[0].frags, 1);
  assert.equal(score.entries[1].frags, 2);
  assert.equal(score.entries[1].deaths, 1);
  assert.equal(addFrag(score, "nobody"), null);
  assert.equal(addDeath(score, "nobody"), null);
  addFrag(score, "player", -3);
  assert.equal(score.entries[0].frags, 1);
});

test("победитель появляется при достижении лимита", () => {
  const score = createScoreboard({ limit: 3 });
  addEntry(score, "bot1", "Bot 1");
  addFrag(score, "player", 2);
  assert.equal(findWinner(score), null);
  assert.equal(score.over, false);
  addFrag(score, "player");
  assert.equal(findWinner(score).id, "player");
  assert.equal(score.over, true);
  assert.equal(score.winner, "player");
});

test("при равенстве фрагов победа за игроком", () => {
  const score = createScoreboard({ limit: 2 });
  addEntry(score, "bot1", "Bot 1");
  addFrag(score, "bot1", 2);
  addFrag(score, "player", 2);
  assert.equal(findWinner(score).id, "player");
  assert.equal(score.winner, "player");
});

test("при равенстве очков игрок выше ботов", () => {
  const score = createScoreboard({ limit: 20 });
  addEntry(score, "bot1", "Bot 1");
  addEntry(score, "bot2", "Bot 2");
  assert.deepEqual(sortedEntries(score).map((entry) => entry.id), ["player", "bot1", "bot2"]);
});

test("сортировка не мутирует исходную таблицу", () => {
  const score = createScoreboard({ limit: 20 });
  addEntry(score, "bot1", "Bot 1");
  addEntry(score, "bot2", "Bot 2");
  addFrag(score, "bot1", 2);
  addDeath(score, "bot1");
  addFrag(score, "bot2", 2);
  const sorted = sortedEntries(score);
  assert.deepEqual(sorted.map((entry) => entry.id), ["bot2", "bot1", "player"]);
  assert.deepEqual(score.entries.map((entry) => entry.id), ["player", "bot1", "bot2"]);
});

test("прогресс фрагов форматируется с лимитом", () => {
  const score = createScoreboard({ limit: 20 });
  addFrag(score, "player", 3);
  assert.equal(formatFragProgress(score), "3 / 20");
  assert.equal(formatFragProgress(score, "bot9"), "0 / 20");
  assert.equal(formatFragProgress(null), "0 / 20");
});
